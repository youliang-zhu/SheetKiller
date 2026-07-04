import { describe, expect, it } from 'vitest';
import {
  buildExecutionDebug,
  buildPlannedDebugRun,
  clearDebugRuns,
  createDebugRunId,
  getLatestDebugRun,
  listDebugRuns,
  patchDebugRun,
  upsertDebugRun,
} from '@/lib/sheetkiller/debug/debug-run-store';
import type { FillPlanItem, SerializableFieldInventoryItem } from '@/lib/sheetkiller/types';
import type { DynamicFillExecution } from '@/lib/sheetkiller/executor/dynamic-fill';

function field(partial: Partial<SerializableFieldInventoryItem>): SerializableFieldInventoryItem {
  return {
    fieldId: 'field-0',
    index: 0,
    inputType: 'text',
    label: '联系手机',
    hint: '',
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    section: '',
    context: '',
    htmlSnippet: '<input />',
    options: [],
    currentValue: '13925188297',
    required: false,
    visible: true,
    sensitiveType: 'phone',
    source: 'generic-scan',
    ...partial,
  };
}

function plan(partial: Partial<FillPlanItem>): FillPlanItem {
  return {
    fieldId: 'field-0',
    index: 0,
    label: '联系手机',
    profileSource: 'basic.phone',
    sourcePath: 'basic.phone',
    expectedValue: '13925188297',
    strategy: 'text',
    confidence: 'high',
    reason: 'Matched phone.',
    source: 'llm',
    safety: 'fill',
    ...partial,
  };
}

const page = {
  url: 'https://jobs.example.com/apply',
  domain: 'jobs.example.com',
  title: 'Apply',
};

const extension = {
  version: '0.1.0',
  userAgent: 'vitest',
};

describe('SheetKiller debug run store', () => {
  it('stores planned runs with masked sensitive values', async () => {
    const run = buildPlannedDebugRun({
      id: createDebugRunId('jobs.example.com'),
      page,
      extension,
      fields: [field({})],
      plan: [plan({})],
      summary: { total: 1, fillable: 1, needsInput: 0, skipped: 0, review: 0 },
    });

    await upsertDebugRun(run);

    const latest = await getLatestDebugRun();
    expect(latest?.scan?.fields[0].currentValueMasked).toBe('*******8297');
    expect(latest?.plan?.items[0].expectedMasked).toBe('*******8297');
  });

  it('keeps only the newest 20 runs', async () => {
    for (let i = 0; i < 25; i++) {
      await upsertDebugRun(buildPlannedDebugRun({
        id: `run-${i}`,
        page,
        extension,
        fields: [field({ fieldId: `field-${i}` })],
        plan: [plan({ fieldId: `field-${i}` })],
        summary: { total: 1, fillable: 1, needsInput: 0, skipped: 0, review: 0 },
      }));
    }

    const runs = await listDebugRuns();
    expect(runs).toHaveLength(20);
    expect(runs.some((run) => run.id === 'run-0')).toBe(false);
  });

  it('patches execution details onto an existing run', async () => {
    await upsertDebugRun(buildPlannedDebugRun({
      id: 'run-exec',
      page,
      extension,
      fields: [field({})],
      plan: [plan({})],
      summary: { total: 1, fillable: 1, needsInput: 0, skipped: 0, review: 0 },
    }));

    const execution: DynamicFillExecution = {
      filled: 1,
      needsInput: 0,
      skipped: 0,
      failed: 0,
      reports: [{
        fieldId: 'field-0',
        label: '联系手机',
        profileSource: 'basic.phone',
        expectedMasked: '*******8297',
        actualMasked: '*******8297',
        status: 'filled_and_verified',
        reason: 'Expected value matched page value.',
      }],
      debugItems: [],
    };

    await patchDebugRun('run-exec', {
      status: 'filled',
      execution: buildExecutionDebug(execution),
    });

    const latest = await getLatestDebugRun();
    expect(latest?.status).toBe('filled');
    expect(latest?.execution?.summary.filled).toBe(1);

    await clearDebugRuns();
    expect(await listDebugRuns()).toEqual([]);
  });
});
