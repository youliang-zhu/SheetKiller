import type { InputType } from '@/lib/engine/adapters/types';
import { cssEscape } from '@/lib/capture/css-escape';
import { setNativeValue, setNativeChecked } from '@/lib/capture/native-set';
import { isVisuallyHidden, findVisualProxy } from '@/lib/capture/widget-proxy';

function dispatchEvents(el: Element, events: string[]): void {
  for (const eventName of events) {
    const event = eventName === 'input' || eventName === 'change'
      ? new Event(eventName, { bubbles: true, cancelable: true })
      : new FocusEvent(eventName, { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
  }
}

function dispatchKeyboard(el: Element, key: string): void {
  for (const eventName of ['keydown', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(eventName, { bubbles: true, cancelable: true, key }));
  }
}

function normalizeToken(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[()（）[\]【】{}<>《》,，、/\\|:：;；.\-_]/g, '')
    .replace(/\b(master|bachelor|phd|doctor|fulltime|parttime)\b/g, '')
    .replace(/省|市|区|县|特别行政区|自治区|壮族|回族|维吾尔/g, '')
    .toLowerCase();
}

function splitRegionTokens(value: string): string[] {
  return value
    .split(/[,\s/|>，、-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function optionMatchesText(optionText: string, value: string): boolean {
  const option = normalizeToken(optionText);
  const target = normalizeToken(value);
  if (!option || !target) return false;
  return option === target || option.includes(target) || target.includes(option);
}

function isChoiceLikeElement(el: Element): boolean {
  const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
  const placeholder = input?.getAttribute('placeholder') ?? '';
  const text = `${placeholder} ${el.textContent ?? ''}`;
  return Boolean(
    el.closest('.el-select, .el-autocomplete, .ant-select, [role="combobox"]')
    || /请选择|请先选择|学校名称|专业/.test(text),
  );
}

function closestInteractiveRoot(el: Element): Element {
  return el.closest(
    '.el-select, .el-autocomplete, .el-cascader, .el-date-editor, .ant-select, .ant-picker, [role="combobox"], .el-input',
  ) ?? el;
}

function innerTextInput(el: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
}

function clickElement(el: Element): void {
  const win = el.ownerDocument.defaultView;
  if (win?.PointerEvent) {
    el.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  }
  for (const eventName of ['mousedown', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true }));
  }
  if (el instanceof HTMLElement) {
    try {
      el.click();
    } catch { /* ignore synthetic click failures */ }
  } else {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

function isVisibleElement(option: Element): boolean {
  const element = option as HTMLElement;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

async function waitForOptions(doc: Document, selectors: string[], attempts = 14): Promise<Element[]> {
  for (let i = 0; i < attempts; i++) {
    const options = selectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)));
    const visible = options.filter(isVisibleElement);
    if (visible.length > 0) return visible;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

async function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
  if (el.readOnly || el.disabled) return false;
  setNativeValue(el, value);
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  return el.value === value;
}

async function fillSelect(el: HTMLSelectElement, value: string): Promise<boolean> {
  if (!(el instanceof HTMLSelectElement)) return fillCustomSelect(el, value);
  const matched = Array.from(el.options).find((opt) => (
    optionMatchesText(opt.text, value) || optionMatchesText(opt.value, value)
  ));
  if (!matched) return false;

  setNativeValue(el, matched.value);
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  return true;
}

async function fillRadio(el: HTMLInputElement, value: string): Promise<boolean> {
  const name = el.getAttribute('name');
  let allRadios: HTMLInputElement[];

  if (name) {
    const root = el.closest('form') ?? el.ownerDocument;
    allRadios = Array.from(root.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${cssEscape(name)}"]`,
    ));
  } else {
    const parent = el.parentElement?.closest('div, fieldset, form') ?? el.parentElement;
    allRadios = parent
      ? Array.from(parent.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      : [];
  }
  if (allRadios.length === 0) return false;

  const lowerValue = value.toLowerCase();
  let target = allRadios.find((radio) => radio.value.toLowerCase() === lowerValue);

  if (!target) {
    target = allRadios.find((radio) => {
      const id = radio.getAttribute('id');
      if (id) {
        try {
          const label = radio.ownerDocument.querySelector(`[for="${cssEscape(id)}"]`);
          if (label?.textContent?.trim().toLowerCase().includes(lowerValue)) return true;
        } catch { /* fall through */ }
      }

      const parentLabel = radio.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true) as Element;
        clone.querySelectorAll('input').forEach((child) => child.remove());
        if ((clone.textContent ?? '').trim().toLowerCase().includes(lowerValue)) return true;
      }

      for (const direction of ['previousSibling', 'nextSibling'] as const) {
        let sibling: Node | null = radio[direction];
        while (sibling) {
          const text = sibling.textContent?.trim().toLowerCase() ?? '';
          if (text && text.includes(lowerValue)) return true;
          sibling = sibling[direction];
        }
      }

      const wrapper = radio.parentElement?.parentElement;
      if (wrapper) {
        const clone = wrapper.cloneNode(true) as Element;
        clone.querySelectorAll('input, select, textarea').forEach((child) => child.remove());
        if ((clone.textContent ?? '').trim().toLowerCase().includes(lowerValue)) return true;
      }
      return false;
    });
  }

  if (!target) return false;
  setNativeChecked(target, true);
  dispatchEvents(target, ['focus', 'input', 'change', 'blur']);
  if (isVisuallyHidden(target)) {
    const proxy = findVisualProxy(target);
    if (proxy) {
      try {
        proxy.click();
      } catch { /* ignore proxy click failures */ }
    }
  }
  return true;
}

async function fillCheckbox(el: HTMLInputElement, value: string): Promise<boolean> {
  const truthy = ['true', 'yes', '是', '1'];
  const shouldCheck = truthy.includes(value.toLowerCase().trim());
  const prior = el.checked;
  setNativeChecked(el, shouldCheck);
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  if (isVisuallyHidden(el) && prior !== shouldCheck) {
    const proxy = findVisualProxy(el);
    if (proxy) {
      try {
        proxy.click();
      } catch { /* ignore proxy click failures */ }
    }
  }
  return true;
}

async function fillDate(el: HTMLInputElement, value: string): Promise<boolean> {
  if (el.readOnly || el.disabled) return false;
  setNativeValue(el, value);
  dispatchEvents(el, ['focus', 'input']);
  dispatchKeyboard(el, 'Enter');
  dispatchEvents(el, ['change', 'blur']);
  return el.value === value;
}

function dateCandidates(value: string): string[] {
  const compact = value.trim();
  const monthMatch = compact.match(/^(\d{4})[-/.年](\d{1,2})(?:月)?$/);
  const dayMatch = compact.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
  const candidates = [compact, compact.replace(/-/g, '/'), compact.replace(/\//g, '-')];
  if (monthMatch) {
    const [, year, month] = monthMatch;
    const paddedMonth = month.padStart(2, '0');
    candidates.push(`${year}-${paddedMonth}`, `${year}/${paddedMonth}`, `${year}年${Number(month)}月`);
  }
  if (dayMatch) {
    const [, year, month, day] = dayMatch;
    const paddedMonth = month.padStart(2, '0');
    const paddedDay = day.padStart(2, '0');
    candidates.push(
      `${year}-${paddedMonth}-${paddedDay}`,
      `${year}/${paddedMonth}/${paddedDay}`,
      `${year}年${Number(month)}月${Number(day)}日`,
    );
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fillCustomDate(el: Element, value: string): Promise<boolean> {
  const root = closestInteractiveRoot(el);
  const input = innerTextInput(root);
  if (!input || input.disabled || input.readOnly) return false;
  clickElement(root);

  for (const candidate of dateCandidates(value)) {
    input.focus();
    setNativeValue(input, candidate);
    dispatchEvents(input, ['focus', 'input']);
    dispatchKeyboard(input, 'Enter');
    dispatchEvents(input, ['change', 'blur']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (input.value === candidate) return true;
  }
  return false;
}

async function fillContenteditable(el: HTMLElement, value: string): Promise<boolean> {
  el.textContent = value;
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  return (el.textContent ?? '') === value;
}

const overlaySelectors = [
  '[role="listbox"] [role="option"]',
  '[role="option"]',
  '.dropdown-menu li',
  '.dropdown-item',
  '.el-select-dropdown__item',
  '.el-autocomplete-suggestion li',
  '.el-scrollbar__view li',
  '.ant-select-item-option',
  '[class*="option"]',
  '[class*="dropdown"] li',
];

async function clickMatchingOption(doc: Document, value: string): Promise<boolean> {
  const options = await waitForOptions(doc, overlaySelectors);
  const match = options.find((option) => {
    const element = option as HTMLElement;
    if (element.getAttribute('aria-disabled') === 'true' || element.classList.contains('is-disabled')) return false;
    return optionMatchesText(element.textContent ?? '', value);
  });
  if (!match) return false;
  clickElement(match);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return true;
}

async function fillCustomSelect(el: Element, value: string): Promise<boolean> {
  const root = closestInteractiveRoot(el);
  const input = innerTextInput(root);
  const doc = el.ownerDocument;
  if (!doc) return false;

  if (input && !input.disabled && !input.readOnly) input.focus();
  clickElement(root);
  if (await clickMatchingOption(doc, value)) return true;

  if (input && !input.disabled && !input.readOnly) {
    input.focus();
    setNativeValue(input, value);
    dispatchEvents(input, ['focus', 'input']);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  if (await clickMatchingOption(doc, value)) return true;

  if (input && !input.readOnly && !input.disabled) {
    dispatchKeyboard(input, 'Enter');
    dispatchEvents(input, ['change', 'blur']);
    return normalizeToken(input.value) === normalizeToken(value);
  }
  return false;
}

async function selectNativeOption(select: HTMLSelectElement, value: string): Promise<boolean> {
  const matched = Array.from(select.options).find((opt) => (
    optionMatchesText(opt.textContent ?? '', value) || optionMatchesText(opt.value, value)
  ));
  if (!matched) return false;
  setNativeValue(select, matched.value);
  dispatchEvents(select, ['focus', 'input', 'change', 'blur']);
  return true;
}

async function fillLinkedRegionSelects(el: Element, tokens: string[]): Promise<boolean> {
  const root = el.closest('form, .ant-form, .el-form, .form, body') ?? el.ownerDocument.body;
  const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('select'))
    .filter((select) => !select.disabled && select.options.length > 1);
  if (selects.length < 2) return false;

  let matched = 0;
  for (let i = 0; i < selects.length && i < tokens.length; i++) {
    const ok = await selectNativeOption(selects[i], tokens[i]);
    if (!ok) break;
    matched++;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return matched >= Math.min(tokens.length, selects.length, 2);
}

function uniqueElements(elements: Element[]): Element[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function findGroupedRegionToken(el: Element, tokens: string[]): string | null {
  const group = el.closest('.el-form-item, .ant-form-item, fieldset, [role="group"]');
  if (!group || tokens.length < 2) return null;
  const text = `${group.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  if (!/籍贯|出生地|户籍|所在地|城市|地区|国家|省|市/.test(text)) return null;

  const controlRoots = uniqueElements(Array.from(group.querySelectorAll<Element>(
    'select, .el-select, .el-cascader, [role="combobox"], .ant-select',
  )).map(closestInteractiveRoot));
  if (controlRoots.length < 2) return null;

  const root = closestInteractiveRoot(el);
  const index = controlRoots.findIndex((control) => control === root || control.contains(root) || root.contains(control));
  if (index < 0) return null;

  const startsWithCountry = /^中国$|^China$/i.test(tokens[0] ?? '');
  const tokenIndex = startsWithCountry && controlRoots.length === tokens.length - 1 ? index + 1 : index;
  return tokens[tokenIndex] ?? null;
}

function collectCascaderOptions(doc: Document): Element[] {
  const selectors = [
    '.ant-cascader-menu-item',
    '.ant-cascader-menu-item-content',
    '.el-cascader-node',
    '.el-cascader-node__label',
    '[role="menuitem"]',
    '[role="treeitem"]',
    '[role="option"]',
    '.cascader-option',
    '.cascader-item',
  ];
  return selectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)));
}

async function clickMatchingCascaderOption(doc: Document, token: string): Promise<boolean> {
  const match = collectCascaderOptions(doc).find((option) => optionMatchesText(option.textContent ?? '', token));
  if (!match) return false;
  match.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  match.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
  clickElement(match);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return true;
}

async function fillCascaderRegion(el: Element, value: string): Promise<boolean> {
  const tokens = splitRegionTokens(value);
  if (tokens.length === 0) return false;

  const groupedToken = findGroupedRegionToken(el, tokens);
  if (groupedToken) return fillCustomSelect(el, groupedToken);

  if (await fillLinkedRegionSelects(el, tokens)) return true;

  const doc = el.ownerDocument;
  clickElement(closestInteractiveRoot(el));
  await new Promise((resolve) => setTimeout(resolve, 120));

  let matched = 0;
  for (const token of tokens) {
    if (await clickMatchingCascaderOption(doc, token)) matched++;
    else break;
  }

  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  return matched >= Math.min(tokens.length, 2);
}

export async function fillElement(el: Element, value: string, inputType: InputType): Promise<boolean> {
  if (!value) return false;

  switch (inputType) {
    case 'text': {
      const input = innerTextInput(el);
      if (!input) return false;
      const filled = await fillText(input, value);
      if (filled) return true;
      return isChoiceLikeElement(el) ? fillCustomSelect(el, value) : false;
    }

    case 'textarea': {
      const input = innerTextInput(el);
      return input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
        ? fillText(input, value)
        : false;
    }

    case 'select':
      return el instanceof HTMLSelectElement ? fillSelect(el, value) : fillCustomSelect(el, value);

    case 'radio':
      return el instanceof HTMLInputElement ? fillRadio(el, value) : false;

    case 'checkbox':
      return el instanceof HTMLInputElement ? fillCheckbox(el, value) : false;

    case 'date':
      return el instanceof HTMLInputElement ? fillDate(el, value) : fillCustomDate(el, value);

    case 'custom-select':
      return fillCustomSelect(el, value);

    case 'cascader-region':
      return fillCascaderRegion(el, value);

    case 'contenteditable':
      return fillContenteditable(el as HTMLElement, value);

    default:
      return false;
  }
}
