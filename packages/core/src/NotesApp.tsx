import { EMPTY_DOC } from '@oc/shared';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { ActionBar } from './components/ActionBar';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { StorageAlert } from './components/StorageAlert';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { displayTitle } from './notes/noteStore';
import { useNotes } from './notes/useNotes';
import { usePlatform } from './platform/PlatformContext';
import { useNoteDrawer } from './useNoteDrawer';
import './styles/app.css';

export function NotesApp() {
  const { storage } = usePlatform();
  const {
    notes,
    activeNote,
    loading,
    createNote,
    selectNote,
    deleteNote,
    updateActive,
  } = useNotes(storage);
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    sidebarRef,
    menuButtonRef,
  } = useNoteDrawer();
  const [storageError, setStorageError] = useState<string | undefined>(undefined);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    content: activeNote?.content ?? EMPTY_DOC,
    onChange: (content) => updateActive({ content }),
  });

  if (loading || !activeNote) {
    return (
      <div className="oc-loading" role="status">
        載入中…
      </div>
    );
  }

  const closeDrawer = () => setDrawerOpen(false);

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
      deleteNote(id).catch(reportFailure('刪除筆記失敗，請再試一次。', 'Failed to delete note'));
    }
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar" ref={sidebarRef}>
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          onSelect={(id) => {
            selectNote(id);
            closeDrawer();
          }}
          onCreate={() => {
            setStorageError(undefined);
            createNote().catch(reportFailure('新增筆記失敗，請再試一次。', 'Failed to create note'));
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
          <ActionBar />
        </header>
        <Banner />
        <Toolbar editor={editor} />
        <div className="oc-document">
          <TitleInput
            value={activeNote.title}
            onChange={(title) => updateActive({ title })}
            onEnter={() => editor.commands.focus('start')}
          />
          <Editor editor={editor} />
        </div>
      </main>

      {storageError && (
        <StorageAlert message={storageError} onDismiss={() => setStorageError(undefined)} />
      )}
    </div>
  );
}
