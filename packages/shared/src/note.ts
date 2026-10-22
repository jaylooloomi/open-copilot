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

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
