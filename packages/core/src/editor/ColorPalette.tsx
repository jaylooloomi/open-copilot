import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import type { Swatch } from './palettes';

export interface ColorPaletteProps {
  label: string;
  icon: ReactNode;
  colors: readonly Swatch[];
  current: string | undefined;
  onPick(color: string): void;
  onClear(): void;
}

/**
 * Keyboard users may have tabbed into the popover; hand focus back to the toggle
 * before the popover unmounts so it does not fall to <body>. Mouse users keep focus
 * in the editor, and callbacks that already moved focus elsewhere are left alone.
 */
function keepFocusOnToggle(root: HTMLElement | null, toggle: HTMLElement | null) {
  const active = document.activeElement;
  if (active && active !== toggle && root?.contains(active)) toggle?.focus();
}

export function ColorPalette({ label, icon, colors, current, onPick, onClear }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      keepFocusOnToggle(rootRef.current, toggleRef.current);
      setOpen(false);
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
    keepFocusOnToggle(rootRef.current, toggleRef.current);
    setOpen(false);
  };

  // Close when keyboard focus leaves the palette (e.g. Tab past 清除). A null
  // relatedTarget means focus left the window or the focused node unmounted.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && next && !rootRef.current?.contains(next)) setOpen(false);
  };

  return (
    <div className="oc-palette" ref={rootRef} onBlur={onBlur}>
      <button
        ref={toggleRef}
        type="button"
        className="oc-tool"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="oc-palette-indicator" style={{ background: current ?? 'transparent' }} />
      </button>
      {open && (
        <div id={popoverId} className="oc-palette-popover" role="group" aria-label={`${label}色盤`}>
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
