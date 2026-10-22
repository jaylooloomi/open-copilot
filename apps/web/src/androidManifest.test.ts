import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** apps/web/android/app/src/main/AndroidManifest.xml, created by `cap add android`. */
const MANIFEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../android/app/src/main/AndroidManifest.xml',
);

function manifest(): string {
  return readFileSync(MANIFEST, 'utf8');
}

function permissions(): string[] {
  // Covers <uses-permission> and <uses-permission-sdk-23>, whatever the attribute order.
  return [
    ...manifest().matchAll(
      /<uses-permission(?:-sdk-23)?\b[^>]*\sandroid:name="([^"]+)"/g,
    ),
  ].map((match) => match[1]);
}

describe('AndroidManifest.xml', () => {
  it('declares what recording and uploading need', () => {
    // Capacitor's WebChromeClient asks for RECORD_AUDIO and MODIFY_AUDIO_SETTINGS when the page
    // calls getUserMedia({ audio: true }); Android only prompts for permissions the app declares.
    expect(permissions()).toEqual(
      expect.arrayContaining([
        'android.permission.INTERNET',
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS',
      ]),
    );
  });

  it('asks for nothing else', () => {
    expect(permissions()).toHaveLength(3);
  });

  it('keeps notes out of Android Auto Backup', () => {
    // Notes and transcripts live in the WebView's IndexedDB; the app has its own explicit
    // JSON backup, so the OS must not copy them to the user's cloud account behind their back.
    expect(manifest()).toMatch(
      /<application\b[^>]*\sandroid:allowBackup="false"/,
    );
  });
});
