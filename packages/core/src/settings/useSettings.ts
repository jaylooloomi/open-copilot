import { useCallback, useState } from 'react';
import { loadSettings, normalizeSettings, saveSettings as persist, type Settings } from './settingsStore';

export interface UseSettingsResult {
  settings: Settings;
  saveSettings(next: Settings): void;
}

/** Settings from localStorage (`oc.settings`) as React state. */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const saveSettings = useCallback((next: Settings) => {
    const normalized = normalizeSettings(next);
    persist(normalized);
    setSettings(normalized);
  }, []);
  return { settings, saveSettings };
}
