import type {
  FillPlanItem,
  SerializableFieldInventoryItem,
  SheetKillerReportItem,
} from '@/lib/sheetkiller/types';
import type { DynamicFillExecution } from '@/lib/sheetkiller/executor/dynamic-fill';
import { maskValue } from '@/lib/sheetkiller/verifier/verifier';

const DEBUG_RUNS_KEY = 'sheetkiller:debugRuns';
const MAX_DEBUG_RUNS = 20;
const SCHEMA_VERSION = 1;

export interface DebugRunPage {
  url: string;
  domain: string;
  title: string;
}

export interface DebugRunExtensionInfo {
  version: string;
  userAgent: string;
}

export interface DebugRunField {
  fieldId: string;
  index?: number;
  inputType: SerializableFieldInventoryItem['inputType'];
  label: string;
  hint: string;
  placeholder: string;
  ariaLabel: string;
  name: string;
  id: string;
  section: string;
  context: string;
  htmlSnippet: string;
  options: string[];
  optionsCount: number;
  currentValueMasked: string;
  required: boolean;
  visible: boolean;
  sensitiveType?: SerializableFieldInventoryItem['sensitiveType'];
  source: SerializableFieldInventoryItem['source'];
}

export interface DebugRunPlanItem {
  fieldId: string;
  index?: number;
  label?: string;
  profileSource: string;
  sourcePath?: string;
  expectedMasked: string;
  valueKind?: FillPlanItem['valueKind'];
  strategy: FillPlanItem['strategy'];
  confidence: FillPlanItem['confidence'];
  confidenceScore?: number;
  reason: string;
  source: FillPlanItem['source'];
  safety: FillPlanItem['safety'];
  reviewRequired?: boolean;
}

export interface DebugRunPlan {
  summary: {
    total: number;
    fillable: number;
    needsInput: number;
    skipped: number;
    review: number;
  };
  items: DebugRunPlanItem[];
}

export interface DebugRunExecution {
  summary: {
    filled: number;
    needsInput: number;
    skipped: number;
    failed: number;
  };
  reports: SheetKillerReportItem[];
  debugItems?: DynamicFillExecution['debugItems'];
}

export interface SheetKillerDebugRun {
  schemaVersion: number;
  id: string;
  status: 'planned' | 'filled' | 'error';
  createdAt: number;
  updatedAt: number;
  page: DebugRunPage;
  extension: DebugRunExtensionInfo;
  scan?: {
    count: number;
    fields: DebugRunField[];
  };
  plan?: DebugRunPlan;
  execution?: DebugRunExecution;
  errors?: Array<{
    phase: 'scan' | 'plan' | 'fill' | 'unknown';
    message: string;
    at: number;
  }>;
}

