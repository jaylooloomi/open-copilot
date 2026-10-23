import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { ALLOWED_ORIGIN, TEST_KEY, postTranscribe, transcribeForm } from './test/helpers';
import type { ProcessResult, ProcessRunner } from './transcriber/processRunner';
import { createWindowsTranscriber } from './transcriber/windowsTranscriber';

afterEach(() => {
  vi.restoreAllMocks();
});

function createWindowsApp(handler: (command: string) => ProcessResult) {
  const run: ProcessRunner = async (command) => handler(command);
  const transcriber = createWindowsTranscriber({ run });
  return createApp({ transcriber, accessKeys: [TEST_KEY], allowedOrigins: [ALLOWED_ORIGIN] });
}

const result = (stdout: string, code: number | null = 0): ProcessResult => ({
  code,
  stdout: Buffer.from(stdout, 'utf8'),
  stderr: code === 0 ? '' : 'ffmpeg: invalid data found when processing input',
  timedOut: false,
});

describe('POST /transcribe with the Windows offline transcriber (fake processes)', () => {
  it('returns the recognized text converted to Traditional Chinese', async () => {
    const app = createWindowsApp((command) =>
      command === 'powershell.exe' ? result(JSON.stringify({ text: ' 这是测试 ' })) : result(''),
    );
    const res = await postTranscribe(app, transcribeForm({ seq: '3' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seq: 3, text: '這是測試' });
  });

  it('answers 502 upstream_error when ffmpeg fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createWindowsApp(() => result('', 1));
    const res = await postTranscribe(app, transcribeForm());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error' });
    expect(consoleError).toHaveBeenCalledWith(
      '[transcribe] upstream error:',
      expect.stringContaining('ffmpeg exited with code 1'),
    );
  });
});
