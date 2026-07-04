import type {
  Confidence,
  FieldInventoryItem,
  FillPlanItem,
  LlmSafeProfileFact,
  ProfileFact,
  SerializableFieldInventoryItem,
} from '@/lib/sheetkiller/types';
import { redactFactsForLlm, resolveFactValue } from '@/lib/sheetkiller/profile/facts';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type PlannerField = FieldInventoryItem | SerializableFieldInventoryItem;

const MAX_FIELDS_PER_LLM_REQUEST = 35;
const MAX_OPTIONS_PER_FIELD = 60;
const MAX_OPTION_TEXT_LENGTH = 120;
const UNSAFE_SENSITIVE_TYPES = new Set(['password', 'captcha', 'verify_code', 'bank_card', 'upload']);

export interface LlmRawPlanItem {
  fieldId?: string;
  index?: number;
  label?: string;
  profileSource?: string;
  sourcePath?: string;
  strategy?: FillPlanItem['strategy'];
  confidence?: Confidence | number;
  reason?: string;
  value?: string;
  valueKind?: FillPlanItem['valueKind'];
  generatedValue?: string;
  searchValues?: string[];
  acceptValues?: string[];
  allowFreeText?: boolean;
  dependsOn?: number[];
  reviewRequired?: boolean;
}

function truncate(value: string, max = 600): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function compactOptions(options: PlannerField['options']): PlannerField['options'] {
  if (!Array.isArray(options)) return [];
  return options
    .slice(0, MAX_OPTIONS_PER_FIELD)
    .map((option) => truncate(String(option), MAX_OPTION_TEXT_LENGTH));
}

export function buildPlannerPrompt(
  fields: PlannerField[],
  facts: LlmSafeProfileFact[],
): string {
  const fieldLines = fields.map((field) => ({
    fieldId: field.fieldId,
    index: field.index,
    inputType: field.inputType,
    label: field.label,
    hint: field.hint,
    placeholder: field.placeholder,
    ariaLabel: field.ariaLabel,
    name: field.name,
    id: field.id,
    options: compactOptions(field.options),
    optionsTruncated: Array.isArray(field.options) && field.options.length > MAX_OPTIONS_PER_FIELD,
    context: truncate(field.context),
    html: truncate(field.htmlSnippet),
    sensitiveType: field.sensitiveType,
  }));

  return [
    'You are SheetKiller field planner. Match web form fields to local profile facts.',
    'Return only a JSON array.',
    'Do not invent facts. Do not decide to submit. Do not fill uploads, captcha, verify codes, passwords, or identity checks.',
    'Do not skip a field merely because the match is uncertain. If a field is technically fillable, provide the best sourcePath when available and mark reviewRequired=true for uncertainty.',
    'Use strategy="skip" only for unsafe or human-only fields such as uploads, captcha, passwords, verification codes, bank cards, or final submission controls.',
    'For profile-backed values, return sourcePath/profileSource; local code will resolve the real value.',
    'For generated open-ended answers, set valueKind="generated" and reviewRequired=true.',
    'Each item: fieldId or index, sourcePath/profileSource, strategy, confidence, reason, valueKind.',
    'strategy must be one of text, textarea, select, radio, checkbox, date, custom-select, cascader-region, contenteditable, skip.',
    'confidence may be a number from 0 to 1. Use reviewRequired for fields a human should inspect.',
    '',
    'PROFILE_FACTS:',
    JSON.stringify(facts, null, 2),
    '',
    'FIELDS:',
    JSON.stringify(fieldLines, null, 2),
  ].join('\n');
}

