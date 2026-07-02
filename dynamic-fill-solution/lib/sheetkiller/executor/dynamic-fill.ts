import { fillElement } from '@/lib/engine/heuristic/fillers';
import type { FieldInventoryItem, FillPlanItem, SheetKillerReportItem } from '@/lib/sheetkiller/types';
import { reportFromPlanAndVerification } from '@/lib/sheetkiller/report/report';
import { isFinalSubmitElement } from '@/lib/sheetkiller/safety/submit-guard';
import { verifyFieldValue } from '@/lib/sheetkiller/verifier/verifier';

export interface DynamicFillExecution {
  reports: SheetKillerReportItem[];
  filled: number;
  skipped: number;
  failed: number;
}

export async function executeFillPlan(
  fields: FieldInventoryItem[],
  plan: FillPlanItem[],
): Promise<DynamicFillExecution> {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const reports: SheetKillerReportItem[] = [];

  for (const item of plan) {
    const field = fieldById.get(item.fieldId);
    if (!field) {
      reports.push({
        fieldId: item.fieldId,
        label: '',
        profileSource: item.profileSource,
        status: 'failed_to_fill',
        reason: 'Field no longer exists on the page.',
      });
      continue;
    }

    if (item.strategy === 'skip' || item.safety.startsWith('skip_')) {
      reports.push(reportFromPlanAndVerification(item, field.label, false));
      continue;
    }

    if (isFinalSubmitElement(field.element)) {
      reports.push({
        fieldId: field.fieldId,
        label: field.label,
        profileSource: item.profileSource,
        status: 'skipped_requires_human',
        reason: 'Final submit-like element was blocked by safety guard.',
      });
      continue;
    }

    let filled = false;
    try {
      filled = await fillElement(field.element, item.expectedValue, item.strategy);
    } catch {
      filled = false;
    }

    const verification = filled
      ? verifyFieldValue(
        { ...field, inputType: item.strategy === 'cascader-region' ? 'cascader-region' : field.inputType },
        item.expectedValue,
      )
      : undefined;

    reports.push(reportFromPlanAndVerification(item, field.label, filled, verification));
  }

  return {
    reports,
    filled: reports.filter((item) => item.status === 'filled_and_verified').length,
    skipped: reports.filter((item) => item.status.startsWith('skipped')).length,
    failed: reports.filter((item) => item.status === 'failed_to_fill' || item.status === 'filled_but_mismatch').length,
  };
}

