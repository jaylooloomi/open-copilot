export interface TitleInputProps {
  value: string;
  onChange(value: string): void;
  /** Called on Enter (not while composing Chinese input), e.g. to move focus to the body. */
  onEnter?(): void;
}

export function TitleInput({ value, onChange, onEnter }: TitleInputProps) {
  return (
    <input
      type="text"
      className="oc-title"
      aria-label="標題"
      placeholder="請輸入標題.."
      enterKeyHint="next"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Safari fires the IME-confirming Enter after compositionend with keyCode 229.
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}
