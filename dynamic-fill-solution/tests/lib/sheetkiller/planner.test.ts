import { describe, expect, it } from 'vitest';
import { redactFactForLlm } from '@/lib/sheetkiller/profile/facts';
import {
  buildPlannerPrompt,
  enrichPlanWithHeuristicFallback,
  materializeLlmPlan,
  parsePlannerResponse,
  planWithLlm,
} from '@/lib/sheetkiller/planner/llm-planner';
import type { FieldInventoryItem, ProfileFact } from '@/lib/sheetkiller/types';

function field(partial: Partial<FieldInventoryItem>): FieldInventoryItem {
  const input = document.createElement('input');
  return {
    fieldId: 'field-0',
    element: input,
    inputType: 'text',
    label: '姓名',
    hint: '',
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    section: '',
    context: '',
    htmlSnippet: '',
    options: [],
    currentValue: '',
    required: false,
    visible: true,
    source: 'generic-scan',
    ...partial,
  };
}

describe('SheetKiller LLM planner', () => {
  it('redacts sensitive profile values before prompt construction', () => {
    const fact: ProfileFact = {
      path: 'id_number',
      label: '身份证号',
      value: '430000199901011234',
      aliases: ['证件号码'],
      sensitive: true,
      provenance: 'profile.json',
    };

    const redacted = redactFactForLlm(fact);
    const prompt = buildPlannerPrompt([field({ label: '证件号码' })], [redacted]);

    expect(redacted.value).toBeUndefined();
    expect(redacted.hasValue).toBe(true);
    expect(prompt).not.toContain('430000199901011234');
    expect(prompt).toContain('id_number');
  });

  it('materializes profileSource locally and keeps generated answers for review', () => {
    const facts: ProfileFact[] = [{
      path: 'basic.name',
      label: '姓名',
      value: '张三',
      aliases: ['姓名'],
      sensitive: false,
      provenance: 'profile.json',
    }];
    const fields = [field({ fieldId: 'name-field' }), field({ fieldId: 'essay-field', label: '为什么选择我们' })];
    const raw = parsePlannerResponse(JSON.stringify([
      { fieldId: 'name-field', profileSource: 'basic.name', strategy: 'text', confidence: 'high' },
      { fieldId: 'essay-field', generatedValue: '我非常认可贵公司。', strategy: 'textarea', confidence: 'high' },
    ]));

    const plan = materializeLlmPlan(raw, facts, fields);

    expect(plan[0]).toMatchObject({
      expectedValue: '张三',
      safety: 'fill',
      source: 'llm',
    });
    expect(plan[1]).toMatchObject({
      strategy: 'textarea',
      safety: 'fill_requires_review',
      source: 'generated',
      reviewRequired: true,
    });
  });

  it('materializes v2 sourcePath by scan index and marks low confidence for review', () => {
    const facts: ProfileFact[] = [{
      path: 'basic.email',
      label: 'Email',
      value: 'li@example.com',
      aliases: ['email'],
      sensitive: true,
      provenance: 'profile.json',
    }];
    const fields = [field({ fieldId: 'field-3', index: 3, label: 'Email address' })];
    const raw = parsePlannerResponse(JSON.stringify([
      {
        index: 3,
        sourcePath: 'basic.email',
        strategy: 'text',
        confidence: 0.42,
        reason: 'Email label matched.',
      },
    ]));

    const plan = materializeLlmPlan(raw, facts, fields);

    expect(plan[0]).toMatchObject({
      fieldId: 'field-3',
      index: 3,
      sourcePath: 'basic.email',
      expectedValue: 'li@example.com',
      safety: 'fill_requires_review',
      reviewRequired: true,
    });
  });

  it('allows v2 generated values only when explicitly marked for review', () => {
    const fields = [field({ fieldId: 'essay-field', label: 'Why us?' })];
    const raw = parsePlannerResponse(JSON.stringify([
      {
        fieldId: 'essay-field',
        valueKind: 'generated',
        value: 'I am interested because the role matches my background.',
        strategy: 'textarea',
        confidence: 0.8,
        reviewRequired: true,
      },
    ]));

    const plan = materializeLlmPlan(raw, [], fields);

    expect(plan[0]).toMatchObject({
      expectedValue: 'I am interested because the role matches my background.',
      valueKind: 'generated',
      safety: 'fill_requires_review',
      reviewRequired: true,
    });
  });

  it('adds deterministic fallback plans for common application fields omitted by the LLM', async () => {
    const facts: ProfileFact[] = [
      {
        path: 'basic.birthday',
        label: 'Birthday',
        value: '2002-11-24',
        aliases: ['birthday'],
        sensitive: false,
        provenance: 'profile.json',
      },
      {
        path: 'education[0].school',
        label: 'school',
        value: '洛桑联邦理工学院',
        aliases: ['school'],
        sensitive: false,
        provenance: 'profile.json',
      },
    ];
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '[]' } }],
    }), { status: 200 });

    const plan = await planWithLlm([
      field({ fieldId: 'birthday', index: 0, label: '出生日期', inputType: 'date' }),
      field({ fieldId: 'school', index: 1, label: '学校名称' }),
    ], facts, {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
    }, fetchImpl as typeof fetch);

    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldId: 'birthday',
        expectedValue: '2002-11-24',
        sourcePath: 'basic.birthday',
        source: 'heuristic',
        safety: 'fill',
      }),
      expect.objectContaining({
        fieldId: 'school',
        expectedValue: '洛桑联邦理工学院',
        sourcePath: 'education[0].school',
        source: 'heuristic',
        safety: 'fill',
      }),
    ]));
  });

  it('replaces skip_unknown plans with deterministic fallback when a common field matches', () => {
    const facts: ProfileFact[] = [{
      path: 'basic.nationality',
      label: 'Nationality',
      value: '中国',
      aliases: ['nationality'],
      sensitive: false,
      provenance: 'profile.json',
    }];
    const fields = [field({ fieldId: 'nationality', label: '国籍（国家/地区）', inputType: 'select' })];
    const skipped = materializeLlmPlan(parsePlannerResponse(JSON.stringify([
      { fieldId: 'nationality', strategy: 'skip', reason: 'No match.' },
    ])), facts, fields);

    const enriched = enrichPlanWithHeuristicFallback(skipped, facts, fields);

    expect(enriched[0]).toMatchObject({
      fieldId: 'nationality',
      expectedValue: '中国',
      sourcePath: 'basic.nationality',
      strategy: 'select',
      safety: 'fill',
    });
  });

  it('keeps unmatched safe scanned fields in the plan as user-input items', () => {
    const fields = [
      field({
        fieldId: 'unknown-safe-field',
        label: 'Custom question',
        inputType: 'textarea',
      }),
    ];

    const plan = enrichPlanWithHeuristicFallback([], [], fields);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      fieldId: 'unknown-safe-field',
      expectedValue: '',
      strategy: 'textarea',
      safety: 'needs_user_input',
      reviewRequired: true,
    });
  });

  it('still safely skips file uploads and human-only sensitive fields', () => {
    const upload = field({
      fieldId: 'resume-upload',
      label: 'Resume upload',
      inputType: 'file',
      sensitiveType: 'upload',
    });
    const captcha = field({
      fieldId: 'captcha',
      label: 'Captcha',
      sensitiveType: 'captcha',
    });

    const plan = enrichPlanWithHeuristicFallback([], [], [upload, captcha]);

    expect(plan).toEqual([
      expect.objectContaining({
        fieldId: 'resume-upload',
        strategy: 'skip',
        safety: 'skip_upload',
      }),
      expect.objectContaining({
        fieldId: 'captcha',
        strategy: 'skip',
        safety: 'skip_sensitive',
      }),
    ]);
  });

  it('normalizes copied API base URLs before calling the planner provider', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('temperature');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '[]' } }],
      }), { status: 200 });
    };

    await planWithLlm([], [], {
      apiKey: ' test-key ',
      baseUrl: ' https://api.openai.com/v1/chat/completions/ ',
      model: ' gpt-5.5 ',
    }, fetchImpl as typeof fetch);
  });

  it('chunks large field inventories to keep planner requests small', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '[]' } }],
      }), { status: 200 });
    };
    const manyFields = Array.from({ length: 80 }, (_, index) => field({
      fieldId: `field-${index}`,
      index,
      label: `字段${index}`,
    }));

    await planWithLlm(manyFields, [], {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
    }, fetchImpl as typeof fetch);

    expect(calls).toHaveLength(3);
  });

  it('truncates long select option lists in the planner prompt', () => {
    const prompt = buildPlannerPrompt([
      field({
        label: '城市',
        options: Array.from({ length: 90 }, (_, index) => `城市选项-${index}-${'x'.repeat(200)}`),
      }),
    ], []);

    expect(prompt).toContain('"optionsTruncated": true');
    expect(prompt).toContain('城市选项-59');
    expect(prompt).not.toContain('城市选项-60');
    expect(prompt).not.toContain('x'.repeat(160));
  });

  it('includes provider error details when planner requests are rejected', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      error: {
        message: 'Unsupported value: temperature is not supported.',
      },
    }), { status: 400 });

    await expect(planWithLlm([], [], {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
    }, fetchImpl as typeof fetch)).rejects.toThrow('Unsupported value');
  });
});
