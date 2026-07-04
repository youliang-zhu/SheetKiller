import type { InputType } from '@/lib/engine/adapters/types';
import { cssEscape } from '@/lib/capture/css-escape';
import { setNativeValue, setNativeChecked } from '@/lib/capture/native-set';
import { isVisuallyHidden, findVisualProxy } from '@/lib/capture/widget-proxy';

export interface FillTraceStep {
  stage: string;
  success?: boolean;
  message?: string;
  root?: string;
  input?: string;
  inputReadonly?: boolean;
  inputDisabled?: boolean;
  optionCount?: number;
  optionSamples?: string[];
  selectedOption?: string;
  panelCount?: number;
  panelClasses?: string[];
}

export interface FillElementOptions {
  trace?: FillTraceStep[];
}

function addTrace(options: FillElementOptions | undefined, step: FillTraceStep): void {
  options?.trace?.push(step);
}

function describeElement(el: Element | null | undefined): string {
  if (!el) return '';
  const parts = [el.tagName.toLowerCase()];
  const id = el.getAttribute('id');
  const role = el.getAttribute('role');
  const className = el instanceof HTMLElement ? el.className : '';
  if (id) parts.push(`#${id}`);
  if (typeof className === 'string' && className.trim()) {
    parts.push(`.${className.trim().split(/\s+/).slice(0, 4).join('.')}`);
  }
  if (role) parts.push(`[role="${role}"]`);
  return parts.join('');
}

function optionSamples(options: Element[], limit = 8): string[] {
  return options
    .map((option) => (option.textContent ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, limit);
}

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
  const selectors = [
    '.el-select',
    '.el-cascader',
    '.el-autocomplete',
    '.el-date-editor',
    '.ant-select',
    '.ant-picker',
    '[role="combobox"]',
    '.el-input',
  ];
  for (const selector of selectors) {
    const root = el.closest(selector);
    if (root) return root;
  }
  return el;
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
  if (!element.isConnected) return false;
  let current: HTMLElement | null = element;
  const win = element.ownerDocument.defaultView;
  while (current && current !== element.ownerDocument.documentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = win?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return false;
    current = current.parentElement;
  }
  const rects = element.getClientRects();
  if (rects.length > 0) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
  }
  return true;
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

async function fillText(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options?: FillElementOptions,
): Promise<boolean> {
  addTrace(options, {
    stage: 'text:start',
    input: describeElement(el),
    inputReadonly: el.readOnly,
    inputDisabled: el.disabled,
  });
  if (el.readOnly || el.disabled) return false;
  setNativeValue(el, value);
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  const success = el.value === value;
  addTrace(options, { stage: 'text:verify', success });
  return success;
}

