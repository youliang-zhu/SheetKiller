import React, { useEffect, useState } from 'react';
import type { Settings } from '@/lib/storage/types';
import { getSettings, updateSettings } from '@/lib/storage/settings-store';
import { useI18n } from '@/lib/i18n';

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
    hintZh: '选择供应商并填写 API key 后，让 AI 抽取资料并直接填入表单。',
    hintEn: 'Choose a provider and API key, then let AI fill the profile for review.',
  },
};

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  async function handleSettingsChange(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await updateSettings(patch);
  }

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
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    {t('settings.apiProvider')}
                  </label>
                  <select
                    className="sk-input"
                    value={settings?.apiProvider ?? ''}
                    onChange={(event) =>
                      handleSettingsChange({ apiProvider: event.target.value as Settings['apiProvider'] })
                    }
                  >
                    <option value="">{t('settings.apiProvider.none')}</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    {t('settings.apiKey')}
                  </label>
                  <input
                    type="password"
                    className="sk-input"
                    value={settings?.apiKey ?? ''}
                    onChange={(event) => handleSettingsChange({ apiKey: event.target.value })}
                    placeholder="sk-..."
                  />
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {isZh
                  ? 'API key 保存在本机浏览器会话中；点击 AI 完善时，简历文本会发送给你选择的供应商用于结构化提取。'
                  : 'The API key stays in the local browser session. Resume text is sent to your chosen provider only when AI Improve runs.'}
              </p>
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                className="mt-3 text-xs font-semibold text-slate-600 hover:text-slate-950"
              >
                {advancedOpen ? '收起高级设置' : '高级设置'}
              </button>
              {advancedOpen && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">接口地址</label>
                    <input
                      className="sk-input"
                      value={settings?.apiBaseUrl ?? ''}
                      onChange={(event) => handleSettingsChange({ apiBaseUrl: event.target.value })}
                      placeholder={settings?.apiProvider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">模型</label>
                    <input
                      className="sk-input"
                      value={settings?.apiModel ?? ''}
                      onChange={(event) => handleSettingsChange({ apiModel: event.target.value })}
                      placeholder={settings?.apiProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-5.5'}
                    />
                  </div>
                </div>
              )}
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
                disabled={busy || !aiText.trim() || !settings?.apiProvider || !settings?.apiKey}
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
