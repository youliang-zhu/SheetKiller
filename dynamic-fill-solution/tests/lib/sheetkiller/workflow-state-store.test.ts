import { describe, expect, it } from 'vitest';
import {
  clearWorkflowSnapshot,
  getWorkflowSnapshot,
  isStaleRunningSnapshot,
  saveWorkflowSnapshot,
  snapshotMatchesTab,
  WORKFLOW_STALE_MS,
} from '@/lib/sheetkiller/workflow/workflow-state-store';

describe('SheetKiller workflow state store', () => {
  it('saves and restores popup workflow state from session storage', async () => {
    await saveWorkflowSnapshot({
      runId: 'run-1',
      tabId: 12,
      pageUrl: 'https://careers.example.com/resume',
      pageDomain: 'careers.example.com',
      state: 'planned',
      phase: 'idle',
      scannedCount: 3,
      planData: {
        plan: [],
        summary: { total: 0, fillable: 0, needsInput: 0, skipped: 0, review: 0 },
      },
      execution: null,
      error: '',
    });

    const restored = await getWorkflowSnapshot();

    expect(restored?.runId).toBe('run-1');
    expect(restored?.state).toBe('planned');
    expect(snapshotMatchesTab(restored, { id: 12, url: 'https://careers.example.com/resume' })).toBe(true);
  });

  it('detects stale running workflow snapshots', async () => {
    const snapshot = await saveWorkflowSnapshot({
      runId: 'run-2',
      tabId: 1,
      pageUrl: 'https://careers.example.com/resume',
      pageDomain: 'careers.example.com',
      state: 'planning',
      phase: 'ai',
      scannedCount: 10,
      planData: null,
      execution: null,
      error: '',
    });

    expect(isStaleRunningSnapshot(snapshot, snapshot.updatedAt + WORKFLOW_STALE_MS + 1)).toBe(true);
  });

  it('can clear the stored snapshot', async () => {
    await saveWorkflowSnapshot({
      runId: 'run-3',
      tabId: 1,
      pageUrl: 'https://careers.example.com/resume',
      pageDomain: 'careers.example.com',
      state: 'done',
      phase: 'idle',
      scannedCount: 1,
      planData: null,
      execution: null,
      error: '',
    });

    await clearWorkflowSnapshot();

    expect(await getWorkflowSnapshot()).toBeNull();
  });
});
