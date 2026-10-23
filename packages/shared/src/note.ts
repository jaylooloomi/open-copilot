export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[];
  text?: string;
  [key: string]: any;
}

export interface Note {
  id: string;
  title: string;
  content: JSONContent;
  createdAt: number;
  updatedAt: number;
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  Object.freeze(value);
  return value;
}

// Every importer shares this one object, so it is frozen all the way down: an accidental
// in-place edit throws instead of silently changing every new note. Copy it first
// (structuredClone) wherever the result may be mutated.
export const EMPTY_DOC: JSONContent = deepFreeze({ type: 'doc', content: [{ type: 'paragraph' }] });
