import { EMPTY_DOC } from '@oc/shared';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ActionBar } from './components/ActionBar';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { StorageAlert } from './components/StorageAlert';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { displayTitle } from './notes/noteStore';
import { useNotes } from './notes/useNotes';
import { openAppDb } from './platform/db';
import { usePlatform } from './platform/PlatformContext';
import { createPendingQueue } from './recording/pendingQueue';
import { useRecorder } from './recording/useRecorder';
import { useSettings } from './settings/useSettings';
import { useNoteDrawer } from './useNoteDrawer';
import './styles/app.css';

/** A second connection to the app database, for the recording queue (Platform stays as is). */
function openRecorderDb() {
  const db = openAppDb();
  // Failures surface where the queue is used; this only keeps them from being "unhandled".
  db.catch((error: unknown) => console.error('Failed to open the recording queue', error));
  return db;
}

export function NotesApp() {
  const { storage } = usePlatform();
  const {
    notes,
    activeNote,
    loading,
    loadError,
    retryLoad,
    saveFailed,
    dismissSaveError,
    createNote,
    selectNote,
    deleteNote,
    updateNote,
  } = useNotes(storage);
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    sidebarRef,
    menuButtonRef,
  } = useNoteDrawer();
  const [storageError, setStorageError] = useState<string | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);
  // A note just created from the 新增筆記 button: its title gets focus once it is shown.
  const [focusTitleOf, setFocusTitleOf] = useState<string | undefined>(undefined);
  const { settings, saveSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recorderDb] = useState(openRecorderDb);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    content: activeNote?.content ?? EMPTY_DOC,
    // Routed by the note the editor belongs to, so an edit typed while the active note is
    // changing cannot land on another note.
    onChange: (content, noteId) => updateNote(noteId, { content }),
  });

  const recorder = useRecorder({
    editor,
    noteId: activeNote?.id,
    settings,
    db: recorderDb,
    onUnauthorized: () => setSettingsOpen(true),
  });

  useEffect(() => {
    if (focusTitleOf === undefined || focusTitleOf !== activeNote?.id) return;
    titleRef.current?.focus();
    setFocusTitleOf(undefined);
  }, [focusTitleOf, activeNote?.id]);

  if (loadError) {
    return (
      <div className="oc-load-error" role="alert">
        <p>無法載入筆記，請再試一次。</p>
        <button type="button" className="oc-load-retry" onClick={retryLoad}>
          重試
        </button>
      </div>
    );
  }

  if (loading || !activeNote) {
    return (
      <div className="oc-loading" role="status">
        載入中…
      </div>
    );
  }

  const closeDrawer = () => setDrawerOpen(false);
  const recording = recorder.state === 'recording' || recorder.state === 'stopping';

  // A failed create rejects without adding the note; deleteNote rejects only when the remove
  // failed, after putting the note back. Either way the user has to be told, and the rejection
  // must not go unhandled.
  const reportFailure = (message: string, logMessage: string) => (error: unknown) => {
    console.error(logMessage, error);
    setStorageError(message);
  };

  const confirmDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (window.confirm(`確定要刪除「${displayTitle(target)}」嗎？此動作無法復原。`)) {
      setStorageError(undefined);
      // Once the note is gone its ⚠ markers can never be retried, so drop their audio as well
      // (only after the note itself was deleted; a failed delete keeps both).
      deleteNote(id)
        .then(
          () =>
            createPendingQueue(recorderDb)
              .removeByNote(id)
              .catch((error: unknown) =>
                console.error('Failed to drop the untranscribed audio of a deleted note', error),
              ),
          reportFailure('刪除筆記失敗，請再試一次。', 'Failed to delete note'),
        )
        // Catches a synchronous throw while building the queue, which the .catch above cannot.
        .catch((error: unknown) =>
          console.error('Failed to drop the untranscribed audio of a deleted note', error),
        );
    }
  };

  const onRecord = () => {
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else if (recorder.state === 'idle') void recorder.start();
    else if (recorder.state === 'recording') void recorder.stop();
  };

  // The ⚠ 第 N 段未轉寫・重試 marker is the retry button.
  const onDocumentClick = (event: MouseEvent<HTMLDivElement>) => {
    const gap = event.target instanceof Element ? event.target.closest('[data-transcript-gap]') : null;
    const gapId = gap?.getAttribute('data-transcript-gap');
    if (!gapId) return;
    event.preventDefault();
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else void recorder.retryGap(gapId);
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar" ref={sidebarRef}>
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          disabled={recording}
          onSelect={(id) => {
            selectNote(id);
            closeDrawer();
          }}
          onCreate={() => {
            setStorageError(undefined);
            createNote().then(
              (created) => setFocusTitleOf(created.id),
              reportFailure('新增筆記失敗，請再試一次。', 'Failed to create note'),
            );
            closeDrawer();
          }}
          onDelete={confirmDelete}
        />
        {drawerOpen && (
          // <main> is inert while the drawer is open, so the menu button cannot close it. Touch
          // screen reader users reach this one; keyboard users press Escape.
          <button
            type="button"
            className="oc-visually-hidden"
            tabIndex={-1}
            onClick={closeDrawer}
          >
            關閉筆記清單
          </button>
        )}
      </aside>
      {drawerOpen && <div className="oc-backdrop" aria-hidden="true" onClick={closeDrawer} />}

      <main className="oc-main" inert={drawerOpen}>
        <header className="oc-topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="oc-menu-btn"
            aria-label={drawerOpen ? '關閉筆記清單' : '開啟筆記清單'}
            aria-controls="oc-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Menu size={20} />
          </button>
          <ActionBar
            recordState={recorder.state}
            onRecord={onRecord}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </header>
        <Banner />
        {(recorder.error || recorder.notice) && (
          <div className="oc-recorder-alert" role="alert">
            <div className="oc-recorder-alert-text">
              {recorder.error && <p className="oc-recorder-error">{recorder.error}</p>}
              {recorder.notice && <p className="oc-recorder-notice">{recorder.notice}</p>}
            </div>
            <button
              type="button"
              className="oc-alert-close"
              aria-label="關閉訊息"
              onClick={recorder.dismissMessages}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <Toolbar editor={editor} note={activeNote} />
        <div className="oc-document" onClick={onDocumentClick}>
          <TitleInput
            inputRef={titleRef}
            value={activeNote.title}
            onChange={(title) => updateNote(activeNote.id, { title })}
            onEnter={() => {
              // Move DOM focus now: focus() alone waits a frame, so a key typed right after Enter
              // would still land in the title.
              editor.view.focus();
              editor.commands.focus('start');
            }}
          />
          <Editor editor={editor} />
        </div>
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => {
            saveSettings(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {storageError ? (
        <StorageAlert message={storageError} onDismiss={() => setStorageError(undefined)} />
      ) : (
        saveFailed && (
          <StorageAlert
            message="筆記儲存失敗，變更尚未存檔。繼續編輯時會再試一次。"
            onDismiss={dismissSaveError}
          />
        )
      )}
    </div>
  );
}
