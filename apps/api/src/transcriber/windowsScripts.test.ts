import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Windows PowerShell 5 沒有 BOM 時會用系統字碼頁讀腳本，所以兩支腳本都必須是 UTF-8 with BOM。 */
function readScript(name: string): { bytes: Buffer; text: string } {
  const bytes = readFileSync(new URL(`../../scripts/${name}`, import.meta.url));
  return { bytes, text: bytes.toString('utf8') };
}

describe.each(['windows-stt.ps1', 'windows-tts.ps1'])('%s', (name) => {
  it('is saved as UTF-8 with BOM', () => {
    expect([...readScript(name).bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('stops on the first error', () => {
    expect(readScript(name).text).toContain("$ErrorActionPreference = 'Stop'");
  });
});

describe('windows-stt.ps1', () => {
  const { text } = readScript('windows-stt.ps1');

  it('dictates zh-TW from a WAV file', () => {
    expect(text).toContain("GetCultureInfo('zh-TW')");
    expect(text).toContain('DictationGrammar');
    expect(text).toContain('SetInputToWaveFile($Wav)');
  });

  it('ends the Recognize() loop on null or on an exception, reporting the exception on stderr', () => {
    expect(text).toContain(
      'try { $result = $engine.Recognize() } catch { [Console]::Error.WriteLine($_.Exception.Message); break }',
    );
    expect(text).toContain('if ($null -eq $result) { break }');
  });

  it('writes the JSON as raw UTF-8 bytes instead of through the console code page', () => {
    expect(text).toContain('[Console]::OpenStandardOutput()');
    expect(text).toContain('New-Object System.Text.UTF8Encoding($false)');
  });
});

describe('windows-tts.ps1', () => {
  const { text } = readScript('windows-tts.ps1');

  it('prefers Microsoft Hanhan and falls back to any zh-TW voice', () => {
    expect(text).toContain("-like 'Microsoft Hanhan*'");
    expect(text).toContain("$_.VoiceInfo.Culture.Name -eq 'zh-TW'");
  });

  it('writes 48 kHz 16-bit mono PCM', () => {
    expect(text).toContain('SpeechAudioFormatInfo(48000');
  });
});
