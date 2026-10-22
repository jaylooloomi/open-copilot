import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupControls, type BackupControlsProps } from './BackupControls';

function setup(props: Partial<BackupControlsProps> = {}) {
  const handlers = { onBackup: vi.fn(), onImportFile: vi.fn() };
  render(<BackupControls disabled={false} message={undefined} {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
}

const fileInput = () => screen.getByLabelText<HTMLInputElement>('選擇備份檔');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BackupControls', () => {
  it('backs up from the 備份 button', async () => {
    const { user, onBackup } = setup();
    await user.click(screen.getByRole('button', { name: '備份' }));
    expect(onBackup).toHaveBeenCalledTimes(1);
  });

  it('opens a file picker for JSON files from the 匯入 button', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { user } = setup();
    expect(fileInput()).toHaveAttribute('type', 'file');
    expect(fileInput()).toHaveAttribute('accept', 'application/json,.json');

    await user.click(screen.getByRole('button', { name: '匯入' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(fileInput());
  });

  it('hands the chosen file over and clears the picker so the same file can be chosen again', () => {
    const { onImportFile } = setup();
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });

    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(onImportFile).toHaveBeenCalledWith(file);
    expect(fileInput().value).toBe('');
  });

  it('disables both buttons while disabled', () => {
    setup({ disabled: true });
    expect(screen.getByRole('button', { name: '備份' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '匯入' })).toBeDisabled();
  });

  it('shows the last result as a status message only when there is one', () => {
    const handlers = { onBackup: vi.fn(), onImportFile: vi.fn() };
    const { rerender } = render(<BackupControls disabled={false} message={undefined} {...handlers} />);
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<BackupControls disabled={false} message="已匯入 2 篇，略過 1 篇（本機版本較新）" {...handlers} />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('已匯入 2 篇，略過 1 篇（本機版本較新）');
  });
});
