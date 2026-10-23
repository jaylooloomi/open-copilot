import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLimiter, runProcess, type ProcessResult, type ProcessRunner } from './processRunner';
import type { Transcriber } from './types';

/** 啟動紀錄顯示的「模型」名稱。 */
export const WINDOWS_STT_MODEL = 'System.Speech zh-TW';
/** 一段音訊從轉檔到辨識完成的期限（ffmpeg 與 PowerShell 共用），不含排隊時間。 */
export const WINDOWS_STT_TIMEOUT_MS = 30_000;
/** 同時處理的段數上限，其餘排隊。 */
export const WINDOWS_STT_CONCURRENCY = 2;
/** FFMPEG_PATH 沒設定時，用 PATH 上的 ffmpeg。 */
export const DEFAULT_FFMPEG_PATH = 'ffmpeg';
/** UTF-8 with BOM 的辨識腳本（apps/api/scripts/windows-stt.ps1）。 */
export const WINDOWS_STT_SCRIPT = fileURLToPath(
  new URL('../../scripts/windows-stt.ps1', import.meta.url),
);

/** ffmpeg 或辨識腳本失敗、逾時、輸出格式不對；app.ts 對應成 502 upstream_error。 */
export class WindowsTranscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowsTranscribeError';
  }
}

export interface WindowsTranscriberOptions {
  ffmpegPath?: string;
  /** 只給測試注入假的外部程式。 */
  run?: ProcessRunner;
  timeoutMs?: number;
  concurrency?: number;
  scriptPath?: string;
  /** 暫存目錄的上層，預設 os.tmpdir()。 */
  tempDir?: string;
}

/** 暫存檔沿用上傳檔的副檔名（ffmpeg 會再自己判斷格式）；看起來怪的一律用 .bin。 */
function inputExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

/** stepMs 是這一步實際拿到的時間（共用期限剩下的部分），budgetMs 是整段的期限。 */
function assertSucceeded(
  result: ProcessResult,
  step: string,
  stepMs: number,
  budgetMs: number,
): void {
  if (result.timedOut) {
    throw new WindowsTranscribeError(
      `${step} timed out after ${stepMs}ms (${budgetMs}ms budget per segment)`,
    );
  }
  if (result.code !== 0) {
    const detail = result.stderr
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .slice(-3)
      .join(' | ')
      .slice(0, 300);
    throw new WindowsTranscribeError(
      `${step} exited with code ${result.code}${detail ? `: ${detail}` : ''}`,
    );
  }
}

/** 解析 windows-stt.ps1 的輸出 `{"text":"..."}`。 */
export function parseSttOutput(stdout: Buffer): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.toString('utf8').replace(/^\uFEFF/, '').trim());
  } catch {
    throw new WindowsTranscribeError('windows-stt printed invalid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { text?: unknown }).text !== 'string'
  ) {
    throw new WindowsTranscribeError('windows-stt output has no "text" string');
  }
  return (parsed as { text: string }).text;
}

/**
 * Windows 內建離線轉寫（add-ons 設計 1.2a）：音訊寫進暫存檔 → ffmpeg 轉成 16 kHz 單聲道 WAV →
 * PowerShell 用 System.Speech（zh-TW 聽寫）辨識。忽略 prompt；輸出的繁體轉換由 app.ts 統一處理。
 */
export function createWindowsTranscriber(options: WindowsTranscriberOptions = {}): Transcriber {
  const {
    ffmpegPath = DEFAULT_FFMPEG_PATH,
    run = runProcess,
    timeoutMs = WINDOWS_STT_TIMEOUT_MS,
    concurrency = WINDOWS_STT_CONCURRENCY,
    scriptPath = WINDOWS_STT_SCRIPT,
    tempDir = tmpdir(),
  } = options;
  const limit = createLimiter(concurrency);

  async function transcribeOnce(file: File, signal: AbortSignal | undefined): Promise<string> {
    // 排隊期間用戶端已斷線：不必再轉檔。
    signal?.throwIfAborted();
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - Date.now());
    const dir = await mkdtemp(join(tempDir, 'oc-stt-'));
    try {
      const input = join(dir, `input${inputExtension(file.name)}`);
      const wav = join(dir, 'audio.wav');
      await writeFile(input, new Uint8Array(await file.arrayBuffer()));
      const ffmpegMs = remaining();
      const converted = await run(
        ffmpegPath,
        ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
        { timeoutMs: ffmpegMs, signal },
      );
      // 執行中被取消時 runProcess 回 code null；改丟 AbortError，不要報成「exited with code null」。
      signal?.throwIfAborted();
      assertSucceeded(converted, 'ffmpeg', ffmpegMs, timeoutMs);
      const sttMs = remaining();
      const recognized = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Wav', wav],
        { timeoutMs: sttMs, signal },
      );
      signal?.throwIfAborted();
      assertSucceeded(recognized, 'windows-stt', sttMs, timeoutMs);
      return parseSttOutput(recognized.stdout);
    } finally {
      // 刪不掉（例如被 kill 的程序還沒放開檔案）只記錄，不蓋掉原本的結果或錯誤。
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
        (err: unknown) =>
          console.warn(
            '[transcribe] could not delete temp files:',
            err instanceof Error ? err.message : String(err),
          ),
      );
    }
  }

  return {
    transcribe({ file, signal }) {
      return limit(() => transcribeOnce(file, signal));
    },
  };
}

/** 執行一次 `ffmpeg -version`，能跑就回 true。 */
export function probeFfmpeg(ffmpegPath: string): boolean {
  const result = spawnSync(ffmpegPath, ['-version'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 10_000,
  });
  return result.error === undefined && result.status === 0;
}

/** server.ts 啟動時檢查：找不到 ffmpeg 就回傳要印出的訊息。 */
export function findFfmpegProblem(
  ffmpegPath: string,
  probe: (path: string) => boolean = probeFfmpeg,
): string | undefined {
  if (probe(ffmpegPath)) return undefined;
  return (
    `ffmpeg not found at "${ffmpegPath}": TRANSCRIBE_PROVIDER=windows needs ffmpeg ` +
    '(install it, e.g. winget install Gyan.FFmpeg, or set FFMPEG_PATH to ffmpeg.exe)'
  );
}
