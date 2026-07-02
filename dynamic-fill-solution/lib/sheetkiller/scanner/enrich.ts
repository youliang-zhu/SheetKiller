import type { FieldInventoryItem } from '@/lib/sheetkiller/types';

const SCANNABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(',');

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textWithoutControls(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll('input, select, textarea, option, script, style, svg, button')
    .forEach((child) => child.remove());
  return normalizeText(clone.textContent ?? '');
}

function isVisible(el: HTMLElement): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return false;
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
}

function findLabel(el: HTMLElement): string {
  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent) return normalizeText(label.textContent);
  }
  const parentLabel = el.closest('label');
  if (parentLabel) return textWithoutControls(parentLabel);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    return normalizeText(labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' '));
  }
  const row = el.closest('tr');
  const cell = el.closest('td, th');
  if (row && cell) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    const index = cells.indexOf(cell);
    const labelCell = cells.slice(0, index).reverse().find((candidate) => textWithoutControls(candidate));
    if (labelCell) return textWithoutControls(labelCell);
  }
  return '';
}

function findContextRoot(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>('tr, fieldset, .form-group, .field, .form-item, .form-row, .ant-form-item, .el-form-item, label, form')
    ?? el.parentElement
    ?? el;
}

function sanitizeHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, svg, iframe, canvas').forEach((child) => child.remove());
  clone.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const keep = ['id', 'name', 'type', 'placeholder', 'title', 'aria-label', 'role'].includes(name) ||
        name.startsWith('data-');
      if (!keep || name.startsWith('on')) node.removeAttribute(attr.name);
    });
  });
  return normalizeText((clone as HTMLElement).outerHTML ?? '').slice(0, 800);
}

function getOptions(el: HTMLElement): string[] {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((option) => normalizeText(option.textContent ?? option.value))
      .filter(Boolean);
  }
  const ownedIds = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
  if (!ownedIds) return [];
  return ownedIds
    .split(/\s+/)
    .flatMap((id) => Array.from(el.ownerDocument.getElementById(id)?.querySelectorAll('[role="option"]') ?? []))
    .map((option) => normalizeText(option.textContent ?? ''))
    .filter(Boolean);
}

function currentValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && el.type === 'file') {
    return Array.from(el.files ?? []).map((file) => file.name).join(', ');
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return normalizeText(el.selectedOptions[0]?.textContent ?? el.value);
  return normalizeText(el.textContent ?? '');
}

function inferInputType(el: HTMLElement): FieldInventoryItem['inputType'] {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'radio') return 'radio';
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'date' || el.type === 'month') return 'date';
    if (el.type === 'file') return 'file';
    return 'text';
  }
  if (el.isContentEditable || el.getAttribute('role') === 'textbox') return 'contenteditable';
  if (el.getAttribute('role') === 'combobox') return 'custom-select';
  return 'unknown';
}

function detectSensitiveType(text: string): FieldInventoryItem['sensitiveType'] | undefined {
  if (/captcha|验证码/i.test(text)) return 'captcha';
  if (/verify.?code|短信|校验码/i.test(text)) return 'verify_code';
  if (/password|密码/i.test(text)) return 'password';
  if (/id.?card|身份证/i.test(text)) return 'id_card';
  if (/bank.?card|银行卡/i.test(text)) return 'bank_card';
  if (/phone|mobile|手机|电话/i.test(text)) return 'phone';
  if (/email|邮箱|邮件/i.test(text)) return 'email';
  if (/upload|附件|上传/i.test(text)) return 'upload';
  return undefined;
}

export function scanEnrichedFields(doc: Document = document): FieldInventoryItem[] {
  const fields: FieldInventoryItem[] = [];
  let index = 0;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(SCANNABLE_SELECTOR))) {
    if (!isVisible(el)) continue;
    const inputType = inferInputType(el);
    const label = findLabel(el);
    const root = findContextRoot(el);
    const context = textWithoutControls(root);
    const textForSafety = [
      label,
      context,
      el.getAttribute('placeholder') ?? '',
      el.getAttribute('aria-label') ?? '',
      el.getAttribute('name') ?? '',
      el.getAttribute('id') ?? '',
    ].join(' ');
    fields.push({
      fieldId: `field-${index++}`,
      element: el,
      inputType,
      label,
      hint: context.replace(label, '').trim(),
      placeholder: el.getAttribute('placeholder') ?? '',
      ariaLabel: el.getAttribute('aria-label') ?? '',
      name: el.getAttribute('name') ?? '',
      id: el.getAttribute('id') ?? '',
      section: root.closest('fieldset')?.querySelector('legend')?.textContent?.trim() ?? '',
      context,
      htmlSnippet: sanitizeHtml(root),
      options: getOptions(el),
      currentValue: currentValue(el),
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      visible: true,
      sensitiveType: detectSensitiveType(textForSafety),
      source: 'generic-scan',
    });
  }
  return fields;
}

