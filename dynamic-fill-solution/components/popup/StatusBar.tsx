import React from 'react';
import type { Resume } from '@/lib/storage/types';
import { useI18n } from '@/lib/i18n';
import { countFields } from '@/lib/storage/resume-utils';

interface StatusBarProps {
  resume: Resume | null;
  onImport: () => void;
  onExport: () => void;
}

export default function StatusBar({ resume, onImport, onExport }: StatusBarProps) {
  const { t } = useI18n();

  if (!resume) {
    return (
      <div className="flex items-center justify-between px-4 py-3 border border-[var(--sk-border)] bg-white rounded-3xl shadow-[0_16px_42px_rgba(15,23,42,0.08)] shrink-0">
        <span className="text-xs text-[var(--sk-muted)]">{t('popup.noResume')}</span>
        <div className="flex gap-2">
          <button
            onClick={onImport}
            className="px-3 py-2 text-xs font-semibold bg-[var(--sk-primary)] text-white rounded-full hover:bg-[var(--sk-primary-hover)] transition-colors"
          >
            {t('status.import')}
          </button>
        </div>
      </div>
    );
  }

  const { filled, total } = countFields(resume);
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  const barColor = pct >= 80 ? 'bg-[var(--sk-success)]' : pct >= 40 ? 'bg-[var(--sk-primary)]' : 'bg-[var(--sk-warning)]';

  return (
    <div className="flex items-center justify-between px-4 py-3 border border-[var(--sk-border)] bg-white/95 backdrop-blur rounded-3xl shadow-[0_16px_42px_rgba(15,23,42,0.08)] shrink-0 gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs font-semibold text-[var(--sk-muted)] shrink-0 whitespace-nowrap">
          {t('popup.progress', { filled, total, pct })}
        </span>
        <div className="flex-1 max-w-[180px] h-2 bg-[#edf2f8] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onImport}
          className="px-3 py-2 text-xs font-semibold bg-white text-[var(--sk-muted)] border border-[var(--sk-border)] rounded-full hover:bg-[#f8fbff] hover:text-[var(--sk-text)] transition-colors"
        >
          {t('status.import')}
        </button>
        <button
          onClick={onExport}
          className="px-3 py-2 text-xs font-semibold bg-white text-[var(--sk-muted)] border border-[var(--sk-border)] rounded-full hover:bg-[#f8fbff] hover:text-[var(--sk-text)] transition-colors"
        >
          {t('status.export')}
        </button>
      </div>
    </div>
  );
}
