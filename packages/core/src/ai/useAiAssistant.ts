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
  /**
   * Opens the panel for `kind` with the note's title and text (after the privacy notice the first time).
   * 重試 calls it again with the note as it is now, so there is no separate retry.
   */
  request(kind: AiKind, input: AiRequest): void;
  /** 我知道了: remembers the notice and sends the waiting request. */
  acceptPrivacy(): void;
  /** Closes the notice without sending anything. */
  cancelPrivacy(): void;
  /** Closes the panel (and the notice) and cancels a request still on its way. Stable across renders. */
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
  const [pending, setPendingState] = useState<AiCall | null>(null);
  // Mirrors `pending` so two calls before a re-render cannot both send the waiting request.
  const pendingRef = useRef<AiCall | null>(null);
  const requestId = useRef(0);
  // Cancels the running request, so a closed panel does not keep spending the backend's AI quota.
  const inFlight = useRef<AbortController | null>(null);

  /** Makes any running request stale and cancels it. */
  const cancelRunning = useCallback(() => {
    requestId.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const setPending = useCallback((call: AiCall | null) => {
    pendingRef.current = call;
    setPendingState(call);
  }, []);

  // After unmount no response may set state, and the running request is cancelled.
  useEffect(() => cancelRunning, [cancelRunning]);

  const run = ({ kind, input }: AiCall) => {
    cancelRunning();
    const id = requestId.current;
    const controller = new AbortController();
    inFlight.current = controller;
    const options = { signal: controller.signal };
    setPanel({ requestId: id, kind, status: 'loading' });
    const client = deps.createClient(settings);
    const result: Promise<AiPanelState> =
      kind === 'summary'
        ? client
            .summarize(input, options)
            .then(({ summary }): AiPanelState => ({ requestId: id, kind: 'summary', status: 'done', summary }))
        : client
            .todos(input, options)
            .then(({ items }): AiPanelState => ({ requestId: id, kind: 'todos', status: 'done', items }));
    result.then(
      (next) => {
        if (requestId.current !== id) return;
        inFlight.current = null;
        setPanel(next);
      },
      (error: unknown) => {
        if (requestId.current !== id) return;
        inFlight.current = null;
        console.error('AI request failed', error);
        setPanel({ requestId: id, kind, status: 'error', message: aiErrorMessage(error) });
        if (error instanceof ApiError && error.status === 401) onUnauthorized?.();
      },
    );
  };

  const close = useCallback(() => {
    cancelRunning();
    setPanel(null);
    setPending(null);
  }, [cancelRunning, setPending]);

  return {
    panel,
    privacyPending: pending !== null,
    request(kind, input) {
      if (deps.privacy.isAcknowledged()) run({ kind, input });
      else setPending({ kind, input });
    },
    acceptPrivacy() {
      const call = pendingRef.current;
      if (!call) return;
      deps.privacy.acknowledge();
      setPending(null);
      run(call);
    },
    cancelPrivacy() {
      setPending(null);
    },
    close,
  };
}
