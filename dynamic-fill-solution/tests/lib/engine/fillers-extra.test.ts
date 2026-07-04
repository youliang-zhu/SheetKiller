import { afterEach, describe, expect, it } from 'vitest';
import { fillElement } from '@/lib/engine/heuristic/fillers';

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
});
