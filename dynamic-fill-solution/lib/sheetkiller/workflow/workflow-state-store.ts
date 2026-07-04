import type { FillPlanItem } from '@/lib/sheetkiller/types';
import type { DynamicFillExecution } from '@/lib/sheetkiller/executor/dynamic-fill';

export type WorkflowPhase = 'idle' | 'connect' | 'scan' | 'ai' | 'build';
export type WorkflowState = 'idle' | 'planning' | 'planned' | 'preview' | 'filling' | 'done' | 'error';

export interface StoredPlanResponse {
  plan: FillPlanItem[];
  summary: {
    total: number;
    fillable: number;
    needsInput: number;
    skipped: number;
    review: number;
  };
}

export interface SheetKillerWorkflowSnapshot {
  runId: string | null;
  tabId: number | null;
  pageUrl: string;
  pageDomain: string;
  state: WorkflowState;
  phase: WorkflowPhase;
  scannedCount: number;
  planData: StoredPlanResponse | null;
  execution: DynamicFillExecution | null;
  error: string;
  updatedAt: number;
}

const KEY = 'sheetkiller:workflowSnapshot';
export const WORKFLOW_STALE_MS = 90_000;

function storageArea(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

export async function getWorkflowSnapshot(): Promise<SheetKillerWorkflowSnapshot | null> {
  const result = await storageArea().get(KEY);
  return (result[KEY] as SheetKillerWorkflowSnapshot | undefined) ?? null;
}

export async function saveWorkflowSnapshot(
  snapshot: Omit<SheetKillerWorkflowSnapshot, 'updatedAt'>,
): Promise<SheetKillerWorkflowSnapshot> {
  const withTime: SheetKillerWorkflowSnapshot = {
    ...snapshot,
    updatedAt: Date.now(),
  };
  await storageArea().set({ [KEY]: withTime });
  return withTime;
}

export async function clearWorkflowSnapshot(): Promise<void> {
  const storage = storageArea();
  if (storage.remove) {
    await storage.remove(KEY);
  } else {
    await storage.set({ [KEY]: undefined });
  }
}

export function snapshotMatchesTab(
  snapshot: SheetKillerWorkflowSnapshot | null,
  tab: Pick<chrome.tabs.Tab, 'id' | 'url'>,
): snapshot is SheetKillerWorkflowSnapshot {
  if (!snapshot) return false;
  if (snapshot.tabId !== null && tab.id !== snapshot.tabId) return false;
  return Boolean(tab.url && snapshot.pageUrl === tab.url);
}

export function isStaleRunningSnapshot(
  snapshot: SheetKillerWorkflowSnapshot,
  now = Date.now(),
): boolean {
  return (snapshot.state === 'planning' || snapshot.state === 'filling')
    && now - snapshot.updatedAt > WORKFLOW_STALE_MS;
}
