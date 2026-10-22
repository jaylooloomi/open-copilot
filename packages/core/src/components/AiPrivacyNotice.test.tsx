import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AI_PRIVACY_TEXT, AiPrivacyNotice } from './AiPrivacyNotice';

function setup() {
  const onAccept = vi.fn();
  const onCancel = vi.fn();
  const view = render(<AiPrivacyNotice onAccept={onAccept} onCancel={onCancel} />);
  return { ...view, onAccept, onCancel, user: userEvent.setup() };
}

describe('AiPrivacyNotice', () => {
  it('says the note is sent to Groq and focuses 我知道了', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'AI 功能說明' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(AI_PRIVACY_TEXT.body);
    expect(AI_PRIVACY_TEXT.body).toContain('筆記內容會送到 Groq 處理');
    expect(screen.getByRole('button', { name: '我知道了' })).toHaveFocus();
  });

  it('accepts with 我知道了', async () => {
    const { user, onAccept, onCancel } = setup();
    await user.click(screen.getByRole('button', { name: '我知道了' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with 取消 and with Escape', async () => {
    const { user, onCancel, onAccept } = setup();
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = setup();
    await user.tab();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '我知道了' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('gives focus back to the button that opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = setup();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
