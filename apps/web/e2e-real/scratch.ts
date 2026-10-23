import { mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/** playwright.real.config.ts 產生的目錄名稱前綴：`<tmpdir>/oc-e2e-real-<uuid>/speech.wav`。 */
export const REAL_SCRATCH_PREFIX = 'oc-e2e-real-';

export interface RealScratch {
  textFile: string;
  /** 只刪 setup 建立的 wav、speech.txt 與（變空時的）目錄，其他檔案不動。 */
  cleanup: () => void;
}

/**
 * 建立合成音訊用的暫存目錄。OC_REAL_WAV 可能由外部 shell 預設，所以只接受
 * `<tmp>/oc-e2e-real-<id>/speech.wav`，且目錄必須還不存在；否則拋錯、不碰任何檔案。
 */
export function prepareRealScratch(wav: string, text: string, tmp: string = tmpdir()): RealScratch {
  const wavPath = resolve(wav);
  const dir = dirname(wavPath);
  const name = basename(dir);
  const valid =
    basename(wavPath) === 'speech.wav' &&
    resolve(dirname(dir)).toLowerCase() === resolve(tmp).toLowerCase() &&
    name.startsWith(REAL_SCRATCH_PREFIX) &&
    name.length > REAL_SCRATCH_PREFIX.length;
  if (!valid) {
    throw new Error(
      `OC_REAL_WAV must be ${join(tmp, `${REAL_SCRATCH_PREFIX}<id>`, 'speech.wav')}; got ${wav}. Unset it to let the config pick one.`,
    );
  }
  try {
    mkdirSync(dir);
  } catch (error) {
    throw new Error(`OC_REAL_WAV directory ${dir} could not be created (it must not exist yet): ${String(error)}`);
  }
  const textFile = join(dir, 'speech.txt');
  writeFileSync(textFile, text, 'utf8');
  return {
    textFile,
    cleanup: () => {
      rmSync(wavPath, { force: true });
      rmSync(textFile, { force: true });
      try {
        rmdirSync(dir);
      } catch {
        // Not empty: something else wrote there, so leave it.
      }
    },
  };
}
