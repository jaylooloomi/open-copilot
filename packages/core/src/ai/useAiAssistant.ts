import type { AiRequest } from '@oc/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createApiClient, type ApiClient } from '../api/apiClient';
import type { Settings } from '../settings/settingsStore';
import { aiErrorMessage } from './aiMessages';
import { aiPrivacy, type AiPrivacyStore } from './aiPrivacy';

export type AiKind = 'summary' | 'todos';

/** What the AI panel shows. `requestId` changes for every request, so the panel can be keyed on it. */
export type AiPanelState = { requestId: number } & (
  | { kind: AiKind; status: 'loading' }
  | { kind: 'summary'; status: 'done'; summary: string }
  | { kind: 'todos'; status: 'done'; items: string[] }
  | { kind: AiKind; status: 'error'; message: string }
);

export type AiClient = Pick<ApiClient, 'summarize' | 'todos'>;

/** Everything useAiAssistant touches outside React; tests replace these. */
export interface AiAssistantDeps {
  createClient(settings: Settings): AiClient;
  privacy: AiPrivacyStore;
}

export const defaultAiAssistantDeps: AiAssistantDeps = {
  createClient: (settings) => createApiClient({ baseUrl: settings.apiBaseUrl, accessKey: settings.accessKey }),
  privacy: aiPrivacy,
};

export interface UseAiAssistantOptions {
  settings: Settings;
  /** Called when the backend rejects the access key (401), e.g. to open the settings. */
  onUnauthorized?(): void;
  deps?: AiAssistantDeps;
}

export interface UseAiAssistantResult {
  /** The open AI panel, or null when it is closed. */
  panel: AiPanelState | null;
  /** The privacy notice must be shown; the request waits for acceptPrivacy(). */
  privacyPending: boolean;
  /** Opens the panel for `kind` with the note's title and text (after the privacy notice the first time). */
  request(kind: AiKind, input: AiRequest): void;
  /** Sends the last request again. */
  retry(): void;
  /** 我知道了: remembers the notice and sends the waiting request. */
  acceptPrivacy(): void;
  /** Closes the notice without sending anything. */
  cancelPrivacy(): void;
  /** Closes the panel (and the notice); a response still on its way is ignored. Stable across renders. */
  close(): void;
}

interface AiCall {
  kind: AiKind;
  input: AiRequest;
}

/** State and requests behind AI 摘要 and 待辦事項. Only the latest request may update the panel. */
export function useAiAssistant({
  settings,
  onUnauthorized,
  deps = defaultAiAssistantDeps,
}: UseAiAssistantOptions): UseAiAssistantResult {
  const [panel, setPanel] = useState<AiPanelState | null>(null);
  const [pending, setPending] = useState<AiCall | null>(null);
  const requestId = useRef(0);
  const lastCall = useRef<AiCall | null>(null);

  // After unmount no response may set state.
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const run = ({ kind, input }: AiCall) => {
    const id = ++requestId.current;
    lastCall.current = { kind, input };
    setPanel({ requestId: id, kind, status: 'loading' });
    const client = deps.createClient(settings);
    const result: Promise<AiPanelState> =
      kind === 'summary'
        ? client
            .summarize(input)
            .then(({ summary }): AiPanelState => ({ requestId: id, kind: 'summary', status: 'done', summary }))
        : client
            .todos(input)
            .then(({ items }): AiPanelState => ({ requestId: id, kind: 'todos', status: 'done', items }));
    result.then(
      (next) => {
        if (requestId.current === id) setPanel(next);
      },
      (error: unknown) => {
        if (requestId.current !== id) return;
        console.error('AI request failed', error);
        setPanel({ requestId: id, kind, status: 'error', message: aiErrorMessage(error) });
        if (error instanceof ApiError && error.status === 401) onUnauthorized?.();
      },
    );
  };

  const close = useCallback(() => {
    requestId.current += 1;
    setPanel(null);
    setPending(null);
  }, []);

  return {
    panel,
    privacyPending: pending !== null,
    request(kind, input) {
      if (deps.privacy.isAcknowledged()) run({ kind, input });
      else setPending({ kind, input });
    },
    retry() {
      if (lastCall.current) run(lastCall.current);
    },
    acceptPrivacy() {
      if (!pending) return;
      deps.privacy.acknowledge();
      setPending(null);
      run(pending);
    },
    cancelPrivacy() {
      setPending(null);
    },
    close,
  };
}
