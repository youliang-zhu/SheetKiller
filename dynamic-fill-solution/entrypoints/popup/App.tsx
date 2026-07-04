import './style.css';
import React, { useEffect, useState } from 'react';
import type { Resume } from '@/lib/storage/types';
import {
  getActiveResumeId,
  listResumes,
} from '@/lib/storage/resume-store';
import { I18nContext, useI18nProvider } from '@/lib/i18n';
import { countFields } from '@/lib/storage/resume-utils';
import type { FillPlanItem, SerializableFieldInventoryItem } from '@/lib/sheetkiller/types';
import type { DynamicFillExecution } from '@/lib/sheetkiller/executor/dynamic-fill';
import {
  appendDebugRunError,
  buildErrorDebugRun,
  buildExecutionDebug,
  buildPlannedDebugRun,
  createDebugRunId,
  patchDebugRun,
  upsertDebugRun,
  type DebugRunExtensionInfo,
  type DebugRunPage,
} from '@/lib/sheetkiller/debug/debug-run-store';

type FlowState = 'idle' | 'planning' | 'planned' | 'preview' | 'filling' | 'done' | 'error';

interface PlanResponse {
  plan: FillPlanItem[];
  summary: {
    total: number;
    fillable: number;
    needsInput: number;
    skipped: number;
    review: number;
  };
}

function openDashboard(hash?: string) {
  const url = chrome.runtime.getURL('/dashboard.html') + (hash ? '#' + hash : '');
  chrome.tabs.create({ url });
}

function pageFromTab(tab: chrome.tabs.Tab): DebugRunPage {
  const url = tab.url ?? '';
  return {
    url,
    domain: url ? new URL(url).hostname : '',
    title: tab.title ?? '',
  };
}

function extensionInfo(): DebugRunExtensionInfo {
  return {
    version: chrome.runtime.getManifest?.().version ?? 'dev',
    userAgent: navigator.userAgent,
  };
}

async function safeDebugWrite(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.warn('SheetKiller debug capture failed:', err);
  }
}

function maskPreviewValue(item: FillPlanItem): string {
  const value = item.expectedValue || item.value || '';
  if (!value) {
    if (item.safety === 'needs_user_input') return '待补充';
    return item.safety.startsWith('skip_') ? '安全跳过' : '待确认';
  }
  const path = `${item.sourcePath ?? item.profileSource ?? ''} ${item.label ?? ''}`.toLowerCase();
  if (path.includes('email')) {
    const [name, domain] = value.split('@');
    return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
  }
  if (/(phone|mobile|id|bank|card)/i.test(path)) {
    return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  }
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function humanizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return '无法连接当前页面。请刷新页面后重试，或确认该页面允许扩展运行。';
  }
  if (/no active tab/i.test(message)) return '未找到当前标签页。';
  if (/scan failed/i.test(message)) return '扫描页面失败，请刷新页面后重试。';
  if (/plan generation failed/i.test(message)) return '生成填写计划失败，请检查资料和 AI 设置。';
  if (/fill failed/i.test(message)) return '自动填写失败，请检查页面后重试。';
  return message;
}

function describeStrategy(item: FillPlanItem): string {
  if (item.safety === 'needs_user_input') return '待补充';
  if (item.safety.startsWith('skip_')) return '安全跳过';
  if (item.reviewRequired || item.valueKind === 'generated') return '待复核';
  const labels: Record<string, string> = {
    text: '文本',
    select: '选择',
    radio: '单选',
    checkbox: '勾选',
    date: '日期',
    upload: '上传',
    custom: '自定义',
  };
  return labels[item.strategy] ?? '填写';
}

function previewToneClass(item: FillPlanItem): string {
  if (item.safety.startsWith('skip_')) return 'text-[var(--sk-warning)]';
  if (item.safety === 'needs_user_input') return 'text-[var(--sk-warning)]';
  return 'text-[var(--sk-success)]';
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('未找到当前标签页。');
  return tab;
}

function isMessagePortMissing(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /receiving end does not exist|could not establish connection/i.test(message);
}

function canInjectIntoTab(tab: chrome.tabs.Tab): boolean {
  return !!tab.id && !!tab.url && /^https?:\/\//i.test(tab.url);
}

