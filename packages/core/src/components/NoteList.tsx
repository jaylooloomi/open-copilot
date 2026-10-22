import type { Note } from '@oc/shared';
import { Plus, Trash } from 'lucide-react';
import { displayTitle } from '../notes/noteStore';

export interface NoteListProps {
  /** Already sorted newest first. */
  notes: Note[];
  activeId: string | undefined;
  onSelect(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function NoteList({ notes, activeId, onSelect, onCreate, onDelete }: NoteListProps) {
  return (
    <nav className="oc-notelist" aria-label="筆記">
      <div className="oc-notelist-header">
        <h2>筆記</h2>
        <button
          type="button"
          className="oc-icon-btn"
          aria-label="新增筆記"
          title="新增筆記"
          onClick={onCreate}
        >
          <Plus size={18} />
        </button>
      </div>
      <ul className="oc-notelist-items" aria-label="筆記清單">
        {notes.map((note) => {
          const title = displayTitle(note);
          const active = note.id === activeId;
          return (
            <li key={note.id} className={active ? 'oc-note-item is-active' : 'oc-note-item'}>
              <button
                type="button"
                className="oc-note-select"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(note.id)}
              >
                <span className="oc-note-title">{title}</span>
                <time className="oc-note-time" dateTime={new Date(note.updatedAt).toISOString()}>
                  {timeFormat.format(note.updatedAt)}
                </time>
              </button>
              <button
                type="button"
                className="oc-note-delete"
                aria-label={`刪除「${title}」`}
                title="刪除"
                onClick={() => onDelete(note.id)}
              >
                <Trash size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
