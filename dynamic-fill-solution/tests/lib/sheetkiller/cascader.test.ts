import { afterEach, describe, expect, it } from 'vitest';
import { fillElement } from '@/lib/engine/heuristic/fillers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cascader-region filler', () => {
  it('fills linked province/city native selects', async () => {
    document.body.innerHTML = `
      <form>
        <select id="province">
          <option value="">请选择省</option>
          <option value="hunan">湖南省</option>
          <option value="guangdong">广东省</option>
        </select>
        <select id="city">
          <option value="">请选择市</option>
          <option value="loudi">娄底市</option>
          <option value="guangzhou">广州市</option>
        </select>
      </form>
    `;
    const trigger = document.querySelector('#province') as HTMLSelectElement;

    const ok = await fillElement(trigger, '湖南省 娄底市', 'cascader-region');

    expect(ok).toBe(true);
    expect((document.querySelector('#province') as HTMLSelectElement).value).toBe('hunan');
    expect((document.querySelector('#city') as HTMLSelectElement).value).toBe('loudi');
  });

  it('clicks matching popup cascader options', async () => {
    const trigger = document.createElement('button');
    const selected: string[] = [];
    document.body.appendChild(trigger);
    document.body.insertAdjacentHTML('beforeend', `
      <div class="ant-cascader-menu-item">湖南省</div>
      <div class="ant-cascader-menu-item">娄底市</div>
    `);
    document.querySelectorAll('.ant-cascader-menu-item').forEach((option) => {
      option.addEventListener('click', () => selected.push(option.textContent ?? ''));
    });

    const ok = await fillElement(trigger, '湖南省 娄底市', 'cascader-region');

    expect(ok).toBe(true);
    expect(selected).toEqual(['湖南省', '娄底市']);
  });
});