export function parsePlannerResponse(content: string): LlmRawPlanItem[] {
  const json = content.match(/\[[\s\S]*\]/)?.[0] ?? content.trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => ({
    fieldId: item.fieldId === undefined ? undefined : String(item.fieldId),
    index: Number.isFinite(Number(item.index)) ? Number(item.index) : undefined,
    label: item.label === undefined ? undefined : String(item.label),
    profileSource: item.profileSource === undefined ? undefined : String(item.profileSource),
    sourcePath: item.sourcePath === undefined ? undefined : String(item.sourcePath),
    strategy: item.strategy,
    confidence: item.confidence,
    reason: item.reason === undefined ? undefined : String(item.reason),
    value: item.value === undefined ? undefined : String(item.value),
    valueKind: item.valueKind,
    generatedValue: item.generatedValue === undefined ? undefined : String(item.generatedValue),
    searchValues: Array.isArray(item.searchValues) ? item.searchValues.map(String) : undefined,
    acceptValues: Array.isArray(item.acceptValues) ? item.acceptValues.map(String) : undefined,
    allowFreeText: item.allowFreeText === undefined ? undefined : Boolean(item.allowFreeText),
    dependsOn: Array.isArray(item.dependsOn)
      ? item.dependsOn.map(Number).filter((n) => Number.isFinite(n))
      : undefined,
    reviewRequired: item.reviewRequired === undefined ? undefined : Boolean(item.reviewRequired),
  })).filter((item) => item.fieldId || item.index !== undefined);
}

function normalizeConfidence(raw: Confidence | number | undefined): {
  label: Confidence;
  score: number;
} {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const score = Math.max(0, Math.min(1, raw));
    if (score >= 0.8) return { label: 'high', score };
    if (score >= 0.5) return { label: 'medium', score };
    return { label: 'low', score };
  }
  if (raw === 'high') return { label: 'high', score: 0.9 };
  if (raw === 'low') return { label: 'low', score: 0.3 };
  return { label: 'medium', score: 0.65 };
}

export function materializeLlmPlan(
  raw: LlmRawPlanItem[],
  facts: ProfileFact[],
  fields: PlannerField[],
): FillPlanItem[] {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const fieldByIndex = new Map(fields
    .filter((field) => field.index !== undefined)
    .map((field) => [field.index as number, field]));
  return raw.flatMap((item): FillPlanItem[] => {
    const field = item.fieldId ? fieldById.get(item.fieldId) : fieldByIndex.get(item.index as number);
    if (!field) return [];
    const fieldId = field.fieldId;
    const index = field.index;
    if (field.inputType === 'file') {
      return [{
        fieldId,
        index,
        label: item.label ?? field.label,
        profileSource: '',
        sourcePath: '',
        expectedValue: '',
        strategy: 'skip',
        confidence: 'high',
        confidenceScore: 1,
        reason: 'File upload requires human action.',
        source: 'llm',
        safety: 'skip_upload',
      }];
    }
    const sourcePath = item.sourcePath ?? item.profileSource ?? '';
    const confidence = normalizeConfidence(item.confidence);
    const base = {
      fieldId,
      index,
      label: item.label ?? field.label,
      profileSource: sourcePath,
      sourcePath,
      strategy: item.strategy ?? 'text',
      confidence: confidence.label,
      confidenceScore: confidence.score,
      reason: item.reason ?? '',
      searchValues: item.searchValues,
      acceptValues: item.acceptValues,
      allowFreeText: item.allowFreeText,
      dependsOn: item.dependsOn,
      reviewRequired: item.reviewRequired,
    };
    if (field.sensitiveType && !['phone', 'email', 'id_card'].includes(field.sensitiveType)) {
      return [{
        ...base,
        expectedValue: '',
        strategy: 'skip',
        reason: `Skipped sensitive or human-only field: ${field.sensitiveType}`,
        source: 'llm',
        safety: field.sensitiveType === 'upload' ? 'skip_upload' : 'skip_sensitive',
      }];
    }
    if (item.generatedValue) {
      return [{
        ...base,
        profileSource: '',
        sourcePath: '',
        expectedValue: item.generatedValue,
        value: item.generatedValue,
        valueKind: 'generated',
        strategy: item.strategy === 'skip'
          ? inferHeuristicStrategy(field, '', item.generatedValue)
          : item.strategy ?? inferHeuristicStrategy(field, '', item.generatedValue),
        reason: item.reason ?? 'AI generated value requires review.',
        source: 'generated',
        safety: 'fill_requires_review',
        reviewRequired: true,
      }];
    }
    if (item.valueKind === 'generated') {
      const generated = item.value ?? '';
      return [{
        ...base,
        profileSource: '',
        sourcePath: '',
        expectedValue: generated,
        value: generated,
        valueKind: 'generated',
        reason: item.reason ?? 'AI generated value requires review.',
        source: 'generated',
        safety: generated ? 'fill_requires_review' : 'skip_generated',
        reviewRequired: true,
      }];
    }
    const expectedValue = sourcePath ? resolveFactValue(facts, sourcePath) : '';
    if (!sourcePath || !expectedValue) {
      return [{
        ...base,
        expectedValue: '',
        strategy: item.strategy === 'skip'
          ? inferHeuristicStrategy(field, '', '')
          : item.strategy ?? inferHeuristicStrategy(field, '', ''),
        reason: item.reason ?? 'No matching local profile value. User should review or fill manually.',
        source: 'llm',
        safety: 'needs_user_input',
        reviewRequired: true,
      }];
    }
    return [{
      ...base,
      expectedValue,
      value: expectedValue,
      valueKind: item.valueKind ?? 'profile',
      strategy: item.strategy === 'skip'
        ? inferHeuristicStrategy(field, sourcePath, expectedValue)
        : item.strategy ?? inferHeuristicStrategy(field, sourcePath, expectedValue),
      reason: item.reason ?? '',
      source: 'llm',
      safety: confidence.label === 'low' ? 'fill_requires_review' : 'fill',
      reviewRequired: item.reviewRequired ?? confidence.label === 'low',
    }];
  });
}

