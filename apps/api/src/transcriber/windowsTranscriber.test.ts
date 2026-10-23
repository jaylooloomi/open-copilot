import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamRateLimitError } from './errors';
import type { ProcessResult, ProcessRunner } from './processRunner';
import {
  createWindowsTranscriber,
  findFfmpegProblem,
  parseSttOutput,
  WINDOWS_STT_MAX_QUEUED,
  WINDOWS_STT_TIMEOUT_MS,
} from './windowsTranscriber';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'oc-stt-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

const audio = (name = 'segment-1.webm') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/webm' });

const ok = (stdout = ''): ProcessResult => ({
  code: 0,
  stdout: Buffer.from(stdout, 'utf8'),
  stderr: '',
  timedOut: false,
});

const sttJson = (text: string) => JSON.stringify({ text });

interface Call {
  command: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}

function fakeRunner(
  handler: (command: string, args: readonly string[]) => ProcessResult | Promise<ProcessResult>,
) {
  const calls: Call[] = [];
  const run: ProcessRunner = async (command, args, options) => {
    calls.push({ command, args: [...args], timeoutMs: options.timeoutMs, signal: options.signal });
    return handler(command, args);
  };
  return { run, calls };
}

const answerAll = (command: string) =>
  command === 'powershell.exe' ? ok(sttJson('今天的會議')) : ok();

