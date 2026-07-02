import { describe, expect, it } from 'vitest';
import { executeFillPlan } from '@/lib/sheetkiller/executor/dynamic-fill';
import type { FieldInventoryItem, FillPlanItem } from '@/lib/sheetkiller/types';

function field(element: Element): FieldInventoryItem {
  return {
    fieldId: 'name',
    element,
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
  };
}

describe('SheetKiller dynamic fill executor', () => {
  it('fills and verifies a planned field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const plan: FillPlanItem[] = [{
      fieldId: 'name',
      profileSource: 'basic.name',
      expectedValue: '张三',
      strategy: 'text',
      confidence: 'high',
      reason: 'Name label matched.',
      source: 'llm',
      safety: 'fill',
    }];

    const result = await executeFillPlan([field(input)], plan);

    expect(result.filled).toBe(1);
    expect(result.reports[0].status).toBe('filled_and_verified');
  });
});

