import { useState } from 'react';
import React from 'react';

// ─── Base field styles ────────────────────────────────────────────────────────

const inputBase =
  'w-full bg-white border border-slate-300 rounded-2xl px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-900/10 transition-colors';

const labelBase = 'block text-xs font-semibold text-slate-600 mb-1.5';

// ─── FormField ────────────────────────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number' | 'textarea' | 'month';
  placeholder?: string;
  rows?: number;
}

export function FormField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  rows = 3,
}: FormFieldProps) {
  return (
    <div className="mb-4">
      <label className={labelBase}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          className={inputBase + ' resize-y'}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      ) : (
        <input
          type={type}
          className={inputBase}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ─── TagListField ─────────────────────────────────────────────────────────────

interface TagListFieldProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagListField({
  label,
  tags,
  onChange,
  placeholder,
}: TagListFieldProps) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  return (
    <div className="mb-4">
      <label className={labelBase}>{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, i) => (
          <span
            key={i}
            className="flex items-center gap-1 px-2.5 py-1 bg-sky-50 text-sky-800 border border-sky-100 rounded-full text-xs"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="text-sky-600 hover:text-rose-500 transition-colors leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className={inputBase}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </div>
  );
}
