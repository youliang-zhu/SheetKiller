import React, { useRef, useState } from 'react';
import { importResume } from '@/lib/storage/resume-store';
import { extractResumeFields, toResume } from '@/lib/import/resume-extractor';
import { extractTextFromPdf } from '@/lib/import/pdf-parser';
import { extractTextFromWord } from '@/lib/import/word-parser';
import { createEmptyResume } from '@/lib/storage/types';
import { useI18n } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'json' | 'resume';

interface Props {
  initialMode?: Mode;
  onClose: () => void;
  onImported: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportDialog({ initialMode = 'json', onClose, onImported }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetMessages() {
    setStatus('');
    setError('');
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function triggerFileInput() {
    resetMessages();
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset so the same file can be re-selected
    e.target.value = '';

    setLoading(true);
    resetMessages();

    try {
      if (mode === 'json') {
        await handleJsonFile(file);
      } else {
        await handleResumeFile(file);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('import.error.format'));
    } finally {
      setLoading(false);
    }
  }

  async function handleJsonFile(file: File) {
    const text = await file.text();
    await importResume(text);
    setStatus(`${t('import.success.json')}: "${file.name}"`);
    onImported();
  }

  async function handleResumeFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const arrayBuffer = await file.arrayBuffer();

    let text = '';
    if (ext === 'pdf') {
      text = await extractTextFromPdf(arrayBuffer);
    } else if (ext === 'docx' || ext === 'doc') {
      text = await extractTextFromWord(arrayBuffer);
    } else {
      throw new Error(t('import.error.format'));
    }

    if (!text.trim()) {
      throw new Error(t('import.error.format'));
    }

    const extracted = extractResumeFields(text);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const resumeName = extracted.basic.name || file.name.replace(/\.[^.]+$/, '');
    const resume = toResume(extracted, id, resumeName);

    // Build a complete Resume by merging with an empty template
    const base = createEmptyResume(id, resumeName);
    const fullResume = {
      ...base,
      basic: { ...base.basic, ...resume.basic },
      education: resume.education,
      skills: { ...base.skills, ...resume.skills },
    };

    await importResume(JSON.stringify(fullResume));
    setStatus(`${t('import.success.resume')}: "${file.name}"${extracted.basic.name ? ` (${extracted.basic.name})` : ''}`);
    onImported();
  }

  // ─── Accept string ──────────────────────────────────────────────────────────

  const acceptAttr = mode === 'json' ? '.json' : '.pdf,.doc,.docx';

  // ─── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
    >
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-96 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <span className="sk-display text-lg font-semibold text-slate-950">{t('import.title')}</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-950 text-lg leading-none transition-colors"
            aria-label={t('import.close')}
          >
            ×
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-2 pt-2">
          <button
            onClick={() => { setMode('json'); resetMessages(); }}
            className={`flex-1 rounded-t-2xl py-2 text-xs font-semibold transition-colors ${
              mode === 'json'
                ? 'bg-white text-slate-950 border border-b-white border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t('import.json')}
          </button>
          <button
            onClick={() => { setMode('resume'); resetMessages(); }}
            className={`flex-1 rounded-t-2xl py-2 text-xs font-semibold transition-colors ${
              mode === 'resume'
                ? 'bg-white text-slate-950 border border-b-white border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t('import.resume')}
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            {mode === 'json'
              ? t('import.json')
              : t('import.resume')}
          </p>

          {/* Drop / click area */}
          <button
            onClick={triggerFileInput}
            disabled={loading}
            className={`w-full border border-dashed border-slate-300 rounded-3xl bg-slate-50 py-8 text-xs text-slate-500
              hover:border-slate-500 hover:text-slate-950 transition-colors
              ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {loading ? t('import.parsing') : t('import.click')}
          </button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttr}
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Status */}
          {status && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-2xl px-3 py-2">
              {status}
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-2xl px-3 py-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
