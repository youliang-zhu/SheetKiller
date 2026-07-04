import React, { useEffect, useState } from 'react';
import type { Settings } from '@/lib/storage/types';
import { getSettings } from '@/lib/storage/settings-store';
import { useI18n } from '@/lib/i18n';
import { AI_PROVIDER_DEFAULTS } from '@/lib/ai/provider-defaults';

export type ProfileEditorMode = 'manual' | 'import' | 'ai';

interface ProfileModeWorkbenchProps {
  mode: ProfileEditorMode;
  saveStatus: 'idle' | 'saving' | 'saved';
  reviewCount: number;
  onModeChange: (mode: ProfileEditorMode) => void;
  onImportText: (text: string) => Promise<{ name: string; filledCount: number }>;
  onOpenFileImport: () => void;
  onOpenJsonImport: () => void;
  onAiImprove: (text: string) => Promise<{ filledCount: number; needsReview: number }>;
}

const modeMeta: Record<ProfileEditorMode, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  manual: {
    zh: '手动编辑',
    en: 'Manual Edit',
    hintZh: '直接在下方资料表单里补充、修正和维护信息。',
    hintEn: 'Edit and maintain the profile fields directly below.',
  },
  import: {
    zh: '导入',
    en: 'Import',
    hintZh: '先粘贴简历文本，也可以导入 PDF / Word，JSON 留给高级用户。',
    hintEn: 'Paste resume text first, or import PDF / Word. JSON is for advanced use.',
  },
  ai: {
    zh: 'AI 完善资料',
    en: 'AI Improve Profile',
    hintZh: '粘贴简历或个人介绍，让 AI 抽取资料并直接填入表单。',
    hintEn: 'Paste resume text or notes, then let AI fill the profile for review.',
  },
};

function openApiSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('/settings.html') });
}

export default function ProfileModeWorkbench({
  mode,
  saveStatus,
  reviewCount,
  onModeChange,
  onImportText,
  onOpenFileImport,
  onOpenJsonImport,
  onAiImprove,
}: ProfileModeWorkbenchProps) {
  const { locale, t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [importText, setImportText] = useState('');
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isZh = locale === 'zh';
  const activeLabel = modeMeta[mode].zh;
  const statusText =
    reviewCount > 0
      ? `待检查 ${reviewCount} 项`
      : saveStatus === 'saving'
      ? t('status.saving')
      : saveStatus === 'saved'
        ? t('status.saved')
        : '已就绪';
  const apiConfigured = Boolean(settings?.apiProvider && settings.apiKey);
  const apiProviderLabel = settings?.apiProvider
    ? AI_PROVIDER_DEFAULTS[settings.apiProvider].label
    : '未选择';

  useEffect(() => {
    let alive = true;
    async function loadSettings() {
      const next = await getSettings();
      if (alive) setSettings(next);
    }
    loadSettings();
    window.addEventListener('focus', loadSettings);
    return () => {
      alive = false;
      window.removeEventListener('focus', loadSettings);
    };
  }, []);

  async function runImportText() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await onImportText(importText);
      setMessage(
        isZh
          ? `已导入「${result.name}」，请检查 ${result.filledCount} 项资料。`
          : `Imported "${result.name}". Please review ${result.filledCount} fields.`,
      );
      setImportText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAiImprove() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await onAiImprove(aiText);
      setMessage(
        isZh
          ? `AI 已填入 ${result.filledCount} 项资料，顶部状态：待检查。`
          : `AI filled ${result.filledCount} fields. Status: needs review.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-mode-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="sk-kicker">资料入口</p>
          <h1 className="sk-display text-2xl text-slate-950">
            先选择资料编辑模式
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {modeMeta[mode].hintZh}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm">
          <span>当前模式: <strong className="font-semibold text-slate-800">{activeLabel}</strong></span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>{statusText}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {(Object.keys(modeMeta) as ProfileEditorMode[]).map((item) => {
          const selected = mode === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMessage('');
                setError('');
                onModeChange(item);
              }}
              className={`mode-choice ${selected ? 'mode-choice-active' : ''}`}
            >
              <span className="sk-display text-base">{modeMeta[item].zh}</span>
              <span className="text-xs leading-5 text-slate-500">
                {modeMeta[item].hintZh}
              </span>
            </button>
          );
        })}
      </div>

      {mode === 'import' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_0.9fr]">
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-600">
                粘贴简历文本
              </label>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={7}
                className="sk-input min-h-36 resize-y"
                placeholder={isZh ? '把简历正文粘贴到这里，系统会优先从文本提取资料。' : 'Paste resume content here. Text import is the quickest path.'}
              />
              <button
                type="button"
                disabled={busy || !importText.trim()}
                onClick={runImportText}
                className="sk-primary-button mt-3"
              >
                {busy ? t('import.parsing') : '从文本导入'}
              </button>
            </div>
            <div className="space-y-3">
              <button type="button" onClick={onOpenFileImport} className="import-route-button">
                <span className="font-semibold text-slate-800">PDF / Word</span>
                <span className="text-xs text-slate-500">
                  适合普通用户上传现成简历。
                </span>
              </button>
              <button type="button" onClick={onOpenJsonImport} className="import-route-button">
                <span className="font-semibold text-slate-800">JSON</span>
                <span className="text-xs text-slate-500">
                  高级/调试用户导入完整资料。
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'ai' && (
        <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">AI 配置状态</div>
                    <div className="mt-1 text-base font-bold text-slate-950">
                      {apiConfigured ? '已配置 API Key' : '未配置 API Key'}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      apiConfigured
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    }`}
                  >
                    {apiConfigured ? '可使用' : '需配置'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500">
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                    <span>供应商</span>
                    <span className="font-semibold text-slate-800">{apiProviderLabel}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                    <span>API Key</span>
                    <span className="font-semibold text-slate-800">{settings?.apiKey ? '已保存' : '未保存'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                    <span>模型</span>
                    <span className="font-semibold text-slate-800">{settings?.apiModel || '使用默认值'}</span>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  API Key、Base URL 和模型统一在独立设置页维护；资料编辑页只处理个人资料内容。
                </p>
                <button
                  type="button"
                  onClick={openApiSettings}
                  className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-[#f8fbff] hover:text-slate-950"
                >
                  打开 API 设置
                </button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-600">
                待完善资料来源
              </label>
              <textarea
                value={aiText}
                onChange={(event) => setAiText(event.target.value)}
                rows={7}
                className="sk-input min-h-36 resize-y"
                placeholder="粘贴简历、个人介绍或已有资料，AI 会直接填入下方表单。"
              />
              <button
                type="button"
                disabled={busy || !aiText.trim() || !apiConfigured}
                onClick={runAiImprove}
                className="sk-primary-button mt-3"
              >
                {busy ? t('import.parsing') : 'AI 完善资料'}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
    </section>
  );
}
