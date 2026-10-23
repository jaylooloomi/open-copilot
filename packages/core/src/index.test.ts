import { describe, expect, it, onTestFinished } from 'vitest';
import * as core from './index';
import type { FileSaver, NoteStorage, Platform } from './index';

describe('@oc/core public API', () => {
  it('exports the app, platform plumbing and storage factories', () => {
    expect(typeof core.NotesApp).toBe('function');
    expect(typeof core.PlatformProvider).toBe('function');
    expect(typeof core.usePlatform).toBe('function');
    expect(typeof core.openAppDb).toBe('function');
    expect(typeof core.createIndexedDbStorage).toBe('function');
    expect(typeof core.createBrowserFileSaver).toBe('function');
    expect(typeof core.applySetupLink).toBe('function');
    expect(typeof core.encodeSetupPayload).toBe('function');
    expect(typeof core.decodeSetupPayload).toBe('function');
    expect(core.SETUP_HASH_PARAM).toBe('oc-setup');
  });

  it('builds a working platform from the exported factories', async () => {
    const db = await core.openAppDb(`test-${crypto.randomUUID()}`);
    // Close even when an await or assertion below fails.
    onTestFinished(() => db.close());
    const storage: NoteStorage = core.createIndexedDbStorage(db);
    const fileSaver: FileSaver = core.createBrowserFileSaver();
    const platform: Platform = { storage, fileSaver, canPrint: true };
    await platform.storage.put({ id: 'x', title: 't', content: {}, createdAt: 1, updatedAt: 1 });
    expect(await platform.storage.get('x')).toMatchObject({ title: 't' });
  });
});
