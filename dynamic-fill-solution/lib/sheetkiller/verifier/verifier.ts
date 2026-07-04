import type { FieldInventoryItem, VerificationResult } from '@/lib/sheetkiller/types';

function normalize(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

function normalizeOptionText(value: string): string {
  return normalize(value)
    .replace(/[()（）[\]【】{}<>《》,，、/\\|:：;；.\-_]/g, '')
    .replace(/\b(master|bachelor|phd|doctor|fulltime|parttime)\b/g, '')
    .replace(/省|市|区|县|特别行政区|自治区|壮族|回族|维吾尔/g, '');
}

function optionLikeMatches(expected: string, actual: string): boolean {
  const expectedNorm = normalizeOptionText(expected);
  const actualNorm = normalizeOptionText(actual);
  if (!expectedNorm || !actualNorm) return false;
  return actualNorm === expectedNorm
    || actualNorm.includes(expectedNorm)
    || expectedNorm.includes(actualNorm);
}

export function maskValue(value: string, kind?: FieldInventoryItem['sensitiveType']): string {
  if (!value) return '';
  if (kind === 'email') {
    const [name, domain] = value.split('@');
    if (!domain) return '***';
    return `${name.slice(0, 1)}***@${domain}`;
  }
  if (kind === 'phone') return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  if (kind === 'id_card' || kind === 'bank_card') {
    return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  }
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

export function readFieldDisplayValue(field: FieldInventoryItem): string {
  const el = field.element;
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'true' : 'false';
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? el.value;
  const innerInput = el.querySelector<HTMLInputElement>('input');
  if (innerInput) {
    if (innerInput.type === 'checkbox' || innerInput.type === 'radio') return innerInput.checked ? 'true' : 'false';
    return innerInput.value;
  }
  const innerTextarea = el.querySelector<HTMLTextAreaElement>('textarea');
  if (innerTextarea) return innerTextarea.value;
  const innerSelect = el.querySelector<HTMLSelectElement>('select');
  if (innerSelect) return innerSelect.selectedOptions[0]?.textContent?.trim() ?? innerSelect.value;
  return el.textContent?.trim() ?? '';
}

function dateComparable(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (!match) return normalize(trimmed);
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}${day ? `-${day.padStart(2, '0')}` : ''}`;
}

function regionMatches(expected: string, actual: string): boolean {
  const forbidden = ['全国', '不限', '全部'];
  if (forbidden.some((word) => actual.includes(word))) return false;
  const tokens = expected
    .split(/[,\s/|>，、-]+/)
    .map((token) => token.replace(/省|市|区|县/g, '').trim())
    .filter(Boolean);
  const actualNorm = actual.replace(/\s+/g, '');
  return tokens.length > 0 && tokens.every((token) => actualNorm.includes(token));
}

export function verifyFieldValue(
  field: FieldInventoryItem,
  expectedValue: string,
  actualValue = readFieldDisplayValue(field),
): VerificationResult {
  if (/x_id_number|x_phone|x_email/.test(actualValue)) {
    return {
      fieldId: field.fieldId,
      expectedMasked: maskValue(expectedValue, field.sensitiveType),
      actualMasked: maskValue(actualValue, field.sensitiveType),
      status: 'mismatch',
      reason: 'Placeholder value remained on page.',
    };
  }

  let matched = false;
  if (field.inputType === 'date') matched = dateComparable(expectedValue) === dateComparable(actualValue);
  else if (field.inputType === 'cascader-region') matched = regionMatches(expectedValue, actualValue);
  else if (field.inputType === 'select' || field.inputType === 'custom-select') matched = optionLikeMatches(expectedValue, actualValue);
  else matched = normalize(expectedValue) === normalize(actualValue);

  return {
    fieldId: field.fieldId,
    expectedMasked: maskValue(expectedValue, field.sensitiveType),
    actualMasked: maskValue(actualValue, field.sensitiveType),
    status: matched ? 'verified' : 'mismatch',
    reason: matched ? 'Expected value matched page value.' : 'Expected value did not match page value.',
  };
}
