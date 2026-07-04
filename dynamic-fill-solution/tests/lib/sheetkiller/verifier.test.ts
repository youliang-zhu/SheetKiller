import { afterEach, describe, expect, it } from 'vitest';
import { readFieldDisplayValue, verifyFieldValue } from '@/lib/sheetkiller/verifier/verifier';
import type { FieldInventoryItem } from '@/lib/sheetkiller/types';

afterEach(() => {
  document.body.innerHTML = '';
});

function field(element: Element, inputType: FieldInventoryItem['inputType']): FieldInventoryItem {
  return {
    fieldId: 'field-1',
    element,
    inputType,
    label: '',
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
    source: 'heuristic',
  };
}

describe('verifyFieldValue', () => {
  it('reads inner input values from custom component wrappers', () => {
    document.body.innerHTML = `
      <div class="el-select">
        <input value="硕士（Master）">
      </div>
    `;
    const wrapper = document.querySelector('.el-select') as HTMLElement;

    expect(readFieldDisplayValue(field(wrapper, 'custom-select'))).toBe('硕士（Master）');
  });

  it('allows option-like select values to include the expected token', () => {
    const result = verifyFieldValue(field(document.createElement('div'), 'custom-select'), '居民身份证', '中国-居民身份证');

    expect(result.status).toBe('verified');
  });

  it('allows degree options with parenthetical English suffixes', () => {
    const result = verifyFieldValue(field(document.createElement('div'), 'custom-select'), '硕士', '硕士（Master）');

    expect(result.status).toBe('verified');
  });

  it('allows broader major category labels for custom select verification', () => {
    const result = verifyFieldValue(field(document.createElement('div'), 'custom-select'), '计算机', '计算机科学与技术');

    expect(result.status).toBe('verified');
  });

  it('verifies one token for a grouped region subfield', () => {
    document.body.innerHTML = `
      <div class="el-form-item" role="group">
        <label>籍贯</label>
        <div class="el-select"><input value="中国"></div>
        <div class="el-select"><input value="湖南省"></div>
        <div class="el-select"><input value="娄底市"></div>
      </div>
    `;
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];

    expect(verifyFieldValue(field(inputs[0], 'cascader-region'), '中国 湖南省 娄底市').status).toBe('verified');
    expect(verifyFieldValue(field(inputs[1], 'cascader-region'), '中国 湖南省 娄底市').status).toBe('verified');
    expect(verifyFieldValue(field(inputs[2], 'cascader-region'), '中国 湖南省 娄底市').status).toBe('verified');
  });

  it('does not accept a partial region token for a single region control', () => {
    const input = document.createElement('input');
    input.value = '中国';

    expect(verifyFieldValue(field(input, 'cascader-region'), '中国 湖南省 娄底市').status).toBe('mismatch');
  });
});
