import { fileURLToPath } from 'node:url';

/** 測試音訊用 Windows System.Speech 合成，所以只有 Windows 能跑。 */
export const REAL_E2E_SUPPORTED = process.platform === 'win32';

/** 約 22 秒；關鍵詞重複出現，切段落在句子中間也辨識得到。 */
export const SPEECH_TEXT =
  '今天的會議討論新版本的測試計畫。我們決定下週完成測試，再發布新版本。會議最後確認每個人的工作。' +
  '請大家準時參加下次會議，並且回報測試的結果。這個版本的會議紀錄由測試小組整理。';

/** Windows 辨識器也能穩定辨識的詞；至少要出現 2 個。 */
export const KEYWORDS = ['會議', '測試', '版本'] as const;

/** 不該出現的簡體字（後端會經 toTraditional 轉繁體）。 */
export const SIMPLIFIED_SAMPLES = ['这', '们', '议', '试', '个', '会'] as const;

/** apps/api 的合成腳本（UTF-8 with BOM），與後端整合測試共用。 */
export const TTS_SCRIPT = fileURLToPath(new URL('../../api/scripts/windows-tts.ps1', import.meta.url));

/**
 * 後端這次會用的 provider，順序同 apps/api/src/config.ts：TRANSCRIBE_PROVIDER → Groq → OpenAI →
 * Windows 離線辨識。
 */
export function resolveRealProvider(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string | null {
  const explicit = env['TRANSCRIBE_PROVIDER']?.trim().toLowerCase();
  if (explicit) return explicit;
  if (env['GROQ_API_KEY']?.trim()) return 'groq';
  if (env['OPENAI_API_KEY']?.trim()) return 'openai';
  return platform === 'win32' ? 'windows' : null;
}

/** 與 scripts/prototype.mjs 相同的 `#oc-setup=<base64url(JSON)>`。 */
export function encodeSetupHash(setup: { apiBaseUrl: string; accessKey: string }): string {
  return `#oc-setup=${Buffer.from(JSON.stringify(setup), 'utf8').toString('base64url')}`;
}
