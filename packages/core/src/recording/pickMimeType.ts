/** Tried in order; Chrome/Edge/Android record webm/opus, Safari/iOS records mp4. */
export const MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4'] as const;

/** First supported recording format, or undefined to let MediaRecorder choose. */
export function pickMimeType(
  isSupported: (type: string) => boolean = defaultIsSupported,
): string | undefined {
  return MIME_TYPE_CANDIDATES.find((type) => isSupported(type));
}

/** File extension for an uploaded segment. */
export function extensionFor(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('audio/mp4') ? 'mp4' : 'webm';
}

function defaultIsSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
}