describe('createWindowsTranscriber', () => {
  it('converts with ffmpeg, recognizes with the PowerShell script and returns its text', async () => {
    const { run, calls } = fakeRunner(async (command, args) => {
      if (command === 'C:\\tools\\ffmpeg.exe') {
        // The uploaded audio is on disk while ffmpeg runs.
        expect(await readFile(args[args.indexOf('-i') + 1]!)).toEqual(Buffer.from([1, 2, 3]));
        return ok();
      }
      return ok(sttJson('今天的會議'));
    });
    const transcriber = createWindowsTranscriber({
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      run,
      scriptPath: 'C:\\oc\\windows-stt.ps1',
      tempDir,
    });

    await expect(transcriber.transcribe({ file: audio(), prompt: '前一段的文字' })).resolves.toBe(
      '今天的會議',
    );

    expect(calls.map((c) => c.command)).toEqual(['C:\\tools\\ffmpeg.exe', 'powershell.exe']);
    const [ffmpeg, stt] = calls;
    const input = ffmpeg!.args[ffmpeg!.args.indexOf('-i') + 1]!;
    const wav = ffmpeg!.args.at(-1)!;
    expect(input).toMatch(/input\.webm$/);
    expect(wav).toMatch(/audio\.wav$/);
    expect(ffmpeg!.args).toEqual([
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'matroska,webm,ogg,mov,mp4,m4a,wav',
      '-i',
      input,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-f',
      'wav',
      wav,
    ]);
    expect(stt!.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\oc\\windows-stt.ps1',
      '-Wav',
      wav,
    ]);
    // System.Speech has no prompt input; the prompt never reaches a command line.
    expect(JSON.stringify(calls)).not.toContain('前一段的文字');
    // Temp files are always deleted.
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('keeps known audio extensions and uses .bin for anything else', async () => {
    const { run, calls } = fakeRunner(answerAll);
    const transcriber = createWindowsTranscriber({ run, tempDir });
    for (const name of ['segment-2.mp4', 'segment-3', 'x.M4A', 'list.m3u8', 'cat.txt', 'a.ffconcat']) {
      await transcriber.transcribe({ file: audio(name), prompt: '' });
    }
    const inputs = calls
      .filter((c) => c.command === 'ffmpeg')
      .map((c) => c.args[c.args.indexOf('-i') + 1]!.replace(/^.*input/, 'input'));
    expect(inputs).toEqual([
      'input.mp4',
      'input.bin',
      'input.m4a',
      'input.bin',
      'input.bin',
      'input.bin',
    ]);
  });

  it('counts the time a segment waits in the queue against its budget', async () => {
    let release: () => void = () => {};
    const { run, calls } = fakeRunner(async (command) => {
      if (command === 'ffmpeg' && calls.filter((c) => c.command === 'ffmpeg').length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return answerAll(command);
    });
    const transcriber = createWindowsTranscriber({ run, tempDir, concurrency: 1, timeoutMs: 1_000 });

    const first = transcriber.transcribe({ file: audio('segment-1.webm'), prompt: '' });
    const second = transcriber.transcribe({ file: audio('segment-2.webm'), prompt: '' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['今天的會議', '今天的會議']);

    const secondFfmpeg = calls.filter((c) => c.command === 'ffmpeg')[1]!;
    // The second segment arrived with the first, so ~400 ms of its 1 s budget went to waiting.
    expect(secondFfmpeg.timeoutMs).toBeLessThanOrEqual(650);
  });

  it('fails a segment whose budget ran out while it was queued, without starting ffmpeg', async () => {
    let release: () => void = () => {};
    const { run, calls } = fakeRunner(async (command) => {
      if (command === 'ffmpeg' && calls.length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return answerAll(command);
    });
    const transcriber = createWindowsTranscriber({ run, tempDir, concurrency: 1, timeoutMs: 100 });

    const first = transcriber.transcribe({ file: audio('segment-1.webm'), prompt: '' });
    const second = transcriber.transcribe({ file: audio('segment-2.webm'), prompt: '' });
    // It now fails as soon as its budget runs out, so attach the expectation before waiting.
    const secondFails = expect(second).rejects.toThrow(/queue/);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await first;
    await secondFails;
    expect(calls.filter((c) => c.command === 'ffmpeg')).toHaveLength(1);
  });

  it('shares one 30 s budget across both steps and passes the request signal on', async () => {
    const { run, calls } = fakeRunner(answerAll);
    const controller = new AbortController();
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await transcriber.transcribe({ file: audio(), prompt: '', signal: controller.signal });
    expect(WINDOWS_STT_TIMEOUT_MS).toBe(30_000);
    for (const call of calls) {
      expect(call.timeoutMs).toBeGreaterThan(29_000);
      expect(call.timeoutMs).toBeLessThanOrEqual(30_000);
      expect(call.signal).toBe(controller.signal);
    }
  });

  it('fails with a timeout error and still deletes the temp files', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { run, calls } = fakeRunner(() => ({ ...ok(), code: null, timedOut: true }));
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(transcriber.transcribe({ file: audio(), prompt: '' })).rejects.toThrow(
      'ffmpeg timed out after 30000ms (30000ms budget per segment)',
    );
    expect(calls).toHaveLength(1);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('reports the time the timed-out step actually had, not the whole budget', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { run } = fakeRunner((command) => {
      if (command === 'powershell.exe') return { ...ok(), code: null, timedOut: true };
      now += 25_000; // ffmpeg used 25 s of the 30 s budget
      return ok();
    });
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(transcriber.transcribe({ file: audio(), prompt: '' })).rejects.toThrow(
      'windows-stt timed out after 5000ms (30000ms budget per segment)',
    );
  });

  it('surfaces a cancellation during a step as an AbortError, not an exit code', async () => {
    const controller = new AbortController();
    const { run, calls } = fakeRunner(() => {
      controller.abort();
      return { ...ok(), code: null };
    });
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(
      transcriber.transcribe({ file: audio(), prompt: '', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('fails with the exit code and the last stderr lines when a step exits non-zero', async () => {
    const { run } = fakeRunner((command) =>
      command === 'powershell.exe'
        ? { ...ok(), code: 1, stderr: 'line 1\r\nNo recognizer is installed for zh-TW\r\n' }
        : ok(),
    );
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(transcriber.transcribe({ file: audio(), prompt: '' })).rejects.toThrow(
      'windows-stt exited with code 1: line 1 | No recognizer is installed for zh-TW',
    );
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('fails when the script prints something that is not the expected JSON', async () => {
    const { run } = fakeRunner((command) => (command === 'powershell.exe' ? ok('oops') : ok()));
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(transcriber.transcribe({ file: audio(), prompt: '' })).rejects.toThrow(
      'windows-stt printed invalid JSON',
    );
  });

  it('runs at most two segments at a time and queues the rest', async () => {
    const gates: (() => void)[] = [];
    let active = 0;
    let maxActive = 0;
    const { run } = fakeRunner((command) => {
      if (command === 'powershell.exe') {
        active -= 1;
        return ok(sttJson('好'));
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<ProcessResult>((resolve) => gates.push(() => resolve(ok())));
    });
    const transcriber = createWindowsTranscriber({ run, tempDir });

    const results = [1, 2, 3].map((n) =>
      transcriber.transcribe({ file: audio(`segment-${n}.webm`), prompt: '' }),
    );
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gates).toHaveLength(2);

    gates[0]!();
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[1]!();
    gates[2]!();
    await expect(Promise.all(results)).resolves.toEqual(['好', '好', '好']);
    expect(maxActive).toBe(2);
  });

  it('answers 429 at once when the queue is full instead of holding more uploads in memory', async () => {
    const gates: (() => void)[] = [];
    const { run } = fakeRunner((command) =>
      command === 'powershell.exe'
        ? ok(sttJson('好'))
        : new Promise<ProcessResult>((resolve) => gates.push(() => resolve(ok()))),
    );
    const transcriber = createWindowsTranscriber({ run, tempDir, concurrency: 1, maxQueued: 1 });

    const running = transcriber.transcribe({ file: audio('segment-1.webm'), prompt: '' });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const queued = transcriber.transcribe({ file: audio('segment-2.webm'), prompt: '' });
    const refused = transcriber.transcribe({ file: audio('segment-3.webm'), prompt: '' });
    await expect(refused).rejects.toBeInstanceOf(UpstreamRateLimitError);

    gates[0]!();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]!();
    await expect(Promise.all([running, queued])).resolves.toEqual(['好', '好']);
    expect(WINDOWS_STT_MAX_QUEUED).toBeGreaterThanOrEqual(1);
  });

  it('drops a queued segment when its client disconnects, without waiting for its turn', async () => {
    let release: () => void = () => {};
    const { run, calls } = fakeRunner(async (command) => {
      if (command === 'ffmpeg' && calls.length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return answerAll(command);
    });
    const transcriber = createWindowsTranscriber({ run, tempDir, concurrency: 1 });

    const first = transcriber.transcribe({ file: audio('segment-1.webm'), prompt: '' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const controller = new AbortController();
    const second = transcriber.transcribe({ file: audio('segment-2.webm'), prompt: '', signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await first;
    expect(calls.filter((c) => c.command === 'ffmpeg')).toHaveLength(1);
  });

  it('fails a queued segment as soon as its budget runs out, while the other one still runs', async () => {
    let release: () => void = () => {};
    const { run, calls } = fakeRunner(async (command) => {
      if (command === 'ffmpeg' && calls.length === 1) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return answerAll(command);
    });
    const transcriber = createWindowsTranscriber({ run, tempDir, concurrency: 1, timeoutMs: 100 });

    const first = transcriber.transcribe({ file: audio('segment-1.webm'), prompt: '' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const second = transcriber.transcribe({ file: audio('segment-2.webm'), prompt: '' });
    // The first segment is still running: the second one gives up on its own.
    await expect(second).rejects.toThrow(/queue/);
    release();
    await first;
  });

  it('does not start anything for a request that was already cancelled', async () => {
    const { run, calls } = fakeRunner(answerAll);
    const transcriber = createWindowsTranscriber({ run, tempDir });
    await expect(
      transcriber.transcribe({ file: audio(), prompt: '', signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('parseSttOutput', () => {
  it('reads {"text"} and tolerates a BOM and trailing whitespace', () => {
    expect(parseSttOutput(Buffer.from('\uFEFF{"text":"會議"}\r\n', 'utf8'))).toBe('會議');
  });

  it('rejects JSON without a text string', () => {
    expect(() => parseSttOutput(Buffer.from('{"text":1}', 'utf8'))).toThrow(
      'windows-stt output has no "text" string',
    );
  });
});

describe('findFfmpegProblem', () => {
  it('is quiet when ffmpeg runs', () => {
    expect(findFfmpegProblem('ffmpeg', () => true)).toBeUndefined();
  });

  it('names the path and FFMPEG_PATH when ffmpeg does not run', () => {
    const problem = findFfmpegProblem('C:\\missing\\ffmpeg.exe', () => false);
    expect(problem).toContain('ffmpeg not found at "C:\\missing\\ffmpeg.exe"');
    expect(problem).toContain('FFMPEG_PATH');
  });
});
