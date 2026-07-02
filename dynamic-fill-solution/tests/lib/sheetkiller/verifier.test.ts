import { describe, expect, it } from 'vitest';
import { verifyFieldValue } from '@/lib/sheetkiller/verifier/verifier';
import type { FieldInventoryItem } from '@/lib/sheetkiller/types';

function field(inputType: FieldInventoryItem['inputType'], element: Element, extra: Partial<FieldInventoryItem> = {}): FieldInventoryItem {
  return {
    fieldId: 'field-0',
    element,
    inputType,
    label: '字段',
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
    ...extra,
  };
}

describe('SheetKiller verifier', () => {
  it('detects placeholder leakage as mismatch', () => {
    const input = document.createElement('input');
    input.value = 'x_id_number';
    const result = verifyFieldValue(
      field('text', input, { sensitiveType: 'id_card' }),
      '430000199901011234',
    );

    expect(result.status).toBe('mismatch');
    expect(result.reason).toContain('Placeholder');
  });

  it('rejects over-generic region values', () => {
    const div = document.createElement('div');
    div.textContent = '全国';
    const result = verifyFieldValue(field('cascader-region', div), '湖南省 娄底市', '全国');
    expect(result.status).toBe('mismatch');
  });

  it('verifies region token matches', () => {
    const div = document.createElement('div');
    div.textContent = '湖南省 / 娄底市 / 娄星区';
    const result = verifyFieldValue(field('cascader-region', div), '湖南省 娄底市', div.textContent);
    expect(result.status).toBe('verified');
  });
});
