import React from 'react';
import { useI18n } from '@/lib/i18n';

export type SectionId =
  | 'basic'
  | 'education'
  | 'experience'
  | 'achievements'
  | 'skills'
  | 'jobPreference'
  | 'supplemental'
  | 'savedPages';

interface SidebarProps {
  active: SectionId;
  onChange: (id: SectionId) => void;
  /** Override default width class (default: "w-28") */
  className?: string;
}

export default function Sidebar({ active, onChange, className }: SidebarProps) {
  const { t } = useI18n();

  const NAV_ITEMS = [
    { id: 'basic' as SectionId, label: t('nav.basic') },
    { id: 'education' as SectionId, label: t('nav.education') },
    { id: 'experience' as SectionId, label: '经历履历' },
    { id: 'achievements' as SectionId, label: '成果荣誉' },
    { id: 'skills' as SectionId, label: t('nav.skills') },
    { id: 'jobPreference' as SectionId, label: t('nav.jobPreference') },
    { id: 'supplemental' as SectionId, label: '补充信息' },
    { id: 'savedPages' as SectionId, label: t('nav.savedPages') },
  ];

  return (
    <div className={`${className ?? 'w-28'} flex flex-col border border-[var(--sk-border)] bg-white shrink-0 rounded-[28px] shadow-[0_16px_42px_rgba(15,23,42,0.08)] overflow-hidden`}>
      <div className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`w-full text-left px-3 py-2.5 text-xs font-semibold rounded-2xl transition-colors
              ${active === item.id
                ? 'bg-[var(--sk-primary)] text-white'
                : 'text-[var(--sk-muted)] hover:bg-[#f8fbff] hover:text-[var(--sk-text)]'
              }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
