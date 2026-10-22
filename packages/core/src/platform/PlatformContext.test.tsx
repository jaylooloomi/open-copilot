import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestPlatform } from '../test/memoryStorage';
import { PlatformProvider, usePlatform } from './PlatformContext';

function ShowCanPrint() {
  const platform = usePlatform();
  return <p>{platform.canPrint ? 'can print' : 'no print'}</p>;
}

describe('PlatformContext', () => {
  it('provides the platform to descendants', () => {
    const { platform } = createTestPlatform();
    render(
      <PlatformProvider platform={{ ...platform, canPrint: false }}>
        <ShowCanPrint />
      </PlatformProvider>,
    );
    expect(screen.getByText('no print')).toBeInTheDocument();
  });

  it('throws a clear error outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => usePlatform())).toThrow(
      'usePlatform must be used inside <PlatformProvider>',
    );
    vi.restoreAllMocks();
  });
});
