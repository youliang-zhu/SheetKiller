import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanEnrichedFields } from '@/lib/sheetkiller/scanner/enrich';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32, x: 0, y: 0, toJSON: () => ({}) },
  ] as unknown as DOMRectList);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SheetKiller enriched scanner', () => {
  it('recognizes Element Plus select-like inputs as custom-select', () => {
    document.body.innerHTML = `
      <div class="el-form-item is-required">
        <label>学历</label>
        <div class="el-select">
          <div class="el-input">
            <input type="text" placeholder="请选择" id="degree">
          </div>
        </div>
      </div>
    `;

    const fields = scanEnrichedFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe('学历');
    expect(fields[0].inputType).toBe('custom-select');
  });

  it('deduplicates Element Plus date wrapper and inner input', () => {
    document.body.innerHTML = `
      <div class="el-form-item is-required">
        <label>出生日期</label>
        <div class="el-date-editor" role="combobox">
          <input type="text" placeholder="请选择" id="birth">
        </div>
      </div>
    `;

    const fields = scanEnrichedFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe('出生日期');
    expect(fields[0].inputType).toBe('date');
  });

  it('recognizes Element Plus cascader inputs for region-like labels', () => {
    document.body.innerHTML = `
      <div class="el-form-item is-required">
        <label>学校所在地</label>
        <div class="el-cascader">
          <input type="text" placeholder="请选择" id="school-location">
        </div>
      </div>
    `;

    const fields = scanEnrichedFields(document);

    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe('学校所在地');
    expect(fields[0].inputType).toBe('cascader-region');
  });
});
