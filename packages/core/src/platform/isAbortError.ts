/**
 * A FileSaver rejects with an AbortError when the user cancels its dialog (M2 convention): the
 * desktop save dialog and the Android share sheet. A cancel is not a failure.
 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
