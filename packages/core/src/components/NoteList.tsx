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
  /** While recording, notes cannot be created, switched or deleted. */
  disabled?: boolean;
}

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function NoteList({
  notes,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  disabled = false,
}: NoteListProps) {
  return (
    <nav className="oc-notelist" aria-label="筆記">
      <div className="oc-notelist-header">
        <h2>筆記</h2>
        <button
          type="button"
          className="oc-icon-btn"
          aria-label="新增筆記"
          title="新增筆記"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus size={18} />
        </button>
      </div>
      <ul className="oc-notelist-items" aria-label="筆記清單">
        {notes.map((note) => {
          const title = displayTitle(note);
          const active = note.id === activeId;
          const updated = new Date(note.updatedAt);
          // An out-of-range timestamp (e.g. from an imported file) must not take the list down.
          const hasTime = Number.isFinite(updated.getTime());
          return (
            <li key={note.id} className={active ? 'oc-note-item is-active' : 'oc-note-item'}>
              <button
                type="button"
                className="oc-note-select"
                aria-current={active ? 'true' : undefined}
                disabled={disabled}
                onClick={() => onSelect(note.id)}
              >
                <span className="oc-note-title">{title}</span>
                {/* Keeps the button's accessible name "title time", not "titletime", whatever the CSS. */}
                {' '}
                {hasTime && (
                  <time className="oc-note-time" dateTime={updated.toISOString()}>
                    {timeFormat.format(updated)}
                  </time>
                )}
              </button>
              <button
                type="button"
                className="oc-note-delete"
                aria-label={`刪除「${title}」`}
                title={`刪除「${title}」`}
                disabled={disabled}
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