function truncate(value: string, max = 1200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function inferSensitiveType(
  text: string,
): SerializableFieldInventoryItem['sensitiveType'] | undefined {
  if (/email|mail|邮箱|邮件/i.test(text)) return 'email';
  if (/phone|mobile|tel|手机|电话/i.test(text)) return 'phone';
  if (/id.?card|身份证|证件/i.test(text)) return 'id_card';
  if (/bank|银行卡/i.test(text)) return 'bank_card';
  return undefined;
}

function masked(
  value: string | undefined,
  sensitiveType?: SerializableFieldInventoryItem['sensitiveType'],
  text = '',
): string {
  if (!value) return '';
  const resolved = sensitiveType ?? inferSensitiveType(text);
  return maskValue(value, resolved);
}

export function createDebugRunId(domain = 'page'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, '_').slice(0, 48) || 'page';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}_${safeDomain}_${suffix}`;
}

export function sanitizeDebugField(field: SerializableFieldInventoryItem): DebugRunField {
  const text = [
    field.label,
    field.placeholder,
    field.ariaLabel,
    field.name,
    field.id,
    field.context,
  ].join(' ');
  return {
    fieldId: field.fieldId,
    index: field.index,
    inputType: field.inputType,
    label: truncate(field.label, 200),
    hint: truncate(field.hint, 240),
    placeholder: truncate(field.placeholder, 160),
    ariaLabel: truncate(field.ariaLabel, 160),
    name: truncate(field.name, 160),
    id: truncate(field.id, 160),
    section: truncate(field.section, 160),
    context: truncate(field.context, 600),
    htmlSnippet: truncate(field.htmlSnippet, 900),
    options: field.options.slice(0, 80).map((option) => truncate(option, 160)),
    optionsCount: field.options.length,
    currentValueMasked: masked(field.currentValue, field.sensitiveType, text),
    required: field.required,
    visible: field.visible,
    sensitiveType: field.sensitiveType,
    source: field.source,
  };
}

export function sanitizeDebugPlanItem(item: FillPlanItem): DebugRunPlanItem {
  const text = `${item.sourcePath ?? item.profileSource ?? ''} ${item.label ?? ''}`;
  return {
    fieldId: item.fieldId,
    index: item.index,
    label: item.label,
    profileSource: item.profileSource,
    sourcePath: item.sourcePath,
    expectedMasked: masked(item.expectedValue || item.value, undefined, text),
    valueKind: item.valueKind,
    strategy: item.strategy,
    confidence: item.confidence,
    confidenceScore: item.confidenceScore,
    reason: item.reason,
    source: item.source,
    safety: item.safety,
    reviewRequired: item.reviewRequired,
  };
}

function readAllSyncShape(raw: unknown): SheetKillerDebugRun[] {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') as SheetKillerDebugRun[] : [];
}

async function readAll(): Promise<SheetKillerDebugRun[]> {
  const result = await chrome.storage.local.get(DEBUG_RUNS_KEY);
  return readAllSyncShape(result[DEBUG_RUNS_KEY]);
}

async function writeAll(runs: SheetKillerDebugRun[]): Promise<void> {
  const sorted = [...runs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DEBUG_RUNS);
  await chrome.storage.local.set({ [DEBUG_RUNS_KEY]: sorted });
}

export async function upsertDebugRun(run: SheetKillerDebugRun): Promise<void> {
  const current = await readAll();
  const next = [run, ...current.filter((item) => item.id !== run.id)];
  await writeAll(next);
}

export async function patchDebugRun(
  id: string,
  patch: Partial<Omit<SheetKillerDebugRun, 'id' | 'createdAt' | 'schemaVersion'>>,
): Promise<void> {
  const current = await readAll();
  const existing = current.find((item) => item.id === id);
  if (!existing) return;
  await upsertDebugRun({
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    errors: patch.errors ?? existing.errors,
  });
}

export async function appendDebugRunError(
  id: string,
  phase: 'scan' | 'plan' | 'fill' | 'unknown',
  message: string,
): Promise<void> {
  const current = await readAll();
  const existing = current.find((item) => item.id === id);
  if (!existing) return;
  await upsertDebugRun({
    ...existing,
    status: 'error',
    updatedAt: Date.now(),
    errors: [
      ...(existing.errors ?? []),
      { phase, message, at: Date.now() },
    ],
  });
}

export async function listDebugRuns(): Promise<SheetKillerDebugRun[]> {
  return readAll();
}

export async function getLatestDebugRun(): Promise<SheetKillerDebugRun | null> {
  const runs = await readAll();
  return runs[0] ?? null;
}

export async function clearDebugRuns(): Promise<void> {
  await chrome.storage.local.set({ [DEBUG_RUNS_KEY]: [] });
}

export function buildPlannedDebugRun(input: {
  id: string;
  page: DebugRunPage;
  extension: DebugRunExtensionInfo;
  fields: SerializableFieldInventoryItem[];
  plan: FillPlanItem[];
  summary: DebugRunPlan['summary'];
}): SheetKillerDebugRun {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    page: input.page,
    extension: input.extension,
    scan: {
      count: input.fields.length,
      fields: input.fields.map(sanitizeDebugField),
    },
    plan: {
      summary: input.summary,
      items: input.plan.map(sanitizeDebugPlanItem),
    },
  };
}

export function buildErrorDebugRun(input: {
  id: string;
  page: DebugRunPage;
  extension: DebugRunExtensionInfo;
  fields?: SerializableFieldInventoryItem[];
  phase: 'scan' | 'plan' | 'fill' | 'unknown';
  message: string;
}): SheetKillerDebugRun {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    status: 'error',
    createdAt: now,
    updatedAt: now,
    page: input.page,
    extension: input.extension,
    scan: input.fields
      ? {
          count: input.fields.length,
          fields: input.fields.map(sanitizeDebugField),
        }
      : undefined,
    errors: [{ phase: input.phase, message: input.message, at: now }],
  };
}

export function buildExecutionDebug(execution: DynamicFillExecution): DebugRunExecution {
  return {
    summary: {
      filled: execution.filled,
      needsInput: execution.needsInput,
      skipped: execution.skipped,
      failed: execution.failed,
    },
    reports: execution.reports,
    debugItems: execution.debugItems,
  };
}
