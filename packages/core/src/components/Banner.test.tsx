import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
