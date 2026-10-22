import { EMPTY_DOC } from '@oc/shared';
import { Menu, X } from 'lucide-react';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useBackup } from './backup/useBackup';
import { ActionBar } from './components/ActionBar';
import { BackupControls } from './components/BackupControls';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { StorageAlert } from './components/StorageAlert';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { TRANSCRIPT_GAP_TYPE } from './export/common';
import { displayTitle } from './notes/noteStore';
import { ImportNotesError, useNotes, type ImportNotesResult } from './notes/useNotes';
import { openAppDb } from './platform/db';
import { usePlatform } from './platform/PlatformContext';
import { collectGapIds } from './recording/gapRefs';
import { useRecorder } from './recording/useRecorder';
import { useSettings } from './settings/useSettings';
import { useNoteDrawer } from './useNoteDrawer';
import './styles/app.css';

let sharedRecorderDb: ReturnType<typeof openAppDb> | null = null;

/**
 * A second connection to the app database, for the recording queue (Platform stays as is). One
 * per page and never closed, so StrictMode's double state initializers and remounts do not leave
 * orphaned connections; openAppDb closes it itself when a newer version needs the database.
 */
function getRecorderDb(): ReturnType<typeof openAppDb> {
  if (sharedRecorderDb) return sharedRecorderDb;
  const db = openAppDb();
  sharedRecorderDb = db;
  db.catch((error: unknown) => {
    // Failures surface where the queue is used; this only keeps them from being "unhandled".
    console.error('Failed to open the recording queue', error);
    // The next mount tries again.
    if (sharedRecorderDb === db) sharedRecorderDb = null;
  });
  return db;
}

export function NotesApp() {
  const { storage, fileSaver } = usePlatform();
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
    importNotes,
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
  const [recorderDb] = useState(getRecorderDb);
  // Bumped when an import replaces the open note, so the editor reloads it.
  const [editorRevision, setEditorRevision] = useState(0);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    revision: editorRevision,
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

  const backup = useBackup({
    notes,
    fileSaver,
    importNotes: async (incoming) => {
      // The editor keeps the content it was created with; recreate it from the imported version.
      // Also when a later write failed: the notes stored before it are already shown.
      const reloadIfReplaced = (result: ImportNotesResult) => {
        if (result.replacedActive) setEditorRevision((revision) => revision + 1);
      };
      try {
        const result = await importNotes(incoming);
        reloadIfReplaced(result);
        return result;
      } catch (error) {
        if (error instanceof ImportNotesError) reloadIfReplaced(error.result);
        throw error;
      }
    },
    onError: (message, error) => {
      console.error('Backup or import failed', error);
      setStorageError(message);
    },
  });

  // Once the notes are loaded from storage, drop the kept audio of markers no saved note has any
  // more (retried ones, or ones deleted by hand). Once per page load: the list is what is stored.
  const { pruneAudio } = recorder;
  const pruned = useRef(false);
  useEffect(() => {
    if (loading || loadError || pruned.current) return;
    pruned.current = true;
    void pruneAudio(collectGapIds(notes));
  }, [loading, loadError, notes, pruneAudio]);

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
  const backupDisabled = recording || backup.busy;

  // A failed create rejects without adding the note; deleteNote rejects only when the remove
  // failed, after putting the note back. Either way the user has to be told, and the rejection
  // must not go unhandled.
  const reportFailure = (message: string, logMessage: string) => (error: unknown) => {
    console.error(logMessage, error);
    setStorageError(message);
  };

  // backup() and importFile() report their own failures and never reject.
  const startBackup = () => {
    setStorageError(undefined);
    void backup.backup();
  };

  const startImport = (file: File) => {
    setStorageError(undefined);
    void backup.importFile(file);
  };

  const confirmDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (window.confirm(`確定要刪除「${displayTitle(target)}」嗎？此動作無法復原。`)) {
      setStorageError(undefined);
      // Once the note is gone its ⚠ markers can never be retried, so drop their audio as well
      // (only after the note itself was deleted; a failed delete keeps both), except for markers
      // that were copied into another note. forgetNote never rejects.
      const stillReferenced = collectGapIds(notes.filter((n) => n.id !== id));
      deleteNote(id).then(
        () => recorder.forgetNote(id, stillReferenced),
        reportFailure('刪除筆記失敗，請再試一次。', 'Failed to delete note'),
      );
    }
  };

  const onRecord = () => {
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else if (recorder.state === 'idle') void recorder.start();
    else if (recorder.state === 'recording') void recorder.stop();
  };

  const retryGap = (gapId: string) => {
    if (recorder.state === 'needsSetup') setSettingsOpen(true);
    else void recorder.retryGap(gapId);
  };

  // The ⚠ 第 N 段未轉寫・重試 marker is the retry button.
  const onDocumentClick = (event: MouseEvent<HTMLDivElement>) => {
    const gap = event.target instanceof Element ? event.target.closest('[data-transcript-gap]') : null;
    const gapId = gap?.getAttribute('data-transcript-gap');
    if (!gapId) return;
    event.preventDefault();
    retryGap(gapId);
  };

  // Keyboard users select the marker (arrow keys select it as a whole) and press Enter or Space.
  // Capture phase, so ProseMirror does not first replace the selected marker with a line break.
  const onDocumentKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.nativeEvent.isComposing) return;
    if (!(event.target instanceof Node) || !editor.view.dom.contains(event.target)) return;
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== TRANSCRIPT_GAP_TYPE) {
      return;
    }
    const gapId = String(selection.node.attrs.gapId ?? '');
    if (!gapId) return;
    event.preventDefault();
    event.stopPropagation();
    retryGap(gapId);
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar" ref={sidebarRef}>
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          // Also while a backup or import runs: deleting a note that importNotes is still writing
          // would let the final merge put it back in the list.
          disabled={recording || backup.busy}
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
          footer={
            <BackupControls
              disabled={backupDisabled}
              message={backup.message}
              onBackup={startBackup}
              onImportFile={startImport}
            />
          }
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
        <Banner backupDue={backup.backupDue} backupDisabled={backupDisabled} onBackup={startBackup} />
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
        <div
          className="oc-document"
          onClick={onDocumentClick}
          onKeyDownCapture={onDocumentKeyDownCapture}
        >
          <TitleInput
            inputRef={titleRef}
            value={activeNote.title}
            onChange={(title) => updateNote(activeNote.id, { title })}
            onEnter={() => {
              // Set the cursor and move DOM focus synchronously. commands.focus() focuses a frame
              // later, so a key typed right after Enter would land in the title, and the late
              // focus could reset a selection made meanwhile (e.g. ArrowRight onto a ⚠ marker).
              const { state, view } = editor;
              view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
              view.focus();
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
