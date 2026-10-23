// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRealScratch } from '../e2e-real/scratch';

const roots: string[] = [];
function fakeTmp(): string {
  const root = mkdtempSync(join(tmpdir(), 'oc-scratch-test-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('real voice e2e scratch files', () => {
  it('writes the text file next to the wav and removes only what it created', () => {
    const tmp = fakeTmp();
    const wav = join(tmp, 'oc-e2e-real-abc', 'speech.wav');
    const scratch = prepareRealScratch(wav, 'hello', tmp);
    expect(readFileSync(scratch.textFile, 'utf8')).toBe('hello');
    writeFileSync(wav, 'RIFF');
    scratch.cleanup();
    expect(existsSync(join(tmp, 'oc-e2e-real-abc'))).toBe(false);
    expect(existsSync(tmp)).toBe(true);
  });

  it('keeps other files that appear in the directory', () => {
    const tmp = fakeTmp();
    const dir = join(tmp, 'oc-e2e-real-abc');
    const scratch = prepareRealScratch(join(dir, 'speech.wav'), 'hello', tmp);
    writeFileSync(join(dir, 'keep.txt'), 'mine');
    scratch.cleanup();
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(dir, 'speech.txt'))).toBe(false);
  });

  it('refuses an OC_REAL_WAV outside its own temp directory and touches nothing', () => {
    const tmp = fakeTmp();
    const project = join(tmp, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'speech.txt'), 'user notes');
    for (const wav of [
      join(project, 'speech.wav'),
      join(tmp, 'speech.wav'),
      join(tmp, 'oc-e2e-real-abc', 'nested', 'speech.wav'),
      join(tmp, 'oc-e2e-real-abc', 'other.wav'),
      join(tmp, 'oc-e2e-real-', 'speech.wav'),
    ]) {
      expect(() => prepareRealScratch(wav, 'hello', tmp)).toThrow(/OC_REAL_WAV/);
    }
    expect(readFileSync(join(project, 'speech.txt'), 'utf8')).toBe('user notes');
  });

  it('refuses a directory that already exists', () => {
    const tmp = fakeTmp();
    const dir = join(tmp, 'oc-e2e-real-abc');
    mkdirSync(dir);
    writeFileSync(join(dir, 'speech.txt'), 'old');
    expect(() => prepareRealScratch(join(dir, 'speech.wav'), 'hello', tmp)).toThrow(/OC_REAL_WAV/);
    expect(readFileSync(join(dir, 'speech.txt'), 'utf8')).toBe('old');
  });
});
