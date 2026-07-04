import { fillElement, type FillTraceStep } from '@/lib/engine/heuristic/fillers';
import type { FieldInventoryItem, FillPlanItem, SheetKillerReportItem } from '@/lib/sheetkiller/types';
import { reportFromPlanAndVerification } from '@/lib/sheetkiller/report/report';
import { isFinalSubmitElement } from '@/lib/sheetkiller/safety/submit-guard';
import { maskValue, readFieldDisplayValue, verifyFieldValue } from '@/lib/sheetkiller/verifier/verifier';

export interface DynamicFillDebugItem {
  fieldId: string;
  label: string;
  strategy: FillPlanItem['strategy'];
  safety: FillPlanItem['safety'];
  expectedMasked: string;
  beforeMasked: string;
  afterMasked: string;
  status: SheetKillerReportItem['status'];
  reason: string;
  exception?: string;
  interactionTrace?: FillTraceStep[];
  siteValidationErrors?: string[];
  element?: {
    tagName: string;
    type: string;
    inputType: FieldInventoryItem['inputType'];
    id: string;
    name: string;
    className: string;
    placeholder: string;
    ariaLabel: string;
    role: string;
    readOnly: boolean;
    disabled: boolean;
    optionsCount: number;
  };
}

export interface DynamicFillExecution {
  reports: SheetKillerReportItem[];
  debugItems: DynamicFillDebugItem[];
  filled: number;
  needsInput: number;
  skipped: number;
  failed: number;
}

export interface DynamicFillOptions {
  rescan?: () => FieldInventoryItem[];
}

export async function executeFillPlan(
  fields: FieldInventoryItem[],
  plan: FillPlanItem[],
  options: DynamicFillOptions = {},
): Promise<DynamicFillExecution> {
  const reports: SheetKillerReportItem[] = [];
  const debugItems: DynamicFillDebugItem[] = [];
  let currentFields = fields;

  for (const item of plan) {
    if (options.rescan) currentFields = options.rescan();
    const fieldById = new Map(currentFields.map((field) => [field.fieldId, field]));
    const field = fieldById.get(item.fieldId);
    if (!field) {
      const report: SheetKillerReportItem = {
        fieldId: item.fieldId,
        label: '',
        profileSource: item.profileSource,
        status: 'failed_to_fill',
        reason: 'Field no longer exists on the page.',
      };
      reports.push(report);
      debugItems.push(buildDebugItem(item, undefined, report, '', '', ''));
      continue;
    }

    if (item.safety === 'needs_user_input') {
      const report = reportFromPlanAndVerification(item, field.label, false);
      reports.push(report);
      const before = readFieldDisplayValue(field);
      debugItems.push(buildDebugItem(item, field, report, before, before, ''));
      continue;
    }

    if (item.strategy === 'skip' || item.safety.startsWith('skip_')) {
      const report = reportFromPlanAndVerification(item, field.label, false);
      reports.push(report);
      const before = readFieldDisplayValue(field);
      debugItems.push(buildDebugItem(item, field, report, before, before, ''));
      continue;
    }

    const complexRemoteReason = complexRemoteCandidateReason(field, item);
    if (complexRemoteReason) {
      const manualItem: FillPlanItem = {
        ...item,
        safety: 'needs_user_input',
        reviewRequired: true,
        reason: complexRemoteReason,
      };
      const before = readFieldDisplayValue(field);
      const report = reportFromPlanAndVerification(manualItem, field.label, false);
      reports.push(report);
      debugItems.push(buildDebugItem(manualItem, field, report, before, before, ''));
      continue;
    }

    if (isFinalSubmitElement(field.element)) {
      const report: SheetKillerReportItem = {
        fieldId: field.fieldId,
        label: field.label,
        profileSource: item.profileSource,
        status: 'skipped_requires_human',
        reason: 'Final submit-like element was blocked by safety guard.',
      };
      reports.push(report);
      const before = readFieldDisplayValue(field);
      debugItems.push(buildDebugItem(item, field, report, before, before, ''));
      continue;
    }

    const expectedValue = adjustedExpectedValue(field, item);
    const effectiveItem = expectedValue === (item.expectedValue || item.value || '')
      ? item
      : {
          ...item,
          expectedValue,
          value: expectedValue,
          profileSource: item.profileSource || 'basic.phoneCountryCode',
          sourcePath: item.sourcePath || 'basic.phoneCountryCode',
          reason: `${item.reason || 'Adjusted grouped phone field.'} Phone country-code subfield was filled from the current page value.`,
        };
    let filled = false;
    const beforeValue = readFieldDisplayValue(field);
    let exception = '';
    const interactionTrace: FillTraceStep[] = [];
    try {
      filled = await fillElement(field.element, expectedValue, effectiveItem.strategy, { trace: interactionTrace });
    } catch (err) {
      filled = false;
      exception = err instanceof Error ? err.message : String(err);
    }
    const afterValue = readFieldDisplayValue(field);

    const verification = filled
      ? verifyFieldValue(
        { ...field, inputType: item.strategy === 'cascader-region' ? 'cascader-region' : field.inputType },
        expectedValue,
      )
      : undefined;

    const report = reportFromPlanAndVerification(effectiveItem, field.label, filled, verification);
    reports.push(report);
    debugItems.push(buildDebugItem(
      effectiveItem,
      field,
      report,
      beforeValue,
      afterValue,
      exception,
      interactionTrace,
    ));
  }

  return {
    reports,
    debugItems,
    filled: reports.filter((item) => item.status === 'filled_and_verified').length,
    needsInput: reports.filter((item) => item.status === 'needs_user_input').length,
    skipped: reports.filter((item) => item.status.startsWith('skipped')).length,
    failed: reports.filter((item) => item.status === 'failed_to_fill' || item.status === 'filled_but_mismatch').length,
  };
}

