import { EMPTY_DOC } from '@oc/shared';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { ActionBar } from './components/ActionBar';
import { Banner } from './components/Banner';
import { NoteList } from './components/NoteList';
import { Editor } from './editor/Editor';
import { TitleInput } from './editor/TitleInput';
import { Toolbar } from './editor/Toolbar';
import { useNoteEditor } from './editor/useNoteEditor';
import { displayTitle } from './notes/noteStore';
import { useNotes } from './notes/useNotes';
import { usePlatform } from './platform/PlatformContext';
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const confirmDelete = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (window.confirm(`確定要刪除「${displayTitle(target)}」嗎？此動作無法復原。`)) {
      void deleteNote(id);
    }
  };

  return (
    <div className="oc-app" data-drawer-open={drawerOpen ? 'true' : 'false'}>
      <aside className="oc-sidebar" id="oc-sidebar">
        <NoteList
          notes={notes}
          activeId={activeNote.id}
          onSelect={(id) => {
            selectNote(id);
            closeDrawer();
          }}
          onCreate={() => {
            void createNote();
            closeDrawer();
          }}
          onDelete={confirmDelete}
        />
      </aside>
      {drawerOpen && <div className="oc-backdrop" aria-hidden="true" onClick={closeDrawer} />}

      <main className="oc-main">
        <header className="oc-topbar">
          <button
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
    </div>
  );
}
