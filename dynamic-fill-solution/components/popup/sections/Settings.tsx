import React, { useEffect, useState } from 'react';
import type { Settings } from '@/lib/storage/types';
import { DEFAULT_ALLOWED_DOMAINS } from '@/lib/storage/types';
import { getSettings, updateSettings } from '@/lib/storage/settings-store';
import { AI_PROVIDER_DEFAULTS } from '@/lib/ai/provider-defaults';
import {
  clearDebugRuns,
  getLatestDebugRun,
  listDebugRuns,
  type SheetKillerDebugRun,
} from '@/lib/sheetkiller/debug/debug-run-store';
import { useI18n } from '@/lib/i18n';

const inputBase =
  'w-full bg-white border border-slate-300 rounded-2xl px-3 py-2 text-sm text-[var(--sk-text)] placeholder-slate-400 focus:outline-none focus:border-[var(--sk-primary)] focus:ring-4 focus:ring-blue-600/10 transition-colors';

const labelBase = 'block text-xs font-semibold text-[var(--sk-muted)] mb-1.5';

export default function SettingsSection() {
  const { t, locale, setLocale } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [debugRuns, setDebugRuns] = useState<SheetKillerDebugRun[]>([]);
  const [debugStatus, setDebugStatus] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
    listDebugRuns().then(setDebugRuns);
  }, []);

  const handleChange = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await updateSettings(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <p className="text-xs text-slate-500">{t('import.parsing')}</p>;
  }

  const refreshDebugRuns = async () => {
    setDebugRuns(await listDebugRuns());
  };

  const handleProviderChange = (provider: Settings['apiProvider']) => {
    void handleChange({
      apiProvider: provider,
      apiBaseUrl: '',
      apiModel: '',
    });
  };

  const handleExportLatestDebugRun = async () => {
    const latest = await getLatestDebugRun();
    if (!latest) {
      setDebugStatus('暂无可导出的调试记录');
      return;
    }
    const blob = new Blob([JSON.stringify(latest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sheetkiller-debug-${latest.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDebugStatus('已导出最近一次调试包');
  };

  const handleClearDebugRuns = async () => {
    await clearDebugRuns();
    await refreshDebugRuns();
    setDebugStatus('已清空调试记录');
  };

  return (
    <div>
      <div className="mb-4">
        <label className={labelBase}>{t('settings.language')}</label>
        <select
          className={inputBase}
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'zh' | 'en')}
        >
          <option value="zh">中文</option>
          <option value="en">英文</option>
        </select>
      </div>
      <div className="mb-4">
        <label className={labelBase}>{t('settings.apiProvider')}</label>
        <select
          className={inputBase}
          value={settings.apiProvider}
          onChange={(e) => handleProviderChange(e.target.value as Settings['apiProvider'])}
        >
          <option value="">{t('settings.apiProvider.none')}</option>
          {Object.entries(AI_PROVIDER_DEFAULTS).map(([value, provider]) => (
            <option key={value} value={value}>
              {provider.label}
            </option>
          ))}
        </select>
      </div>
      {settings.apiProvider && (
        <>
          <div className="mb-4">
            <label className={labelBase}>{t('settings.apiKey')}</label>
            <input
              type="password"
              className={inputBase}
              value={settings.apiKey}
              onChange={(e) => handleChange({ apiKey: e.target.value })}
              placeholder={AI_PROVIDER_DEFAULTS[settings.apiProvider].apiKeyPlaceholder}
            />
            <p className="text-xs text-slate-500 mt-1.5">{t('settings.apiKeyHint')}</p>
          </div>
          <div className="mb-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              {advancedOpen
                ? '收起高级设置'
                : '高级设置'}
            </button>
            {advancedOpen && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelBase}>接口地址</label>
                  <input
                    className={inputBase}
                    value={settings.apiBaseUrl}
                    onChange={(e) => handleChange({ apiBaseUrl: e.target.value })}
                    placeholder={AI_PROVIDER_DEFAULTS[settings.apiProvider].baseUrl}
                  />
                </div>
                <div>
                  <label className={labelBase}>模型</label>
                  <input
                    className={inputBase}
                    value={settings.apiModel}
                    onChange={(e) => handleChange({ apiModel: e.target.value })}
                    placeholder={AI_PROVIDER_DEFAULTS[settings.apiProvider].model}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <div className="mt-6 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-semibold mb-3 text-slate-800">{t('settings.capture.title')}</h3>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.skipSensitive}
            onChange={(e) => handleChange({ skipSensitive: e.target.checked })}
          />
          <span>{t('settings.capture.skipSensitive')}</span>
        </label>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label className={labelBase.replace(' mb-1', '')}>{t('settings.capture.allowedDomains')}</label>
            <button
              onClick={() => handleChange({ allowedDomains: [...DEFAULT_ALLOWED_DOMAINS] })}
              className="text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              {t('settings.capture.allowedDomains.reset')}
            </button>
          </div>
          <textarea
            className={`${inputBase} h-36 resize-y`}
            value={(settings.allowedDomains ?? []).join('\n')}
            onChange={(e) =>
              handleChange({
                // Accept newline- or comma-separated lists so paste-from-anywhere works.
                allowedDomains: e.target.value
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'mokahr.com\nzhaopin.com\ngreenhouse.io'}
          />
          <p className="text-xs text-slate-500 mt-1.5 leading-5">{t('settings.capture.allowedDomainsHint')}</p>
        </div>
      </div>
      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">测试调试包</h3>
            <p className="text-xs text-slate-500 mt-1 leading-5">
              自动保留最近 20 次扫描/规划/填写记录。调试包不包含 API Key，手机号、邮箱、证件号会脱敏。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
            {debugRuns.length} 条
          </span>
        </div>
        {debugRuns[0] && (
          <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600 leading-5">
            最近一次：{new Date(debugRuns[0].createdAt).toLocaleString()} · {debugRuns[0].status}
            <br />
            {debugRuns[0].page.domain || debugRuns[0].page.url || '未知页面'}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportLatestDebugRun}
            disabled={debugRuns.length === 0}
            className="rounded-2xl bg-[var(--sk-primary)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            导出最近调试包
          </button>
          <button
            type="button"
            onClick={refreshDebugRuns}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            刷新记录
          </button>
          <button
            type="button"
            onClick={handleClearDebugRuns}
            disabled={debugRuns.length === 0}
            className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            清空调试记录
          </button>
        </div>
        {debugStatus && (
          <p className="mt-2 text-xs text-slate-500">{debugStatus}</p>
        )}
      </div>
      {(saving || saved) && (
        <p className="text-xs text-slate-500 mt-2">
          {saving ? t('import.parsing') : '✓'}
        </p>
      )}
    </div>
  );
}
