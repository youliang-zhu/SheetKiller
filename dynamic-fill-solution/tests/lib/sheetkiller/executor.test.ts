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

  it('can rescan before executing each plan item', async () => {
    const stale = document.createElement('input');
    const fresh = document.createElement('input');
    document.body.appendChild(fresh);
    const plan: FillPlanItem[] = [{
      fieldId: 'name',
      profileSource: 'basic.name',
      expectedValue: 'Rescanned Name',
      strategy: 'text',
      confidence: 'high',
      reason: 'Name label matched.',
      source: 'llm',
      safety: 'fill',
    }];

    const result = await executeFillPlan([field(stale)], plan, {
      rescan: () => [field(fresh)],
    });

    expect(result.filled).toBe(1);
    expect(stale.value).toBe('');
    expect(fresh.value).toBe('Rescanned Name');
  });

  it('reports user-input items without attempting to fill them', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const plan: FillPlanItem[] = [{
      fieldId: 'name',
      profileSource: '',
      expectedValue: '',
      strategy: 'text',
      confidence: 'low',
      reason: 'No matching local profile value.',
      source: 'heuristic',
      safety: 'needs_user_input',
      reviewRequired: true,
    }];

    const result = await executeFillPlan([field(input)], plan);

    expect(result.filled).toBe(0);
    expect(result.needsInput).toBe(1);
    expect(input.value).toBe('');
    expect(result.reports[0].status).toBe('needs_user_input');
  });
});