async function fillSelect(el: HTMLSelectElement, value: string, options?: FillElementOptions): Promise<boolean> {
  if (!(el instanceof HTMLSelectElement)) return fillCustomSelect(el, value, options);
  addTrace(options, {
    stage: 'native-select:start',
    root: describeElement(el),
    optionCount: el.options.length,
    optionSamples: Array.from(el.options).map((opt) => opt.text).filter(Boolean).slice(0, 8),
  });
  const matched = Array.from(el.options).find((opt) => (
    optionMatchesText(opt.text, value) || optionMatchesText(opt.value, value)
  ));
  if (!matched) return false;

  setNativeValue(el, matched.value);
  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  addTrace(options, { stage: 'native-select:selected', success: true, selectedOption: matched.text });
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

async function fillDate(el: HTMLInputElement, value: string, options?: FillElementOptions): Promise<boolean> {
  addTrace(options, {
    stage: 'native-date:start',
    input: describeElement(el),
    inputReadonly: el.readOnly,
    inputDisabled: el.disabled,
  });
  if (el.readOnly || el.disabled) return false;
  setNativeValue(el, value);
  dispatchEvents(el, ['focus', 'input']);
  dispatchKeyboard(el, 'Enter');
  dispatchEvents(el, ['change', 'blur']);
  const success = el.value === value;
  addTrace(options, { stage: 'native-date:verify', success });
  return success;
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

function collectPickerPanels(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(
    '.el-picker-panel, .el-date-picker, .el-month-table, .ant-picker-dropdown, [class*="picker-panel"]',
  )).filter(isVisibleElement);
}

async function fillCustomDate(el: Element, value: string, options?: FillElementOptions): Promise<boolean> {
  const root = closestInteractiveRoot(el);
  const input = innerTextInput(root);
  addTrace(options, {
    stage: 'custom-date:start',
    root: describeElement(root),
    input: describeElement(input),
    inputReadonly: input?.readOnly,
    inputDisabled: input?.disabled,
  });
  if (!input || input.disabled) return false;

  const trigger = root.querySelector('.el-input__wrapper, .el-input__inner, input, .ant-picker-input') ?? root;
  clickElement(trigger);
  clickElement(root);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const panels = collectPickerPanels(el.ownerDocument);
  addTrace(options, {
    stage: 'custom-date:open-panel',
    panelCount: panels.length,
    panelClasses: panels.map(describeElement).slice(0, 4),
  });

  for (const candidate of dateCandidates(value)) {
    const wasReadOnly = input.readOnly;
    if (wasReadOnly && input instanceof HTMLInputElement) input.readOnly = false;
    input.focus();
    setNativeValue(input, candidate);
    dispatchEvents(input, ['focus', 'input']);
    dispatchKeyboard(input, 'Enter');
    dispatchEvents(input, ['change', 'blur']);
    if (wasReadOnly && input instanceof HTMLInputElement) input.readOnly = true;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const success = input.value === candidate;
    addTrace(options, { stage: 'custom-date:type-candidate', success });
    if (success) return true;
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

const overlayRootSelectors = [
  '.el-select-dropdown',
  '.el-cascader__dropdown',
  '.el-autocomplete-suggestion',
  '.el-popper',
  '.ant-select-dropdown',
  '.ant-cascader-dropdown',
  '[role="listbox"]',
  '.dropdown-menu',
  '[class*="dropdown"]',
];

function uniqueByIdentity<T extends Element>(elements: T[]): T[] {
  return elements.filter((element, index) => elements.indexOf(element) === index);
}

function collectControlledOverlayRoots(doc: Document, root: Element, input: Element | null): Element[] {
  const ids = [root, input]
    .filter(Boolean)
    .flatMap((element) => [
      element?.getAttribute('aria-controls'),
      element?.getAttribute('aria-owns'),
      element?.getAttribute('aria-describedby'),
    ])
    .filter((id): id is string => Boolean(id));
  const controlled = ids.flatMap((id) => {
    try {
      return Array.from(doc.querySelectorAll(`#${cssEscape(id)}`));
    } catch {
      return [];
    }
  });
  return controlled.filter(isVisibleElement);
}

function collectVisibleOverlayRoots(doc: Document, root: Element, input: Element | null): Element[] {
  const controlled = collectControlledOverlayRoots(doc, root, input);
  const controlledWithOptions = controlled
    .filter((candidate) => overlaySelectors.some((selector) => candidate.querySelector(selector)));
  if (controlledWithOptions.length > 0) return uniqueByIdentity(controlledWithOptions);

  const visible = overlayRootSelectors
    .flatMap((selector) => Array.from(doc.querySelectorAll(selector)))
    .filter((candidate) => candidate !== doc.body && candidate !== doc.documentElement)
    .filter(isVisibleElement)
    .filter((candidate) => overlaySelectors.some((selector) => candidate.querySelector(selector)));
  return uniqueByIdentity([...controlled, ...visible]);
}

async function waitForScopedOptions(
  doc: Document,
  scopes: Element[],
  attempts = 14,
): Promise<Element[]> {
  for (let i = 0; i < attempts; i++) {
    const roots = scopes.length > 0 ? scopes : [doc.body];
    const candidates = roots.flatMap((scope) => (
      overlaySelectors.flatMap((selector) => Array.from(scope.querySelectorAll(selector)))
    ));
    const visible = uniqueByIdentity(candidates).filter(isVisibleElement);
    if (visible.length > 0) return visible;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

async function clickMatchingOption(
  doc: Document,
  value: string,
  fillOptions?: FillElementOptions,
  stage = 'custom-select:options',
  scopes: Element[] = [],
): Promise<boolean> {
  const candidates = scopes.length > 0
    ? await waitForScopedOptions(doc, scopes)
    : await waitForOptions(doc, overlaySelectors);
  addTrace(fillOptions, {
    stage,
    optionCount: candidates.length,
    optionSamples: optionSamples(candidates),
  });
  const enabled = candidates.filter((option) => {
    const element = option as HTMLElement;
    if (element.getAttribute('aria-disabled') === 'true' || element.classList.contains('is-disabled')) return false;
    return true;
  });
  const target = normalizeToken(value);
  const exactMatch = enabled.find((option) => normalizeToken(option.textContent ?? '') === target);
  const looseMatch = enabled.find((option) => optionMatchesText(option.textContent ?? '', value));
  const match = exactMatch ?? looseMatch;
  if (!match) return false;
  clickElement(match);
  await new Promise((resolve) => setTimeout(resolve, 120));
  addTrace(fillOptions, {
    stage: `${stage}:selected`,
    success: true,
    selectedOption: (match.textContent ?? '').trim().replace(/\s+/g, ' '),
  });
  return true;
}

async function fillCustomSelect(el: Element, value: string, options?: FillElementOptions): Promise<boolean> {
  const root = closestInteractiveRoot(el);
  const input = innerTextInput(root);
  const doc = el.ownerDocument;
  if (!doc) return false;

  addTrace(options, {
    stage: 'custom-select:start',
    root: describeElement(root),
    input: describeElement(input),
    inputReadonly: input?.readOnly,
    inputDisabled: input?.disabled,
  });

  if (input && !input.disabled) input.focus();
  const trigger = root.querySelector('.el-input__wrapper, .el-select__wrapper, .el-input__inner, input, [role="combobox"]') ?? root;
  clickElement(trigger);
  clickElement(root);
  await new Promise((resolve) => setTimeout(resolve, 80));
  let scopes = collectVisibleOverlayRoots(doc, root, input);
  addTrace(options, {
    stage: 'custom-select:scopes-after-open',
    optionCount: scopes.length,
    optionSamples: scopes.map(describeElement).slice(0, 8),
  });
  if (await clickMatchingOption(doc, value, options, 'custom-select:after-open', scopes)) return true;

  if (input && !input.disabled) {
    const wasReadOnly = input.readOnly;
    if (wasReadOnly && input instanceof HTMLInputElement) input.readOnly = false;
    input.focus();
    setNativeValue(input, value);
    dispatchEvents(input, ['focus', 'input']);
    if (wasReadOnly && input instanceof HTMLInputElement) input.readOnly = true;
    addTrace(options, {
      stage: 'custom-select:type-filter',
      inputReadonly: wasReadOnly,
      message: wasReadOnly ? 'Temporarily removed readonly while dispatching input.' : undefined,
    });
  }

  const waitMs = root.matches('.el-autocomplete') || root.closest('.el-autocomplete') || input?.readOnly ? 1200 : 300;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  scopes = collectVisibleOverlayRoots(doc, root, input);
  addTrace(options, {
    stage: 'custom-select:scopes-after-filter',
    optionCount: scopes.length,
    optionSamples: scopes.map(describeElement).slice(0, 8),
  });
  if (await clickMatchingOption(doc, value, options, 'custom-select:after-filter', scopes)) return true;

  if (input && !input.disabled) {
    dispatchKeyboard(input, 'Enter');
    dispatchEvents(input, ['change', 'blur']);
    const success = normalizeToken(input.value) === normalizeToken(value);
    addTrace(options, { stage: 'custom-select:enter-fallback', success });
    return success;
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

function collectGroupedControlRoots(group: Element): Element[] {
  const primary = uniqueElements(Array.from(group.querySelectorAll<Element>(
    'select, .el-select, .el-cascader, .ant-select, [role="combobox"]',
  )).map(closestInteractiveRoot));
  const fallbackInputs = Array.from(group.querySelectorAll<Element>('input[placeholder]'))
    .filter((input) => !primary.some((root) => root === input || root.contains(input) || input.contains(root)))
    .map(closestInteractiveRoot);
  return uniqueElements([...primary, ...fallbackInputs]);
}

function findGroupedRegionToken(el: Element, tokens: string[], options?: FillElementOptions): string | null {
  const group = el.closest('.el-form-item, .ant-form-item, fieldset, [role="group"]');
  if (!group || tokens.length < 2) return null;
  const text = `${group.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  if (!/籍贯|出生地|户籍|所在地|城市|地区|国家|省|市/.test(text)) return null;

  const controlRoots = collectGroupedControlRoots(group);
  addTrace(options, {
    stage: 'region:group-detected',
    root: describeElement(group),
    optionCount: controlRoots.length,
    optionSamples: controlRoots.map(describeElement).slice(0, 8),
  });
  if (controlRoots.length < 2) return null;

  const root = closestInteractiveRoot(el);
  const index = controlRoots.findIndex((control) => control === root || control.contains(root) || root.contains(control));
  if (index < 0) return null;

  const startsWithCountry = /^中国$|^China$/i.test(tokens[0] ?? '');
  const tokenIndex = startsWithCountry && controlRoots.length === tokens.length - 1 ? index + 1 : index;
  const token = tokens[tokenIndex] ?? null;
  addTrace(options, {
    stage: 'region:group-token',
    success: Boolean(token),
    selectedOption: token ?? undefined,
    message: `index=${index}; tokenIndex=${tokenIndex}`,
  });
  return token;
}

function collectCascaderOptions(doc: Document, scopes: Element[] = []): Element[] {
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
  const roots = scopes.length > 0 ? scopes : [doc.body];
  return uniqueElements(roots.flatMap((root) => (
    selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)))
  )));
}

function shouldFillAsRegion(el: Element, value: string): boolean {
  const tokens = splitRegionTokens(value);
  if (tokens.length < 2) return false;
  const group = el.closest('.el-form-item, .ant-form-item, fieldset, [role="group"]');
  const input = innerTextInput(closestInteractiveRoot(el));
  const text = [
    group?.textContent,
    el.textContent,
    el.getAttribute('aria-label'),
    el.getAttribute('name'),
    el.getAttribute('id'),
    input?.placeholder,
  ].filter(Boolean).join(' ');
  return /籍贯|出生地|户籍|所在地|城市|地区|国家|省|市|地点|面试地点|工作地点/i.test(text);
}

async function clickMatchingCascaderOption(
  doc: Document,
  token: string,
  options?: FillElementOptions,
  scopes: Element[] = [],
): Promise<boolean> {
  const candidates = collectCascaderOptions(doc, scopes).filter(isVisibleElement);
  addTrace(options, {
    stage: 'cascader:options',
    optionCount: candidates.length,
    optionSamples: optionSamples(candidates),
  });
  const normalizedToken = normalizeToken(token);
  const match = candidates.find((option) => normalizeToken(option.textContent ?? '') === normalizedToken)
    ?? candidates.find((option) => optionMatchesText(option.textContent ?? '', token));
  if (!match) return false;
  match.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  match.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
  clickElement(match);
  await new Promise((resolve) => setTimeout(resolve, 120));
  addTrace(options, {
    stage: 'cascader:selected',
    success: true,
    selectedOption: (match.textContent ?? '').trim().replace(/\s+/g, ' '),
  });
  return true;
}

async function fillCascaderRegion(el: Element, value: string, options?: FillElementOptions): Promise<boolean> {
  const tokens = splitRegionTokens(value);
  if (tokens.length === 0) return false;

  addTrace(options, {
    stage: 'region:start',
    root: describeElement(closestInteractiveRoot(el)),
    optionSamples: tokens,
  });

  const groupedToken = findGroupedRegionToken(el, tokens, options);
  if (groupedToken) return fillCustomSelect(el, groupedToken, options);

  if (await fillLinkedRegionSelects(el, tokens)) return true;

  const doc = el.ownerDocument;
  const root = closestInteractiveRoot(el);
  clickElement(root.querySelector('.el-input__wrapper, .el-select__wrapper, .el-input__inner, input, [role="combobox"]') ?? root);
  clickElement(root);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const scopes = collectVisibleOverlayRoots(doc, root, innerTextInput(root));
  addTrace(options, {
    stage: 'cascader:scopes-after-open',
    optionCount: scopes.length,
    optionSamples: scopes.map(describeElement).slice(0, 8),
  });

  let matched = 0;
  for (const token of tokens) {
    if (await clickMatchingCascaderOption(doc, token, options, scopes)) matched++;
    else break;
  }

  dispatchEvents(el, ['focus', 'input', 'change', 'blur']);
  return matched >= Math.min(tokens.length, 2);
}

export async function fillElement(
  el: Element,
  value: string,
  inputType: InputType,
  options: FillElementOptions = {},
): Promise<boolean> {
  if (!value) return false;

  switch (inputType) {
    case 'text': {
      const input = innerTextInput(el);
      if (!input) return false;
      const filled = await fillText(input, value, options);
      if (filled) return true;
      return isChoiceLikeElement(el) ? fillCustomSelect(el, value, options) : false;
    }

    case 'textarea': {
      const input = innerTextInput(el);
      return input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
        ? fillText(input, value, options)
        : false;
    }

    case 'select':
      return el instanceof HTMLSelectElement ? fillSelect(el, value, options) : fillCustomSelect(el, value, options);

    case 'radio':
      return el instanceof HTMLInputElement ? fillRadio(el, value) : false;

    case 'checkbox':
      return el instanceof HTMLInputElement ? fillCheckbox(el, value) : false;

    case 'date':
      return el instanceof HTMLInputElement ? fillDate(el, value, options) : fillCustomDate(el, value, options);

    case 'custom-select':
      if (shouldFillAsRegion(el, value)) return fillCascaderRegion(el, value, options);
      return fillCustomSelect(el, value, options);

    case 'cascader-region':
      return fillCascaderRegion(el, value, options);

    case 'contenteditable':
      return fillContenteditable(el as HTMLElement, value);

    default:
      return false;
  }
}
