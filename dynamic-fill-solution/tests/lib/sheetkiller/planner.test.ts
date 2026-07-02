import { describe, expect, it } from 'vitest';
import { redactFactForLlm } from '@/lib/sheetkiller/profile/facts';
import {
  buildPlannerPrompt,
  materializeLlmPlan,
  parsePlannerResponse,
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

  it('materializes profileSource locally and skips generated answers in MVP', () => {
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
      strategy: 'skip',
      safety: 'skip_generated',
      source: 'generated',
    });
  });
});

