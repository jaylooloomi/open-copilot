import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from './useSettings';

afterEach(() => {
  localStorage.clear();
});

describe('useSettings', () => {
  it('starts from what is stored', () => {
    localStorage.setItem('oc.settings', JSON.stringify({ apiBaseUrl: 'https://a.test', accessKey: 'k' }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual({ apiBaseUrl: 'https://a.test', accessKey: 'k' });
  });

  it('saves, normalises and re-renders with the new settings', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual({ apiBaseUrl: '', accessKey: '' });

    act(() => result.current.saveSettings({ apiBaseUrl: 'https://b.test/ ', accessKey: ' k2 ' }));

    expect(result.current.settings).toEqual({ apiBaseUrl: 'https://b.test', accessKey: 'k2' });
    expect(JSON.parse(localStorage.getItem('oc.settings') ?? '')).toEqual({
      apiBaseUrl: 'https://b.test',
      accessKey: 'k2',
    });
  });
});
