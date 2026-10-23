/** localStorage key set once the user pressed 我知道了 on the AI privacy notice. */
export const AI_PRIVACY_KEY = 'oc.aiPrivacyAcknowledged';

export interface AiPrivacyStore {
  isAcknowledged(): boolean;
  acknowledge(): void;
}

/**
 * Whether the user has seen that notes are sent to Groq. Storage failures never throw: unreadable
 * storage shows the notice again, an unwritable one only logs.
 */
export const aiPrivacy: AiPrivacyStore = {
  isAcknowledged() {
    try {
      return localStorage.getItem(AI_PRIVACY_KEY) === '1';
    } catch {
      return false;
    }
  },
  acknowledge() {
    try {
      localStorage.setItem(AI_PRIVACY_KEY, '1');
    } catch (error) {
      console.error('Failed to remember the AI privacy notice', error);
    }
  },
};
