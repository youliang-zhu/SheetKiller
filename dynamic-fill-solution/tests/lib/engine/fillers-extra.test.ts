import { afterEach, describe, expect, it } from 'vitest';
import { fillElement, type FillTraceStep } from '@/lib/engine/heuristic/fillers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fillElement custom component fixes', () => {
  it('selects an existing custom option before typing into the filter input', async () => {
    document.body.innerHTML = `
      <div class="el-select">
        <input type="text" placeholder="请选择">
      </div>
      <div class="el-select-dropdown__item">中国-居民身份证</div>
      <div class="el-select-dropdown__item">护照</div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    const firstOption = document.querySelector('.el-select-dropdown__item') as HTMLElement;
    firstOption.addEventListener('click', () => {
      input.value = '中国-居民身份证';
    });

    const result = await fillElement(input, '居民身份证', 'custom-select');

    expect(result).toBe(true);
    expect(input.value).toBe('中国-居民身份证');
  });

  it('splits a grouped region value by custom-select position', async () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label>籍贯</label>
        <div class="el-select"><input placeholder="请选择"></div>
        <div class="el-select"><input placeholder="请选择"></div>
        <div class="el-select"><input placeholder="请选择"></div>
      </div>
      <div class="el-select-dropdown__item">中国</div>
      <div class="el-select-dropdown__item">湖南省</div>
      <div class="el-select-dropdown__item">娄底市</div>
    `;
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const options = Array.from(document.querySelectorAll('.el-select-dropdown__item')) as HTMLElement[];
    options.forEach((option) => {
      option.addEventListener('click', () => {
        const activeInput = document.activeElement as HTMLInputElement;
        if (activeInput?.tagName === 'INPUT') activeInput.value = option.textContent ?? '';
      });
    });

    expect(await fillElement(inputs[0], '中国 湖南省 娄底市', 'cascader-region')).toBe(true);
    expect(await fillElement(inputs[1], '中国 湖南省 娄底市', 'cascader-region')).toBe(true);
    expect(await fillElement(inputs[2], '中国 湖南省 娄底市', 'cascader-region')).toBe(true);
    expect(inputs.map((input) => input.value)).toEqual(['中国', '湖南省', '娄底市']);
  });

  it('records custom option samples in fill traces', async () => {
    document.body.innerHTML = `
      <div class="el-select">
        <input type="text" placeholder="please select">
      </div>
      <div class="el-select-dropdown__item">China</div>
      <div class="el-select-dropdown__item">United States</div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    const china = document.querySelector('.el-select-dropdown__item') as HTMLElement;
    china.addEventListener('click', () => {
      input.value = 'China';
    });
    const trace: FillTraceStep[] = [];

    const result = await fillElement(input, 'China', 'custom-select', { trace });

    expect(result).toBe(true);
    expect(trace.some((step) => step.stage === 'custom-select:after-open')).toBe(true);
    expect(trace.some((step) => step.optionSamples?.includes('China'))).toBe(true);
  });

  it('tries readonly custom date inputs instead of failing before interaction', async () => {
    document.body.innerHTML = `
      <div class="el-date-editor">
        <input type="text" readonly>
      </div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    const trace: FillTraceStep[] = [];

    const result = await fillElement(input.parentElement as Element, '2002-11-24', 'date', { trace });

    expect(result).toBe(true);
    expect(input.value).toBe('2002-11-24');
    expect(trace.some((step) => step.stage === 'custom-date:start' && step.inputReadonly)).toBe(true);
  });

  it('uses the component root instead of the inner Element Plus input wrapper', async () => {
    document.body.innerHTML = `
      <div class="el-select">
        <div class="el-input el-input--suffix">
          <input class="el-input__inner" type="text" placeholder="please select">
        </div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">China</div>
      </div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    const option = document.querySelector('.el-select-dropdown__item') as HTMLElement;
    option.addEventListener('click', () => {
      input.value = 'China';
    });
    const trace: FillTraceStep[] = [];

    expect(await fillElement(input, 'China', 'custom-select', { trace })).toBe(true);
    expect(trace.find((step) => step.stage === 'custom-select:start')?.root).toContain('el-select');
  });

  it('ignores options inside hidden stale dropdowns', async () => {
    document.body.innerHTML = `
      <div class="el-select">
        <input type="text" placeholder="please select">
      </div>
      <div class="el-select-dropdown" style="display: none">
        <div class="el-select-dropdown__item">China-ID</div>
      </div>
      <div class="el-select-dropdown">
        <div class="el-select-dropdown__item">China</div>
      </div>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    const hiddenOption = Array.from(document.querySelectorAll('.el-select-dropdown__item'))[0] as HTMLElement;
    const visibleOption = Array.from(document.querySelectorAll('.el-select-dropdown__item'))[1] as HTMLElement;
    hiddenOption.addEventListener('click', () => {
      input.value = 'China-ID';
    });
    visibleOption.addEventListener('click', () => {
      input.value = 'China';
    });
    const trace: FillTraceStep[] = [];

    expect(await fillElement(input, 'China', 'custom-select', { trace })).toBe(true);
    expect(input.value).toBe('China');
    expect(trace.find((step) => step.stage === 'custom-select:after-open')?.optionSamples).not.toContain('China-ID');
  });
});
