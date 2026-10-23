export interface Swatch {
  /** zh-TW name, used as the button's accessible name. */
  name: string;
  value: string;
}

export const TEXT_COLORS: readonly Swatch[] = [
  { name: '黑色', value: '#111827' },
  { name: '灰色', value: '#6b7280' },
  { name: '紅色', value: '#dc2626' },
  { name: '橙色', value: '#ea580c' },
  { name: '黃色', value: '#ca8a04' },
  { name: '綠色', value: '#16a34a' },
  { name: '藍色', value: '#2563eb' },
  { name: '紫色', value: '#9333ea' },
];

export const HIGHLIGHT_COLORS: readonly Swatch[] = [
  { name: '黃色', value: '#fef08a' },
  { name: '綠色', value: '#bbf7d0' },
  { name: '藍色', value: '#bfdbfe' },
  { name: '粉紅色', value: '#fbcfe8' },
  { name: '紫色', value: '#e9d5ff' },
  { name: '橙色', value: '#fed7aa' },
  { name: '紅色', value: '#fecaca' },
  { name: '灰色', value: '#e5e7eb' },
];
