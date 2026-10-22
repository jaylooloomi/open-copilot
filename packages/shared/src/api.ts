export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const RATE_LIMIT_PER_MINUTE = 60;

export interface TranscribeResponse {
  seq: number;
  text: string;
}

export interface HealthResponse {
  ok: true;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'payload_too_large'
  | 'rate_limited'
  | 'bad_request'
  | 'upstream_error';

export interface ApiErrorBody {
  error: ApiErrorCode;
}
