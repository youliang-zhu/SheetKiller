import React, { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface ArraySectionProps<T> {
  items: T[];
  onUpdate: (items: T[]) => void;
  renderItem: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  createEmpty: () => T;
  getTitle: (item: T, index: number) => string;
}

export default function ArraySection<T>({
  items,
  onUpdate,
  renderItem,
  createEmpty,
  getTitle,
}: ArraySectionProps<T>) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(items.map((_, index) => index)),
  );

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set<number>();
      items.forEach((_, index) => {
        if (prev.has(index) || index >= prev.size) next.add(index);
      });
      return next;
    });
  }, [items.length]);

  const handleAdd = () => {
    const newItems = [...items, createEmpty()];
    onUpdate(newItems);
    setExpanded((prev) => new Set([...prev, newItems.length - 1]));
  };

  const handleDelete = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    onUpdate(newItems);
    setExpanded((prev) => {
      const next = new Set<number>();
      prev.forEach((itemIndex) => {
        if (itemIndex < index) next.add(itemIndex);
        if (itemIndex > index) next.add(itemIndex - 1);
      });
      return next;
    });
  };

  const handleChange = (index: number, patch: Partial<T>) => {
    const newItems = items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    onUpdate(newItems);
  };

  const toggleExpand = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="border border-slate-200 rounded-3xl bg-slate-50/70 overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white transition-colors"
            onClick={() => toggleExpand(index)}
          >
            <span className="text-sm font-semibold text-slate-800 truncate flex-1">
              {getTitle(item, index)}
            </span>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(index);
                }}
                className="text-slate-400 hover:text-rose-500 text-lg transition-colors"
                title={t('array.delete')}
              >
                ×
              </button>
              <span className="text-slate-400 text-xs" aria-hidden="true">
                {expanded.has(index) ? '^' : 'v'}
              </span>
            </div>
          </div>
          {expanded.has(index) && (
            <div className="px-4 pb-4 pt-3 border-t border-slate-200 bg-white">
              {renderItem(item, (patch) => handleChange(index, patch))}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="w-full py-3 text-xs font-semibold text-slate-500 border border-dashed border-slate-300 rounded-3xl hover:border-slate-500 hover:text-slate-950 transition-colors"
      >
        {t('array.add')}
      </button>
    </div>
  );
}
