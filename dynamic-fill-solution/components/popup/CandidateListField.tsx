// components/popup/CandidateListField.tsx
import React, { useState } from 'react';
import type { FieldCandidate } from '@/lib/capture/candidate';
import { useI18n } from '@/lib/i18n';

export interface CandidateListFieldProps {
  label: string;
  candidates: FieldCandidate[];
  pinnedId: string | null;
  domainPrefs: Record<string, string>;
  valueInputPlaceholder: string;
  onAdd: (value: string, label: string) => void;
  onUpdate: (id: string, value: string, label: string) => void;
  onDelete: (id: string) => void;
  onSetPin: (id: string | null) => void;
  onClearDomainPref: (domain: string) => void;
}

/** Tiebreak sort matching resolveCandidate's step 3-5 (no domain context). */
function pickDefault(candidates: FieldCandidate[], pinnedId: string | null): FieldCandidate | null {
  if (candidates.length === 0) return null;
  if (pinnedId) {
    const p = candidates.find((c) => c.id === pinnedId);
    if (p) return p;
  }
  return [...candidates].sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.createdAt - b.createdAt;
  })[0];
}

export default function CandidateListField({
  label, candidates, pinnedId, domainPrefs,
  valueInputPlaceholder,
  onAdd, onUpdate, onDelete, onSetPin, onClearDomainPref,
}: CandidateListFieldProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editLabel, setEditLabel] = useState('');

  const def = pickDefault(candidates, pinnedId);

  const resetAdd = () => { setAdding(false); setAddValue(''); setAddLabel(''); };
  const submitAdd = () => {
    if (!addValue.trim()) return;
    onAdd(addValue.trim(), addLabel.trim());
    resetAdd();
  };
  const beginEdit = (c: FieldCandidate) => {
    setEditingId(c.id);
    setEditValue(c.value);
    setEditLabel(c.label ?? '');
  };
  const submitEdit = (id: string) => {
    if (!editValue.trim()) return;
    onUpdate(id, editValue.trim(), editLabel.trim());
    setEditingId(null);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-600">{label}</label>
        {!adding && (
          <button
            className="text-xs font-semibold text-slate-600 hover:text-slate-950"
            onClick={() => setAdding(true)}
          >
            {t('profile.candidate.add')}
          </button>
        )}
      </div>

      {candidates.length === 0 && !adding && (
        <div className="text-xs text-slate-400 italic">
          {t('profile.candidate.noCandidates')}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-1 bg-slate-50 border border-slate-200 rounded-3xl p-2">
          {candidates.map((c) => {
            const isEditing = editingId === c.id;
            const isDefault = def?.id === c.id;
            const isPinned = pinnedId === c.id;
            return (
              <div key={c.id} className="flex items-start gap-2 text-xs py-1.5 px-1">
                {!isEditing && (
                  <span className="text-slate-400 mt-0.5">{isDefault ? '●' : '○'}</span>
                )}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-1">
                      <input
                        className="w-full bg-white border border-slate-300 rounded-2xl px-3 py-2"
                        value={editValue} onChange={(e) => setEditValue(e.target.value)}
                        placeholder={valueInputPlaceholder}
                      />
                      <input
                        className="w-full bg-white border border-slate-300 rounded-2xl px-3 py-2"
                        value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                        placeholder={t('profile.candidate.labelPlaceholder')}
                      />
                      <div className="flex gap-2">
                        <button className="text-slate-900 font-semibold" onClick={() => submitEdit(c.id)}>
                          {t('profile.candidate.save')}
                        </button>
                        <button className="text-slate-500" onClick={() => setEditingId(null)}>
                          {t('profile.candidate.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-slate-900 break-all">{c.value}</div>
                      {c.label && <div className="text-slate-500">{c.label}</div>}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex gap-2 shrink-0 text-slate-400">
                    <button
                      title={isPinned ? 'Unpin' : 'Pin'}
                      onClick={() => onSetPin(isPinned ? null : c.id)}
                    >{isPinned ? '★' : '☆'}</button>
                    <button title="Edit" onClick={() => beginEdit(c)}>✎</button>
                    <button
                      title="Delete"
                      onClick={() => onDelete(c.id)}
                      className="text-rose-500 hover:text-rose-600"
                    >🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <div className="mt-1 space-y-2 bg-slate-50 border border-slate-200 rounded-3xl p-3">
          <input
            className="w-full bg-white border border-slate-300 rounded-2xl px-3 py-2 text-xs"
            value={addValue} onChange={(e) => setAddValue(e.target.value)}
            placeholder={valueInputPlaceholder}
            autoFocus
          />
          <input
            className="w-full bg-white border border-slate-300 rounded-2xl px-3 py-2 text-xs"
            value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
            placeholder={t('profile.candidate.labelPlaceholder')}
          />
          <div className="flex gap-2 text-xs">
            <button className="text-slate-900 font-semibold" onClick={submitAdd}>
              {t('profile.candidate.save')}
            </button>
            <button className="text-slate-500" onClick={resetAdd}>
              {t('profile.candidate.cancel')}
            </button>
          </div>
        </div>
      )}

      {Object.keys(domainPrefs).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200 text-xs">
          <div className="text-slate-500 mb-1">{t('candidate.dashboard.domainOverrides')}</div>
          <div className="space-y-1">
            {Object.entries(domainPrefs).map(([domain, candidateId]) => {
              const c = candidates.find((x) => x.id === candidateId);
              return (
                <div key={domain} className="flex items-center justify-between">
                  <span className="text-slate-700">
                    {domain} → {c ? (c.label ? `${c.value} (${c.label})` : c.value) : '(missing)'}
                  </span>
                  <button
                    className="text-rose-500 hover:text-rose-600"
                    title="Clear"
                    onClick={() => onClearDomainPref(domain)}
                  >🗑</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
