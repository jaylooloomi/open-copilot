import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StorageAlert } from './StorageAlert';

describe('StorageAlert', () => {
  it('announces the message and can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<StorageAlert message="刪除筆記失敗，請再試一次。" onDismiss={onDismiss} />);

    expect(screen.getByRole('alert')).toHaveTextContent('刪除筆記失敗，請再試一次。');
    await userEvent.click(screen.getByRole('button', { name: '關閉錯誤訊息' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
