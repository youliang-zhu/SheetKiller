import type {
  FillPlanItem,
  SheetKillerReportItem,
  VerificationResult,
} from '@/lib/sheetkiller/types';

export function reportFromPlanAndVerification(
  plan: FillPlanItem,
  label: string,
  filled: boolean,
  verification?: VerificationResult,
): SheetKillerReportItem {
  if (plan.safety === 'skip_low_confidence') {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      status: 'skipped_low_confidence',
      reason: plan.reason || 'Low confidence.',
    };
  }
  if (plan.safety === 'skip_sensitive' || plan.safety === 'skip_upload') {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      status: 'skipped_sensitive',
      reason: plan.reason || 'Sensitive or upload field skipped.',
    };
  }
  if (plan.safety === 'skip_generated' || plan.safety === 'skip_unknown') {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      status: 'skipped_requires_human',
      reason: plan.reason || 'Requires human review.',
    };
  }
  if (!filled) {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      status: 'failed_to_fill',
      reason: 'Executor failed to fill this field.',
    };
  }
  if (!verification) {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      status: 'filled_but_unverifiable',
      reason: 'No verifier result was available.',
    };
  }
  if (verification.status === 'verified') {
    return {
      fieldId: plan.fieldId,
      label,
      profileSource: plan.profileSource,
      expectedMasked: verification.expectedMasked,
      actualMasked: verification.actualMasked,
      status: 'filled_and_verified',
      reason: verification.reason,
    };
  }
  return {
    fieldId: plan.fieldId,
    label,
    profileSource: plan.profileSource,
    expectedMasked: verification.expectedMasked,
    actualMasked: verification.actualMasked,
    status: verification.status === 'mismatch' ? 'filled_but_mismatch' : 'filled_but_unverifiable',
    reason: verification.reason,
  };
}

export function summarizeReport(items: SheetKillerReportItem[]): Record<SheetKillerReportItem['status'], number> {
  const statuses: SheetKillerReportItem['status'][] = [
    'filled_and_verified',
    'filled_but_mismatch',
    'filled_but_unverifiable',
    'skipped_low_confidence',
    'skipped_sensitive',
    'skipped_requires_human',
    'failed_to_fill',
  ];
  return Object.fromEntries(statuses.map((status) => [
    status,
    items.filter((item) => item.status === status).length,
  ])) as Record<SheetKillerReportItem['status'], number>;
}

