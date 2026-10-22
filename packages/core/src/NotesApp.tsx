import { EMPTY_DOC } from '@oc/shared';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

/** Same breakpoint as the drawer rules in styles/app.css. */
const DRAWER_MEDIA_QUERY = '(max-width: 767.98px)';

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
  const [storageError, setStorageError] = useState<string | undefined>(undefined);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);

  // Called unconditionally (rules of hooks); recreated whenever the active note changes.
  const editor = useNoteEditor({
    noteId: activeNote?.id,
    content: activeNote?.content ?? EMPTY_DOC,
    onChange: (content) => updateActive({ content }),
  });

  // The open drawer covers the page and <main> is inert: put focus inside the drawer, and when
  // it closes hand focus back to the menu button instead of leaving it on a hidden element.
  useEffect(() => {
    const wasOpen = drawerWasOpen.current;
    drawerWasOpen.current = drawerOpen;
    const sidebar = sidebarRef.current;
    if (drawerOpen && !wasOpen) {
      const target =
        sidebar?.querySelector<HTMLElement>('[aria-current="true"]') ??
        sidebar?.querySelector<HTMLElement>('button');
      target?.focus();
    } else if (!drawerOpen && wasOpen) {
      const active = document.activeElement;
      if (!active || active === document.body || sidebar?.contains(active)) {
        menuButtonRef.current?.focus();
      }
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // The drawer only exists on narrow screens: if the window grows past the breakpoint while it
  // is open, close it so <main> does not stay inert next to the regular sidebar.
  useEffect(() => {
    if (!drawerOpen || typeof window.matchMedia !== 'function') return;
    const narrow = window.matchMedia(DRAWER_MEDIA_QUERY);
    const closeIfWide = () => {
      if (!narrow.matches) setDrawerOpen(false);
    };
    closeIfWide();
    narrow.addEventListener('change', closeIfWide);
    return () => narrow.removeEventListener('change', closeIfWide);
  }, [drawerOpen]);

  if (loading || !activeNote) {
    return (
      <div className="oc-loading" role="status">
        載入中…
      </div>
    );
  }

  const closeDrawer = () => setDrawerOpen(false);

  // useNotes rolls a failed delete back and rejects; a failed create rejects without adding
  // the note. Either way the user has to be told, and the rejection must not go unhandled.
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
            關閉
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
        // Outside <main> so it is not inert, and above the drawer, since a delete fails there.
        <div className="oc-storage-alert" role="alert">
          <p>{storageError}</p>
          <button
            type="button"
            className="oc-alert-dismiss"
            aria-label="關閉錯誤訊息"
            title="關閉錯誤訊息"
            onClick={() => setStorageError(undefined)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
