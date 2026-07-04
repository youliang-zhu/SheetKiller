import React from 'react';
import type { CustomField } from '@/lib/storage/types';
import { useI18n } from '@/lib/i18n';

interface CustomFieldsProps {
  data: CustomField[];
  onChange: (items: CustomField[]) => void;
}

const inputBase =
  'bg-white border border-slate-300 rounded-2xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-900/10 transition-colors';

export default function CustomFieldsSection({ data, onChange }: CustomFieldsProps) {
  const { t } = useI18n();

  const handleAdd = () => {
    onChange([...data, { key: '', value: '' }]);
  };

  const handleDelete = (index: number) => {
    onChange(data.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof CustomField, value: string) => {
    onChange(
      data.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  };

  return (
    <div>
      {data.length > 0 && (
        <div className="mb-2 grid grid-cols-[7rem_1fr_1.5rem] gap-2 px-1 text-xs font-semibold text-slate-500">
          <span>{t('custom.key')}</span>
          <span>{t('custom.value')}</span>
          <span />
        </div>
      )}
      <div className="space-y-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              className={inputBase + ' w-28 shrink-0'}
              value={item.key}
              onChange={(e) => handleChange(index, 'key', e.target.value)}
            />
            <input
              type="text"
              className={inputBase + ' flex-1'}
              value={item.value}
              onChange={(e) => handleChange(index, 'value', e.target.value)}
            />
            <button
              type="button"
              onClick={() => handleDelete(index)}
              className="text-slate-400 hover:text-rose-500 text-lg leading-none transition-colors shrink-0"
              title={t('array.delete')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-3 w-full py-3 text-xs font-semibold text-slate-500 border border-dashed border-slate-300 rounded-3xl hover:border-slate-500 hover:text-slate-950 transition-colors"
      >
        {t('custom.add')}
      </button>
    </div>
  );
}
