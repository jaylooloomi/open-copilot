import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from './Banner';

describe('Banner', () => {
  it('shows the open-copilot recording tip', () => {
    render(<Banner />);
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent(
      '手動輸入累了？ 按「錄製」，open-copilot 幫你把語音轉成文字，你只需要專注思考。',
    );
    expect(banner.querySelector('strong')).toHaveTextContent('手動輸入累了？');
  });

  it('shows the tip without a button when no backup is due', () => {
    render(<Banner backupDue={false} onBackup={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent('手動輸入累了？');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reminds to back up and backs up from 立即備份', async () => {
    const onBackup = vi.fn();
    render(<Banner backupDue onBackup={onBackup} />);
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent('已超過 7 天沒有備份筆記');
    expect(banner).not.toHaveTextContent('手動輸入累了？');

    await userEvent.setup().click(within(banner).getByRole('button', { name: '立即備份' }));

    expect(onBackup).toHaveBeenCalledTimes(1);
  });

  it('disables 立即備份 while a backup cannot start', () => {
    render(<Banner backupDue backupDisabled onBackup={vi.fn()} />);
    expect(screen.getByRole('button', { name: '立即備份' })).toBeDisabled();
  });

  it('disables 立即備份 when no backup handler is wired', () => {
    render(<Banner backupDue />);
    expect(screen.getByRole('button', { name: '立即備份' })).toBeDisabled();
  });
});