async function injectContentScript(tab: chrome.tabs.Tab): Promise<void> {
  if (!canInjectIntoTab(tab)) {
    throw new Error('当前页面不支持扩展注入，请切换到普通网页后重试。');
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    files: ['/content-scripts/content.js'],
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function sendTabMessageWithRetry<T>(tab: chrome.tabs.Tab, message: unknown): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tab.id!, message) as T;
  } catch (err) {
    if (!isMessagePortMissing(err)) throw err;
    await injectContentScript(tab);
    return await chrome.tabs.sendMessage(tab.id!, message) as T;
  }
}

export default function App() {
  const i18n = useI18nProvider();
  const { t } = i18n;
  const [activeResume, setActiveResume] = useState<Resume | null>(null);
  const [state, setState] = useState<FlowState>('idle');
  const [planData, setPlanData] = useState<PlanResponse | null>(null);
  const [execution, setExecution] = useState<DynamicFillExecution | null>(null);
  const [error, setError] = useState<string>('');
  const [scannedCount, setScannedCount] = useState(0);
  const [debugRunId, setDebugRunId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const [all, storedId] = await Promise.all([listResumes(), getActiveResumeId()]);
      if (all.length === 0) return;
      const resolved = storedId && all.find((r) => r.meta.id === storedId)
        ? all.find((r) => r.meta.id === storedId)!
        : all[0];
      setActiveResume(resolved);
    }
    init();
  }, []);

  async function handleRuleFill() {
    setState('filling');
    setError('');
    try {
      const tab = await getActiveTab();
      await sendTabMessageWithRetry(tab, { type: 'TRIGGER_FILL' });
      setState('done');
    } catch (err) {
      setError(humanizeError(err));
      setState('error');
    }
  }

  async function handleScanAndPlan() {
    setState('planning');
    setPlanData(null);
    setExecution(null);
    setError('');
    setDebugRunId(null);
    let phase: 'scan' | 'plan' = 'scan';
    let tabForDebug: chrome.tabs.Tab | null = null;
    let fieldsForDebug: SerializableFieldInventoryItem[] | undefined;
    let runIdForDebug = '';
    try {
      const tab = await getActiveTab();
      tabForDebug = tab;
      runIdForDebug = createDebugRunId(tab.url ? new URL(tab.url).hostname : 'page');
      setDebugRunId(runIdForDebug);
      const scanRes = await sendTabMessageWithRetry<{ ok?: boolean; data?: unknown; error?: string }>(tab, { type: 'SHEETKILLER_SCAN' });
      if (!scanRes?.ok) throw new Error(scanRes?.error ?? '扫描页面失败。');
      const fields = scanRes.data as SerializableFieldInventoryItem[];
      fieldsForDebug = fields;
      setScannedCount(fields.length);

      phase = 'plan';
      const planRes = await chrome.runtime.sendMessage({
        type: 'CREATE_SHEETKILLER_PLAN',
        fields,
        pageUrl: tab.url ?? '',
        pageDomain: tab.url ? new URL(tab.url).hostname : '',
      });
      if (!planRes?.ok) throw new Error(planRes?.error ?? '生成填写计划失败。');
      setPlanData(planRes.data as PlanResponse);
      await safeDebugWrite(() => upsertDebugRun(buildPlannedDebugRun({
          id: runIdForDebug,
          page: pageFromTab(tab),
          extension: extensionInfo(),
          fields,
          plan: (planRes.data as PlanResponse).plan,
          summary: (planRes.data as PlanResponse).summary,
        })));
      setState('planned');
    } catch (err) {
      const message = humanizeError(err);
      setError(message);
      if (tabForDebug && runIdForDebug) {
        await safeDebugWrite(() => upsertDebugRun(buildErrorDebugRun({
            id: runIdForDebug,
            page: pageFromTab(tabForDebug),
            extension: extensionInfo(),
            fields: fieldsForDebug,
            phase,
            message,
          })));
      }
      setState('error');
    }
  }

  async function handleStartFill() {
    if (!planData) return;
    setState('filling');
    setError('');
    try {
      const tab = await getActiveTab();
      const res = await sendTabMessageWithRetry<{ ok?: boolean; data?: unknown; error?: string }>(tab, {
        type: 'SHEETKILLER_EXECUTE_PLAN',
        plan: planData.plan,
      });
      if (!res?.ok) throw new Error(res?.error ?? '自动填写失败。');
      const executionResult = res.data as DynamicFillExecution;
      setExecution(executionResult);
      if (debugRunId) {
        await safeDebugWrite(() => patchDebugRun(debugRunId, {
            status: 'filled',
            execution: buildExecutionDebug(executionResult),
          }));
      }
      setState('done');
    } catch (err) {
      const message = humanizeError(err);
      setError(message);
      if (debugRunId) {
        await safeDebugWrite(() => appendDebugRunError(debugRunId, 'fill', message));
      }
      setState('error');
    }
  }

  const stats = activeResume ? countFields(activeResume) : null;
  const pct = stats && stats.total > 0 ? Math.round((stats.filled / stats.total) * 100) : 0;
  const isEmpty = !stats || stats.filled === 0;
  const previewItems = planData?.plan.slice(0, 10) ?? [];
  const workflowSteps = ['扫描', '规划', '填写', '复核'];
  const activeStep = state === 'planning' ? 0 : state === 'planned' || state === 'preview' ? 1 : state === 'filling' ? 2 : state === 'done' ? 3 : -1;

  return (
    <I18nContext.Provider value={i18n}>
      <div className="w-[420px] bg-[var(--sk-bg)] text-[var(--sk-text)] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--sk-border)] bg-white flex items-center gap-2">
          <span className="sk-display text-xl font-bold text-[var(--sk-text)]">SheetKiller</span>
          <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[var(--sk-primary)]">AI 表单助手</span>
          <div className="flex-1" />
          <span className="text-[11px] text-[var(--sk-muted)]">本地资料</span>
        </div>

        <div className="m-4 rounded-[28px] bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.10)] ring-1 ring-[var(--sk-border)]">
          {activeResume ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-semibold text-[var(--sk-text)]">{t('popup.currentResume')}</div>
                <div className="rounded-full bg-[#f8fafc] px-2.5 py-1 text-[11px] text-[var(--sk-muted)] ring-1 ring-[var(--sk-border)]">
                  {pct >= 80 ? '资料较完整' : pct >= 40 ? '继续补充中' : '待完善'}
                </div>
              </div>
              <div className="h-2.5 bg-[#edf2f8] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 80 ? 'bg-[var(--sk-success)]' : pct >= 40 ? 'bg-[var(--sk-primary)]' : 'bg-[var(--sk-warning)]'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs text-[var(--sk-muted)] mt-2">
                {t('popup.progress', { filled: stats!.filled, total: stats!.total, pct })}
              </div>
            </>
          ) : (
            <div className="text-xs text-[var(--sk-muted)]">{t('popup.noResume')}</div>
          )}
        </div>

        <div className="mx-4 mb-4 rounded-[28px] bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.08)] ring-1 ring-[var(--sk-border)]">
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {workflowSteps.map((step, index) => (
              <div
                key={step}
                className={`rounded-full px-2 py-1 text-center text-[11px] font-semibold transition-colors ${
                  activeStep === index
                    ? 'bg-[var(--sk-primary)] text-white'
                    : 'bg-[#f4f7fc] text-[var(--sk-muted)]'
                }`}
              >
                {step}
              </div>
            ))}
          </div>

          {state === 'idle' || state === 'error' || state === 'done' ? (
            <button
              onClick={handleScanAndPlan}
              disabled={!activeResume || state === 'planning' || state === 'filling'}
              className={`w-full py-3 px-4 rounded-2xl text-sm font-semibold transition-colors ${
                activeResume ? 'bg-[var(--sk-primary)] hover:bg-[var(--sk-primary-hover)] text-white shadow-[0_10px_24px_rgba(29,78,216,0.22)]' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              扫描并生成计划
            </button>
          ) : null}

          {state === 'planning' && (
            <div className="rounded-2xl bg-[#f8fbff] border border-[var(--sk-border)] px-3 py-3 text-sm text-[var(--sk-muted)]">
              正在扫描页面并生成填写计划...
            </div>
          )}

          {(state === 'planned' || state === 'preview') && planData && (
            <div>
              <div className="text-sm font-semibold text-[var(--sk-text)]">填写计划已生成</div>
              <div className="text-xs text-[var(--sk-muted)] mt-1 leading-5">
                已扫描 {scannedCount} 个字段，可自动填写 {planData.summary.fillable} 个，待补充 {planData.summary.needsInput} 个，安全跳过 {planData.summary.skipped} 个，需复核 {planData.summary.review} 个。
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleStartFill}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-semibold bg-[var(--sk-success)] hover:bg-emerald-500 text-white"
                >
                  开始填写
                </button>
                <button
                  onClick={() => setState(state === 'preview' ? 'planned' : 'preview')}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-semibold bg-white hover:bg-[#f8fbff] text-[var(--sk-text)] border border-[var(--sk-border)]"
                >
                  {state === 'preview' ? '收起预览' : '预览计划'}
                </button>
              </div>
            </div>
          )}

          {state === 'filling' && (
            <div className="rounded-2xl bg-[#f8fbff] border border-[var(--sk-border)] px-3 py-3 text-sm text-[var(--sk-muted)]">
              正在填写页面。最终提交已被自动化拦截，请人工确认。
            </div>
          )}

          {state === 'done' && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-2xl px-3 py-2 leading-relaxed">
              {execution
                ? `已完成。成功验证 ${execution.filled} 个，待补充 ${execution.needsInput} 个，安全跳过 ${execution.skipped} 个，失败或不匹配 ${execution.failed} 个。请检查页面上高亮字段。`
                : '规则填写已完成。提交前请人工检查页面。'}
            </div>
          )}

          {state === 'error' && (
            <div className="text-xs text-[var(--sk-error)] bg-red-50 border border-red-200 rounded-2xl px-3 py-2 leading-relaxed mt-3">{error}</div>
          )}
        </div>

        {state === 'preview' && planData && (
          <div className="mx-4 mb-4 rounded-[28px] bg-white p-4 shadow-[0_16px_42px_rgba(15,23,42,0.08)] ring-1 ring-[var(--sk-border)] max-h-64 overflow-y-auto">
            <div className="text-xs font-semibold text-[var(--sk-muted)] mb-2">只读预览</div>
            <div className="space-y-2">
              {previewItems.map((item) => (
                <div key={item.fieldId} className="text-xs border border-[var(--sk-border)] bg-[#f8fbff] rounded-2xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[var(--sk-text)] font-semibold">{item.label || item.fieldId}</span>
                    <span className={`shrink-0 ${previewToneClass(item)}`}>
                      {describeStrategy(item)}
                    </span>
                  </div>
                  <div className="text-[var(--sk-muted)] mt-1 leading-5">
                    {maskPreviewValue(item)}
                    {item.reviewRequired || item.valueKind === 'generated' ? '（需复核）' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mx-4 mb-3 flex gap-2">
          <button
            onClick={() => openDashboard()}
            className="flex-1 py-2.5 px-3 rounded-2xl text-xs font-semibold bg-white hover:bg-[#f8fbff] text-[var(--sk-text)] border border-[var(--sk-border)] transition-colors shadow-sm"
          >
            {t('popup.edit')}
          </button>
          <button
            onClick={() => openDashboard('settings')}
            className="flex-1 py-2.5 px-3 rounded-2xl text-xs font-semibold bg-white hover:bg-[#f8fbff] text-[var(--sk-text)] border border-[var(--sk-border)] transition-colors shadow-sm"
          >
            {t('nav.settings')}
          </button>
        </div>

        <div className="mx-4 mb-4">
          <button
            onClick={handleRuleFill}
            disabled={!activeResume || state === 'planning' || state === 'filling'}
            className="w-full py-2.5 rounded-2xl text-xs font-semibold bg-[#eff6ff] hover:bg-[#dbeafe] text-[var(--sk-primary)] border border-[#dbeafe] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            规则填写兜底
          </button>
        </div>

        {isEmpty && (
          <div className="mx-4 mb-4 px-3 py-2 bg-sky-50 border border-sky-100 rounded-2xl text-xs text-sky-800 leading-relaxed">
            {t('popup.hint.firstTime')}
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}
