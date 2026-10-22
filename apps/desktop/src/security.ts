import { isAppUrl } from './appProtocol';

/** The parts of Electron's permission request details that the policy looks at. */
export interface PermissionDetails {
  requestingUrl?: string;
  mediaTypes?: readonly string[];
}

/**
 * Our own pages get the microphone (recording) and clipboard writes (「複製」); everything else,
 * including the camera and reading the clipboard, is denied.
 */
export function shouldGrantPermission(permission: string, details: PermissionDetails): boolean {
  if (!isAppUrl(details.requestingUrl ?? '')) return false;
  if (permission === 'media') return !(details.mediaTypes ?? []).includes('video');
  return permission === 'clipboard-sanitized-write';
}

/** Links that may be handed to the system browser instead of opening inside the app. */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
