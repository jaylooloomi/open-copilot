import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UpstreamRateLimitError } from './errors';
import {
  createLimiter,
  LimiterQueueFullError,
  LimiterWaitTimeoutError,
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from './processRunner';
import type { Transcriber } from './types';

/** 啟動紀錄顯示的「模型」名稱。 */
export const WINDOWS_STT_MODEL = 'System.Speech zh-TW';
/**
 * 一段音訊從請求進來到辨識完成的期限（排隊、ffmpeg 與 PowerShell 共用）。前端每個請求也是 30 秒
 * 逾時，所以從請求進來起算，後端不會為前端已放棄的請求繼續做事。
 */
export const WINDOWS_STT_TIMEOUT_MS = 30_000;
/** 同時處理的段數上限，其餘排隊。 */
export const WINDOWS_STT_CONCURRENCY = 2;
/**
 * 最多幾段排隊等辨識（不含執行中的）。每段都帶著解析好的上傳內容（最多 5 MiB），
 * 所以佇列滿了就立刻回 429，不讓記憶體跟著請求數長大。
 */
export const WINDOWS_STT_MAX_QUEUED = 8;
/** 佇列滿時要前端等待的秒數（Retry-After）。 */
export const WINDOWS_STT_QUEUE_FULL_RETRY_SECONDS = 5;
/** FFMPEG_PATH 沒設定時，用 PATH 上的 ffmpeg。 */
export const DEFAULT_FFMPEG_PATH = 'ffmpeg';
/** UTF-8 with BOM 的辨識腳本（apps/api/scripts/windows-stt.ps1）。 */
export const WINDOWS_STT_SCRIPT = fileURLToPath(
  new URL('../../scripts/windows-stt.ps1', import.meta.url),
);

/** 暫存目錄名稱的前綴（mkdtemp 會在後面加隨機字元）。 */
const TEMP_DIR_PREFIX = 'oc-stt-';
/**
 * 超過這個時間沒動過的 oc-stt-* 目錄視為伺服器被終止時留下的：每段最多 30 秒，10 分鐘還在就不會有人在用。
 */
export const STALE_TEMP_DIR_MS = 10 * 60_000;

/**
 * 刪除 tempDir 底下超過 maxAgeMs 沒動過的 oc-stt-* 目錄（程序在辨識途中被終止時，finally 來不及清）。
 * 回傳刪掉的數量；個別項目刪不掉就略過，不會丟錯。
 */
export async function removeStaleTempDirs(
  tempDir: string,
  maxAgeMs: number = STALE_TEMP_DIR_MS,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(tempDir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(TEMP_DIR_PREFIX)) continue;
    const dir = join(tempDir, name);
    try {
      const info = await stat(dir);
      if (!info.isDirectory() || info.mtimeMs >= cutoff) continue;
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // 其他程序剛好刪掉或還鎖著：下次啟動再說。
    }
  }
  return removed;
}

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
  /** 最多幾段排隊（預設 WINDOWS_STT_MAX_QUEUED）；滿了就丟 UpstreamRateLimitError（429）。 */
  maxQueued?: number;
  scriptPath?: string;
  /** 暫存目錄的上層，預設 os.tmpdir()。 */
  tempDir?: string;
}

/** 暫存檔只沿用常見音訊的副檔名，其他（例如 .m3u8 播放清單）一律用 .bin。 */
const AUDIO_EXTENSIONS = new Set(['.webm', '.ogg', '.oga', '.opus', '.m4a', '.mp4', '.wav']);

function inputExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext) ? ext : '.bin';
}

/**
 * ffmpeg 只能讀本機檔案、只能用音訊容器的解析器：上傳的檔案若是 HLS 播放清單或 concat 清單，
 * 不會被拿去讀伺服器上的其他檔案。
 */
export const FFMPEG_INPUT_GUARD = [
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  'matroska,webm,ogg,mov,mp4,m4a,wav',
] as const;

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
    maxQueued = WINDOWS_STT_MAX_QUEUED,
    scriptPath = WINDOWS_STT_SCRIPT,
    tempDir = tmpdir(),
  } = options;
  const limit = createLimiter(concurrency, { maxQueued });
  // 上次被終止的伺服器留下的暫存目錄；背景清掉，不擋啟動。
  void removeStaleTempDirs(tempDir).then((count) => {
    if (count > 0) console.log(`[transcribe] deleted ${count} leftover temp folder(s)`);
  });

  async function transcribeOnce(
    file: File,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<string> {
    // 排隊期間用戶端已斷線：不必再轉檔。
    signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new WindowsTranscribeError(
        `timed out after waiting in the queue (${timeoutMs}ms budget per segment)`,
      );
    }
    const remaining = () => Math.max(1, deadline - Date.now());
    const dir = await mkdtemp(join(tempDir, TEMP_DIR_PREFIX));
    try {
      const input = join(dir, `input${inputExtension(file.name)}`);
      const wav = join(dir, 'audio.wav');
      await writeFile(input, new Uint8Array(await file.arrayBuffer()));
      const ffmpegMs = remaining();
      const converted = await run(
        ffmpegPath,
        ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...FFMPEG_INPUT_GUARD, '-i', input, '-ar', '16000', '-ac', '1', '-f', 'wav', wav],
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
      // 期限從請求進來就開始算，排隊時間也算在內。
      const deadline = Date.now() + timeoutMs;
      return limit(() => transcribeOnce(file, signal, deadline), { signal, deadline }).catch(
        (err: unknown) => {
          if (err instanceof LimiterQueueFullError) {
            throw new UpstreamRateLimitError(WINDOWS_STT_QUEUE_FULL_RETRY_SECONDS, { cause: err });
          }
          if (err instanceof LimiterWaitTimeoutError) {
            throw new WindowsTranscribeError(
              `timed out after waiting in the queue (${timeoutMs}ms budget per segment)`,
            );
          }
          throw err;
        },
      );
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
