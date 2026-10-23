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
describe.skipIf(process.platform !== 'win32')('windows transcriber with real System.Speech', () => {
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
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-Out', wavFile, '-TextFile', textFile],
      { stdio: 'pipe', windowsHide: true, timeout: 60_000 },
    );
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
