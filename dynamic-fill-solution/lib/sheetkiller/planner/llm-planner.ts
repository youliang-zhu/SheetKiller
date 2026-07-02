import type {
  Confidence,
  FieldInventoryItem,
  FillPlanItem,
  LlmSafeProfileFact,
  ProfileFact,
} from '@/lib/sheetkiller/types';
import { redactFactsForLlm, resolveFactValue } from '@/lib/sheetkiller/profile/facts';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmRawPlanItem {
  fieldId: string;
  profileSource?: string;
  strategy?: FillPlanItem['strategy'];
  confidence?: Confidence;
  reason?: string;
  generatedValue?: string;
}

function truncate(value: string, max = 600): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export function buildPlannerPrompt(
  fields: FieldInventoryItem[],
  facts: LlmSafeProfileFact[],
): string {
  const fieldLines = fields.map((field) => ({
    fieldId: field.fieldId,
    inputType: field.inputType,
    label: field.label,
    hint: field.hint,
    placeholder: field.placeholder,
    ariaLabel: field.ariaLabel,
    name: field.name,
    id: field.id,
    options: field.options,
    context: truncate(field.context),
    html: truncate(field.htmlSnippet),
    sensitiveType: field.sensitiveType,
  }));

  return [
    'You are SheetKiller field planner. Match web form fields to local profile facts.',
    'Return only a JSON array.',
    'Do not invent facts. Do not decide to submit. Do not fill uploads, captcha, verify codes, passwords, or identity checks.',
    'For sensitive profile facts, you only see metadata. Return profileSource; local code will resolve the real value.',
    'For open-ended generated answers, return no item unless explicitly allowed. In this MVP, generated answers must be skipped.',
    'Each item: fieldId, profileSource, strategy, confidence, reason.',
    'strategy must be one of text, textarea, select, radio, checkbox, date, custom-select, cascader-region, contenteditable, skip.',
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
    fieldId: String(item.fieldId ?? ''),
    profileSource: item.profileSource === undefined ? undefined : String(item.profileSource),
    strategy: item.strategy,
    confidence: item.confidence,
    reason: item.reason === undefined ? undefined : String(item.reason),
    generatedValue: item.generatedValue === undefined ? undefined : String(item.generatedValue),
  })).filter((item) => item.fieldId);
}

export function materializeLlmPlan(
  raw: LlmRawPlanItem[],
  facts: ProfileFact[],
  fields: FieldInventoryItem[],
): FillPlanItem[] {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  return raw.flatMap((item): FillPlanItem[] => {
    const field = fieldById.get(item.fieldId);
    if (!field) return [];
    if (field.sensitiveType && !['phone', 'email', 'id_card'].includes(field.sensitiveType)) {
      return [{
        fieldId: item.fieldId,
        profileSource: item.profileSource ?? '',
        expectedValue: '',
        strategy: 'skip',
        confidence: item.confidence ?? 'low',
        reason: `Skipped sensitive or human-only field: ${field.sensitiveType}`,
        source: 'llm',
        safety: field.sensitiveType === 'upload' ? 'skip_upload' : 'skip_sensitive',
      }];
    }
    if (item.generatedValue) {
      return [{
        fieldId: item.fieldId,
        profileSource: '',
        expectedValue: item.generatedValue,
        strategy: 'skip',
        confidence: 'low',
        reason: item.reason ?? 'Generated answers require manual review in MVP.',
        source: 'generated',
        safety: 'skip_generated',
      }];
    }
    const profileSource = item.profileSource ?? '';
    const expectedValue = profileSource ? resolveFactValue(facts, profileSource) : '';
    if (!profileSource || !expectedValue) {
      return [{
        fieldId: item.fieldId,
        profileSource,
        expectedValue: '',
        strategy: 'skip',
        confidence: item.confidence ?? 'low',
        reason: item.reason ?? 'No resolvable local profile value.',
        source: 'llm',
        safety: 'skip_unknown',
      }];
    }
    const confidence = item.confidence ?? 'medium';
    return [{
      fieldId: item.fieldId,
      profileSource,
      expectedValue,
      strategy: item.strategy ?? 'text',
      confidence,
      reason: item.reason ?? '',
      source: 'llm',
      safety: confidence === 'low' ? 'skip_low_confidence' : 'fill',
    }];
  });
}

export async function planWithLlm(
  fields: FieldInventoryItem[],
  facts: ProfileFact[],
  apiConfig: ApiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FillPlanItem[]> {
  const safeFacts = redactFactsForLlm(facts);
  const prompt = buildPlannerPrompt(fields, safeFacts);
  const response = await fetchImpl(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: apiConfig.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`LLM API error ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '[]';
  return materializeLlmPlan(parsePlannerResponse(content), facts, fields);
}