interface HeuristicRule {
  pathCandidates: string[];
  keywords: string[];
  excludes?: string[];
  fixedValue?: (facts: ProfileFact[], field: PlannerField) => string;
}

const FIELD_RULES: HeuristicRule[] = [
  { pathCandidates: ['education[0].advisor'], keywords: ['导师姓名', '导师', 'supervisor', 'advisor'] },
  { pathCandidates: ['education[0].schoolLocation'], keywords: ['学校所在地', '院校所在地', '学校地址'] },
  { pathCandidates: ['education[0].department', 'education[0].major'], keywords: ['所在院系', '研究所', '院系', '学院'] },
  { pathCandidates: ['education[0].school'], keywords: ['学校名称', '学校全称', '院校名称', '毕业院校', '学校'], excludes: ['学校所在地'] },
  { pathCandidates: ['education[0].educationLevel', 'education[0].degree'], keywords: ['学历'] },
  { pathCandidates: ['education[0].educationType'], keywords: ['学历类型', '受教育类型', '培养方式'] },
  { pathCandidates: ['education[0].majorCategory'], keywords: ['专业类别', '专业分类'] },
  { pathCandidates: ['education[0].majorRank'], keywords: ['成绩排名', '专业排名', '排名'] },
  { pathCandidates: ['education[0].major'], keywords: ['专业名称', '所学专业', '专业'], excludes: ['专业类别', '专业分类', '专业排名'] },
  { pathCandidates: ['education[0].gpa'], keywords: ['gpa', 'cgpa', '绩点', '成绩'] },
  { pathCandidates: ['education[0].startDate'], keywords: ['入学时间', '起始时间', '开始时间', '开始日期'] },
  { pathCandidates: ['education[0].endDate'], keywords: ['毕业时间', '结束时间', '结束日期'] },
  { pathCandidates: ['basic.birthday'], keywords: ['出生日期', '出生时间', '生日', 'birth'] },
  { pathCandidates: ['basic.phone'], keywords: ['联系电话', '联系手机', '手机号', '手机号码', '电话', 'phone', 'mobile', 'tel'] },
  { pathCandidates: ['basic.email'], keywords: ['电子邮箱', '邮箱', 'email', 'mail'] },
  { pathCandidates: ['basic.gender'], keywords: ['性别', 'gender', 'sex'] },
  { pathCandidates: ['basic.nationality'], keywords: ['国籍', '国家/地区', '国家地区', 'nationality'] },
  { pathCandidates: ['basic.ethnicity'], keywords: ['民族', 'ethnicity'] },
  { pathCandidates: ['basic.politicalStatus'], keywords: ['政治面貌', '政治状态'] },
  { pathCandidates: ['basic.nativePlace'], keywords: ['籍贯', '出生地', '户籍地'] },
  { pathCandidates: ['basic.location'], keywords: ['现居地', '所在城市', '居住城市', '当前城市'] },
  {
    pathCandidates: [],
    keywords: ['证件类型', '证件类别', '身份证件类型'],
    fixedValue: (facts, field) => {
      const nationality = resolveFactValue(facts, 'basic.nationality');
      const options = Array.isArray(field.options) ? field.options.join(' ') : '';
      if (/中国/.test(nationality) && /居民身份证|身份证/.test(options)) return '中国-居民身份证';
      return '';
    },
  },
  { pathCandidates: ['basic.name'], keywords: ['姓名', '真实姓名', '中文名', 'name'], excludes: ['导师姓名', '英文名'] },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function fieldSearchText(field: PlannerField): string {
  return normalizeText([
    field.label,
    field.hint,
    field.placeholder,
    field.ariaLabel,
    field.name,
    field.id,
    field.context,
  ].filter(Boolean).join(' '));
}

function includesAny(text: string, values: string[] | undefined): boolean {
  return Boolean(values?.some((value) => text.includes(normalizeText(value))));
}

function findRuleForField(field: PlannerField): HeuristicRule | null {
  const text = fieldSearchText(field);
  return FIELD_RULES.find((rule) => (
    includesAny(text, rule.keywords) && !includesAny(text, rule.excludes)
  )) ?? null;
}

function firstFactValue(facts: ProfileFact[], paths: string[]): { path: string; value: string } | null {
  for (const path of paths) {
    const value = resolveFactValue(facts, path);
    if (value) return { path, value };
  }
  return null;
}

function inferHeuristicStrategy(field: PlannerField, sourcePath: string, value: string): FillPlanItem['strategy'] {
  if (
    ['basic.location', 'basic.nativePlace', 'education[0].schoolLocation'].includes(sourcePath)
    && ['select', 'custom-select', 'cascader-region'].includes(field.inputType)
    && value.split(/[,\s/|>，、]+/).filter(Boolean).length > 1
  ) {
    return 'cascader-region';
  }
  if (field.inputType === 'unknown' || field.inputType === 'file') return 'text';
  return field.inputType;
}

function buildHeuristicPlanItem(field: PlannerField, facts: ProfileFact[]): FillPlanItem | null {
  if (field.inputType === 'file') return null;
  if (field.sensitiveType && UNSAFE_SENSITIVE_TYPES.has(field.sensitiveType)) return null;
  const rule = findRuleForField(field);
  if (!rule) return null;
  const fact = firstFactValue(facts, rule.pathCandidates);
  const fixedValue = rule.fixedValue?.(facts, field) ?? '';
  const sourcePath = fact?.path ?? '';
  const expectedValue = fact?.value ?? fixedValue;
  if (!expectedValue) return null;
  const strategy = inferHeuristicStrategy(field, sourcePath, expectedValue);
  return {
    fieldId: field.fieldId,
    index: field.index,
    label: field.label,
    profileSource: sourcePath,
    sourcePath,
    expectedValue,
    value: expectedValue,
    valueKind: sourcePath ? 'profile' : 'manual',
    strategy,
    confidence: sourcePath ? 'high' : 'medium',
    confidenceScore: sourcePath ? 0.9 : 0.7,
    reason: sourcePath
      ? `Local common-field fallback matched ${sourcePath}.`
      : 'Local common-field fallback supplied a safe default.',
    source: 'heuristic',
    reviewRequired: !sourcePath,
    safety: sourcePath ? 'fill' : 'fill_requires_review',
  };
}

function buildUnfilledPlanItem(field: PlannerField): FillPlanItem {
  if (field.inputType === 'file') {
    return {
      fieldId: field.fieldId,
      index: field.index,
      label: field.label,
      profileSource: '',
      sourcePath: '',
      expectedValue: '',
      strategy: 'skip',
      confidence: 'high',
      confidenceScore: 1,
      reason: 'File upload requires human action.',
      source: 'heuristic',
      safety: 'skip_upload',
    };
  }
  if (field.sensitiveType && UNSAFE_SENSITIVE_TYPES.has(field.sensitiveType)) {
    return {
      fieldId: field.fieldId,
      index: field.index,
      label: field.label,
      profileSource: '',
      sourcePath: '',
      expectedValue: '',
      strategy: 'skip',
      confidence: 'high',
      confidenceScore: 1,
      reason: `Skipped sensitive or human-only field: ${field.sensitiveType}.`,
      source: 'heuristic',
      safety: field.sensitiveType === 'upload' ? 'skip_upload' : 'skip_sensitive',
    };
  }
  return {
    fieldId: field.fieldId,
    index: field.index,
    label: field.label,
    profileSource: '',
    sourcePath: '',
    expectedValue: '',
    strategy: inferHeuristicStrategy(field, '', ''),
    confidence: 'low',
    confidenceScore: 0.2,
    reason: 'No matching local profile value. User should review or fill manually.',
    source: 'heuristic',
    reviewRequired: true,
    safety: 'needs_user_input',
  };
}

function shouldReplaceWithHeuristic(item: FillPlanItem | undefined): boolean {
  if (!item) return true;
  if (item.safety === 'skip_sensitive' || item.safety === 'skip_upload') return false;
  return item.safety === 'skip_unknown'
    || item.safety === 'skip_low_confidence'
    || item.safety === 'skip_generated'
    || !item.expectedValue;
}

export function enrichPlanWithHeuristicFallback(
  plan: FillPlanItem[],
  facts: ProfileFact[],
  fields: PlannerField[],
): FillPlanItem[] {
  const byFieldId = new Map(plan.map((item) => [item.fieldId, item]));
  const merged: FillPlanItem[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const existing = byFieldId.get(field.fieldId);
    const fallback = buildHeuristicPlanItem(field, facts);
    const next = fallback && shouldReplaceWithHeuristic(existing)
      ? fallback
      : existing ?? buildUnfilledPlanItem(field);
    if (next) {
      merged.push(next);
      seen.add(next.fieldId);
    }
  }

  for (const item of plan) {
    if (!seen.has(item.fieldId)) merged.push(item);
  }

  return merged;
}

export async function planWithLlm(
  fields: PlannerField[],
  facts: ProfileFact[],
  apiConfig: ApiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FillPlanItem[]> {
  if (fields.length > MAX_FIELDS_PER_LLM_REQUEST) {
    const chunks: PlannerField[][] = [];
    for (let i = 0; i < fields.length; i += MAX_FIELDS_PER_LLM_REQUEST) {
      chunks.push(fields.slice(i, i + MAX_FIELDS_PER_LLM_REQUEST));
    }
    const plans: FillPlanItem[] = [];
    for (const chunk of chunks) {
      plans.push(...await requestPlanWithLlm(chunk, facts, apiConfig, fetchImpl));
    }
    return plans;
  }
  return requestPlanWithLlm(fields, facts, apiConfig, fetchImpl);
}

async function requestPlanWithLlm(
  fields: PlannerField[],
  facts: ProfileFact[],
  apiConfig: ApiConfig,
  fetchImpl: typeof fetch,
): Promise<FillPlanItem[]> {
  const safeFacts = redactFactsForLlm(facts);
  const prompt = buildPlannerPrompt(fields, safeFacts);
  const baseUrl = apiConfig.baseUrl
    .trim()
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: apiConfig.model.trim(),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch {
      detail = '';
    }
    throw new Error(`LLM API error ${response.status}${detail}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '[]';
  return enrichPlanWithHeuristicFallback(
    materializeLlmPlan(parsePlannerResponse(content), facts, fields),
    facts,
    fields,
  );
}
