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
import {
  getWorkflowSnapshot,
  isStaleRunningSnapshot,
  saveWorkflowSnapshot,
  snapshotMatchesTab,
} from '@/lib/sheetkiller/workflow/workflow-state-store';

type FlowState = 'idle' | 'planning' | 'planned' | 'preview' | 'filling' | 'done' | 'error';
type PlanPhase = 'idle' | 'connect' | 'scan' | 'ai' | 'build';

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

function openApiSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('/settings.html') });
}

const PLAN_PHASES: Array<{
  id: Exclude<PlanPhase, 'idle'>;
  title: string;
  description: string;
}> = [
  {
    id: 'connect',
    title: '连接当前页面',
    description: '确认扩展可以访问当前网申页面。',
  },
  {
    id: 'scan',
    title: '识别可填写区域',
    description: '读取输入框、下拉框、日期和文本区域。',
  },
  {
    id: 'ai',
    title: 'AI 核对资料',
    description: '把页面字段和本地资料进行匹配。',
  },
  {
    id: 'build',
    title: '生成填写计划',
    description: '整理可填写、待补充和需复核的项目。',
  },
];

function planPhaseIndex(phase: PlanPhase): number {
  return PLAN_PHASES.findIndex((item) => item.id === phase);
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
  if (/configure an ai provider|api key|no active profile/i.test(message)) {
    return '请先在「API 设置」中配置供应商和 API Key，再重新扫描。';
  }
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
  const [planPhase, setPlanPhase] = useState<PlanPhase>('idle');
  const [restoredWorkflow, setRestoredWorkflow] = useState(false);

  useEffect(() => {
    async function init() {
      const [all, storedId] = await Promise.all([listResumes(), getActiveResumeId()]);
      if (all.length === 0) return;
      const resolved = storedId && all.find((r) => r.meta.id === storedId)
        ? all.find((r) => r.meta.id === storedId)!
        : all[0];
      setActiveResume(resolved);

      try {
        const [tab, snapshot] = await Promise.all([getActiveTab(), getWorkflowSnapshot()]);
        if (snapshotMatchesTab(snapshot, tab)) {
          setDebugRunId(snapshot.runId);
          setScannedCount(snapshot.scannedCount);
          setPlanData(snapshot.planData);
          setExecution(snapshot.execution);
          setPlanPhase(snapshot.phase);
          if (isStaleRunningSnapshot(snapshot)) {
            setState('error');
            setPlanPhase('idle');
            setError('上次任务在弹窗关闭后中断。请重新扫描当前页面。');
          } else {
            setState(snapshot.state);
            setError(snapshot.error);
          }
          if (snapshot.state !== 'idle') setRestoredWorkflow(true);
        }
      } catch {
        // Restoring workflow state is a convenience; never block opening popup.
      }
    }
    init();
  }, []);

  async function persistWorkflow(partial: {
    state: FlowState;
    phase?: PlanPhase;
    planData?: PlanResponse | null;
    execution?: DynamicFillExecution | null;
    error?: string;
    scannedCount?: number;
    runId?: string | null;
    tab?: chrome.tabs.Tab;
  }) {
    try {
      const tab = partial.tab ?? await getActiveTab();
      const url = tab.url ?? '';
      await saveWorkflowSnapshot({
        runId: partial.runId === undefined ? debugRunId : partial.runId,
        tabId: tab.id ?? null,
        pageUrl: url,
        pageDomain: url ? new URL(url).hostname : '',
        state: partial.state,
        phase: partial.phase ?? planPhase,
        scannedCount: partial.scannedCount ?? scannedCount,
        planData: partial.planData === undefined ? planData : partial.planData,
        execution: partial.execution === undefined ? execution : partial.execution,
        error: partial.error ?? error,
      });
    } catch {
      // Popup state persistence should never fail the user-facing action.
    }
  }

  async function handleRuleFill() {
    setState('filling');
    setError('');
    await persistWorkflow({ state: 'filling', phase: 'idle', error: '' });
    try {
      const tab = await getActiveTab();
      await sendTabMessageWithRetry(tab, { type: 'TRIGGER_FILL' });
      setState('done');
      await persistWorkflow({ state: 'done', phase: 'idle', tab });
    } catch (err) {
      const message = humanizeError(err);
      setError(message);
      setState('error');
      await persistWorkflow({ state: 'error', phase: 'idle', error: message });
    }
  }

  async function handleScanAndPlan() {
    setState('planning');
    setPlanPhase('connect');
    setRestoredWorkflow(false);
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
      await persistWorkflow({
        state: 'planning',
        phase: 'connect',
        planData: null,
        execution: null,
        error: '',
        scannedCount: 0,
        runId: runIdForDebug,
        tab,
      });
      setPlanPhase('scan');
      await persistWorkflow({
        state: 'planning',
        phase: 'scan',
        planData: null,
        execution: null,
        error: '',
        scannedCount: 0,
        runId: runIdForDebug,
        tab,
      });
      const scanRes = await sendTabMessageWithRetry<{ ok?: boolean; data?: unknown; error?: string }>(tab, { type: 'SHEETKILLER_SCAN' });
      if (!scanRes?.ok) throw new Error(scanRes?.error ?? '扫描页面失败。');
      const fields = scanRes.data as SerializableFieldInventoryItem[];
      fieldsForDebug = fields;
      setScannedCount(fields.length);

      phase = 'plan';
      setPlanPhase('ai');
      await persistWorkflow({
        state: 'planning',
        phase: 'ai',
        scannedCount: fields.length,
        runId: runIdForDebug,
        tab,
      });
      const planRes = await chrome.runtime.sendMessage({
        type: 'CREATE_SHEETKILLER_PLAN',
        fields,
        pageUrl: tab.url ?? '',
        pageDomain: tab.url ? new URL(tab.url).hostname : '',
      });
      if (!planRes?.ok) throw new Error(planRes?.error ?? '生成填写计划失败。');
      setPlanPhase('build');
      const nextPlanData = planRes.data as PlanResponse;
      setPlanData(nextPlanData);
      await persistWorkflow({
        state: 'planning',
        phase: 'build',
        planData: nextPlanData,
        scannedCount: fields.length,
        runId: runIdForDebug,
        tab,
      });
      await safeDebugWrite(() => upsertDebugRun(buildPlannedDebugRun({
          id: runIdForDebug,
          page: pageFromTab(tab),
          extension: extensionInfo(),
          fields,
          plan: nextPlanData.plan,
          summary: nextPlanData.summary,
        })));
      setState('planned');
      setPlanPhase('idle');
      await persistWorkflow({
        state: 'planned',
        phase: 'idle',
        planData: nextPlanData,
        scannedCount: fields.length,
        runId: runIdForDebug,
        tab,
      });
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
      setPlanPhase('idle');
      if (tabForDebug) {
        await persistWorkflow({
          state: 'error',
          phase: 'idle',
          error: message,
          scannedCount: fieldsForDebug?.length ?? scannedCount,
          runId: runIdForDebug || debugRunId,
          tab: tabForDebug,
        });
      }
    }
  }

  async function handleStartFill() {
    if (!planData) return;
    setState('filling');
    setError('');
    try {
      const tab = await getActiveTab();
      await persistWorkflow({ state: 'filling', phase: 'idle', error: '', tab });
      const res = await sendTabMessageWithRetry<{ ok?: boolean; data?: unknown; error?: string }>(tab, {
        type: 'SHEETKILLER_EXECUTE_PLAN',
        plan: planData.plan,
      });
      if (!res?.ok) throw new Error(res?.error ?? '自动填写失败。');
      const executionResult = res.data as DynamicFillExecution;
      setExecution(executionResult);
      await persistWorkflow({ state: 'done', phase: 'idle', execution: executionResult, tab });
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
      await persistWorkflow({ state: 'error', phase: 'idle', error: message });
    }
  }

  async function handleTogglePreview() {
    const nextState: FlowState = state === 'preview' ? 'planned' : 'preview';
    setState(nextState);
    await persistWorkflow({ state: nextState, phase: 'idle' });
  }

  const stats = activeResume ? countFields(activeResume) : null;
  const pct = stats && stats.total > 0 ? Math.round((stats.filled / stats.total) * 100) : 0;
  const isEmpty = !stats || stats.filled === 0;
  const previewItems = planData?.plan.slice(0, 10) ?? [];
  const workflowSteps = ['扫描', '规划', '填写', '复核'];
  const activeStep = state === 'planning'
    ? (planPhase === 'ai' || planPhase === 'build' ? 1 : 0)
    : state === 'planned' || state === 'preview'
      ? 1
      : state === 'filling'
        ? 2
        : state === 'done'
          ? 3
          : -1;
  const currentPlanPhase = PLAN_PHASES.find((item) => item.id === planPhase);
  const currentPlanPhaseIndex = planPhaseIndex(planPhase);

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

          {restoredWorkflow && (
            <div className="mb-3 rounded-2xl border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-xs leading-5 text-[var(--sk-primary)]">
              已恢复上次页面状态。你可以继续当前步骤，或重新扫描当前页面。
            </div>
          )}

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
            <div className="rounded-2xl bg-[#f8fbff] border border-[var(--sk-border)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--sk-text)]">
                    {currentPlanPhase?.title ?? '准备扫描'}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--sk-muted)]">
                    {currentPlanPhase?.description ?? '正在准备自动化流程。'}
                  </div>
                </div>
                <div className="h-8 w-8 shrink-0 rounded-full border-2 border-[#bfdbfe] border-t-[var(--sk-primary)] animate-spin" />
              </div>
              <div className="mt-3 space-y-2">
                {PLAN_PHASES.map((phase, index) => {
                  const active = phase.id === planPhase;
                  const done = currentPlanPhaseIndex > index;
                  return (
                    <div
                      key={phase.id}
                      className={`flex items-start gap-2 rounded-2xl px-2.5 py-2 text-xs ${
                        active
                          ? 'bg-white text-[var(--sk-text)] shadow-sm ring-1 ring-[var(--sk-border)]'
                          : done
                            ? 'text-[var(--sk-success)]'
                            : 'text-[var(--sk-muted)]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          done
                            ? 'bg-[var(--sk-success)] text-white'
                            : active
                              ? 'bg-[var(--sk-primary)] text-white'
                              : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {done ? '✓' : index + 1}
                      </span>
                      <span>
                        <span className="font-semibold">{phase.title}</span>
                        {active && <span className="ml-1 text-[var(--sk-muted)]">{phase.description}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
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
                  onClick={handleTogglePreview}
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
            <div className="mt-3">
              <div className="text-xs text-[var(--sk-error)] bg-red-50 border border-red-200 rounded-2xl px-3 py-2 leading-relaxed">{error}</div>
              {/API 设置/.test(error) && (
                <button
                  onClick={openApiSettings}
                  className="mt-2 w-full py-2.5 rounded-2xl text-xs font-semibold bg-[var(--sk-primary)] hover:bg-[var(--sk-primary-hover)] text-white"
                >
                  打开 API 设置
                </button>
              )}
            </div>
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
            onClick={openApiSettings}
            className="flex-1 py-2.5 px-3 rounded-2xl text-xs font-semibold bg-white hover:bg-[#f8fbff] text-[var(--sk-text)] border border-[var(--sk-border)] transition-colors shadow-sm"
          >
            API 设置
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
