import { execFileSync } from 'node:child_process';
import { REAL_E2E_SUPPORTED, SPEECH_TEXT, TTS_SCRIPT } from './realEnv';
import { prepareRealScratch } from './scratch';

/** 合成測試音訊到 playwright.real.config.ts 指定的 OC_REAL_WAV；回傳的函式在測試後只刪 setup 建立的檔案。 */
export default function globalSetup(): (() => void) | undefined {
  const wav = process.env['OC_REAL_WAV'];
  if (!REAL_E2E_SUPPORTED || !wav) return undefined;
  const scratch = prepareRealScratch(wav, SPEECH_TEXT);
  try {
    const voice = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-Out', wav, '-TextFile', scratch.textFile],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
    ).trim();
    console.log(`[e2e:real] synthesized ${wav} with ${voice}`);
  } catch (error) {
    scratch.cleanup();
    throw error;
  }
  return scratch.cleanup;
}
