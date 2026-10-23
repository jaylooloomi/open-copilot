import { Converter } from 'opencc-js';

// 建一次即可重複使用；cn = 簡體中文（中國大陸），tw = 繁體中文（台灣）。
const convertCnToTw = Converter({ from: 'cn', to: 'tw' });

export function toTraditional(text: string): string {
  return convertCnToTw(text);
}