function adjustedExpectedValue(field: FieldInventoryItem, item: FillPlanItem): string {
  const expected = item.expectedValue || item.value || '';
  if (!expected) return expected;
  if (item.sourcePath !== 'basic.phone' && item.profileSource !== 'basic.phone') return expected;
  if (!/^\+?\d[\d\s-]{6,}$/.test(expected)) return expected;
  if (!['select', 'custom-select', 'cascader-region'].includes(item.strategy)) return expected;

  const visibleText = [
    field.label,
    field.placeholder,
    field.ariaLabel,
    field.name,
    field.id,
    field.context,
    field.currentValue,
    readFieldDisplayValue(field),
  ].filter(Boolean).join(' ');
  if (!/(\+86|86|区号|国家码|国家\/地区|country\s*code)/i.test(visibleText)) return expected;
  return '+86';
}

function complexRemoteCandidateReason(field: FieldInventoryItem, item: FillPlanItem): string {
  if (!['custom-select', 'select', 'cascader-region'].includes(item.strategy)) return '';
  const text = [
    field.label,
    field.placeholder,
    field.ariaLabel,
    field.name,
    field.id,
    field.section,
    field.context,
    item.label,
    item.profileSource,
    item.sourcePath,
  ].filter(Boolean).join(' ');

  if (/学校名称|学校全称|毕业院校|就读学校|院校名称|school/i.test(text)) {
    return '复杂远程候选控件：学校名称通常需要从站点学校库候选中手动选择；当前版本先不自动填写，避免写入无效 DOM 值。';
  }
  if (/意向面试地点|面试地点|面试城市|interview\s*(location|city)/i.test(text)) {
    return '复杂远程候选控件：意向面试地点通常依赖站点远程地点候选或特殊地点选择器；当前版本先交给用户手动选择。';
  }
  return '';
}

function buildDebugItem(
  plan: FillPlanItem,
  field: FieldInventoryItem | undefined,
  report: SheetKillerReportItem,
  beforeValue: string,
  afterValue: string,
  exception: string,
  interactionTrace: FillTraceStep[] = [],
): DynamicFillDebugItem {
  const sensitiveType = field?.sensitiveType;
  const expected = plan.expectedValue || plan.value || '';
  return {
    fieldId: plan.fieldId,
    label: field?.label || plan.label || '',
    strategy: plan.strategy,
    safety: plan.safety,
    expectedMasked: maskValue(expected, sensitiveType),
    beforeMasked: maskValue(beforeValue, sensitiveType),
    afterMasked: maskValue(afterValue, sensitiveType),
    status: report.status,
    reason: report.reason,
    exception: exception || undefined,
    interactionTrace: interactionTrace.length > 0 ? interactionTrace : undefined,
    siteValidationErrors: field ? readSiteValidationErrors(field) : undefined,
    element: field ? snapshotElement(field) : undefined,
  };
}

function readSiteValidationErrors(field: FieldInventoryItem): string[] | undefined {
  const root = field.element.closest(
    '.el-form-item, .ant-form-item, .form-item, .field, .control, label, div',
  ) ?? field.element.parentElement;
  if (!root) return undefined;
  const selectors = [
    '.el-form-item__error',
    '.ant-form-item-explain-error',
    '.ant-form-item-extra',
    '[class*="error"]',
    '[class*="invalid"]',
    '[aria-live="polite"]',
  ];
  const errors = selectors
    .flatMap((selector) => Array.from(root.querySelectorAll(selector)))
    .map((el) => (el.textContent ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .slice(0, 5);
  return errors.length > 0 ? errors : undefined;
}

function snapshotElement(field: FieldInventoryItem): DynamicFillDebugItem['element'] {
  const el = field.element;
  const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el
    : undefined;
  const select = el instanceof HTMLSelectElement ? el : undefined;
  const className = el instanceof HTMLElement ? el.className : '';
  return {
    tagName: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : '',
    inputType: field.inputType,
    id: el.getAttribute('id') ?? '',
    name: el.getAttribute('name') ?? '',
    className: typeof className === 'string' ? className : '',
    placeholder: input?.placeholder ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    role: el.getAttribute('role') ?? '',
    readOnly: input?.readOnly ?? false,
    disabled: input?.disabled ?? select?.disabled ?? false,
    optionsCount: select?.options.length ?? field.options.length,
  };
}
