import { Lock, Mic } from 'lucide-react';

export const AI_FEATURES = ['AI 摘要', '待辦事項', 'AI 助理', 'AI 對話'] as const;

export function ActionBar() {
  return (
    <div className="oc-actionbar">
      <button type="button" className="oc-record-btn" disabled title="即將推出">
        <Mic size={18} aria-hidden="true" />
        <span>錄製</span>
      </button>
      <div className="oc-ai-group">
        {AI_FEATURES.map((label) => (
          <button
            key={label}
            type="button"
            className="oc-ai-btn"
            disabled
            aria-disabled="true"
            title="即將推出"
          >
            <Lock size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
