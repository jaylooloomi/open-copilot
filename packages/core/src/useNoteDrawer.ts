import { useEffect, useRef, useState } from 'react';

/** Same breakpoint as the drawer rules in styles/app.css. */
export const DRAWER_MEDIA_QUERY = '(max-width: 767.98px)';

/**
 * Open state of the narrow-screen note drawer, plus the keyboard handling it needs: while it is
 * open the page behind it is inert, so focus moves into the drawer, Escape closes it, focus goes
 * back to the menu button when it closes, and it closes itself once the window is wide again.
 * Attach `sidebarRef` to the drawer and `menuButtonRef` to the button that toggles it.
 */
export function useNoteDrawer() {
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // Put focus inside the drawer when it opens; when it closes, hand focus back to the menu
  // button instead of leaving it on a hidden element.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    const sidebar = sidebarRef.current;
    if (open && !wasOpen) {
      const target =
        sidebar?.querySelector<HTMLElement>('[aria-current="true"]') ??
        sidebar?.querySelector<HTMLElement>('button');
      target?.focus();
    } else if (!open && wasOpen) {
      const active = document.activeElement;
      if (!active || active === document.body || sidebar?.contains(active)) {
        menuButtonRef.current?.focus();
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // The drawer only exists on narrow screens: if the window grows past the breakpoint while it
  // is open, close it so the page does not stay inert next to the regular sidebar.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const narrow = window.matchMedia(DRAWER_MEDIA_QUERY);
    const closeIfWide = () => {
      if (!narrow.matches) setOpen(false);
    };
    closeIfWide();
    narrow.addEventListener('change', closeIfWide);
    return () => narrow.removeEventListener('change', closeIfWide);
  }, [open]);

  return { open, setOpen, sidebarRef, menuButtonRef };
}
