import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REAL_E2E_SUPPORTED, SPEECH_TEXT, TTS_SCRIPT } from './realEnv';

/** 合成測試音訊到 playwright.real.config.ts 指定的 OC_REAL_WAV；回傳的函式在測試後刪除它。 */
export default function globalSetup(): (() => void) | undefined {
  const wav = process.env['OC_REAL_WAV'];
  if (!REAL_E2E_SUPPORTED || !wav) return undefined;
  const dir = dirname(wav);
  mkdirSync(dir, { recursive: true });
  const textFile = join(dir, 'speech.txt');
  writeFileSync(textFile, SPEECH_TEXT, 'utf8');
  const voice = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-Out', wav, '-TextFile', textFile],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
  ).trim();
  console.log(`[e2e:real] synthesized ${wav} with ${voice}`);
  return () => rmSync(dir, { recursive: true, force: true });
}
