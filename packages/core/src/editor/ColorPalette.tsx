import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Swatch } from './palettes';

export interface ColorPaletteProps {
  label: string;
  icon: ReactNode;
  colors: readonly Swatch[];
  current: string | undefined;
  onPick(color: string): void;
  onClear(): void;
}

export function ColorPalette({ label, icon, colors, current, onPick, onClear }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div className="oc-palette" ref={rootRef}>
      <button
        type="button"
        className="oc-tool"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="oc-palette-indicator" style={{ background: current ?? 'transparent' }} />
      </button>
      {open && (
        <div className="oc-palette-popover" role="group" aria-label={`${label}色盤`}>
          {colors.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              className="oc-swatch"
              aria-label={swatch.name}
              title={swatch.name}
              aria-pressed={current === swatch.value}
              style={{ background: swatch.value }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(() => onPick(swatch.value))}
            />
          ))}
          <button
            type="button"
            className="oc-palette-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(onClear)}
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}
