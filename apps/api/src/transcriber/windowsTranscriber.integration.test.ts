import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWindowsTranscriber, DEFAULT_FFMPEG_PATH } from './windowsTranscriber';

const TTS_SCRIPT = fileURLToPath(new URL('../../scripts/windows-tts.ps1', import.meta.url));
const SPEECH = '今天的會議討論新版本的測試計畫。我們決定下週完成測試，再發布新版本。';
const KEYWORDS = ['會議', '測試', '版本'];

// 真的 System.Speech：只在 Windows 上跑（需要 zh-TW 語音、zh-TW 辨識器與 ffmpeg）。
// 缺 zh-TW 語言套件的 Windows 機器（例如 CI runner）可設 OC_SKIP_STT_IT=1 跳過。
const skip = process.platform !== 'win32' || process.env['OC_SKIP_STT_IT'] === '1';

function synthesize(wavFile: string, textFile: string): void {
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-Out', wavFile, '-TextFile', textFile],
      { stdio: 'pipe', windowsHide: true, timeout: 60_000 },
    );
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`windows-tts.ps1 failed: ${message}${stderr ? `
stderr: ${stderr}` : ''}`, { cause: err });
  }
}

describe.skipIf(skip)('windows transcriber with real System.Speech', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oc-stt-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recognizes Chinese speech synthesized by Windows TTS', async () => {
    const textFile = join(dir, 'speech.txt');
    const wavFile = join(dir, 'speech.wav');
    writeFileSync(textFile, SPEECH, 'utf8');
    synthesize(wavFile, textFile);
    const file = new File([new Uint8Array(readFileSync(wavFile))], 'segment-1.wav', {
      type: 'audio/wav',
    });
    const transcriber = createWindowsTranscriber({
      ffmpegPath: process.env['FFMPEG_PATH']?.trim() || DEFAULT_FFMPEG_PATH,
    });

    const text = await transcriber.transcribe({ file, prompt: '' });

    const found = KEYWORDS.filter((keyword) => text.includes(keyword));
    expect(found.length, `recognized: ${text}`).toBeGreaterThanOrEqual(2);
  }, 90_000);
});
