import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const USER_DATA_DIR = path.join(ROOT, '.manual-browser-profile');

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(prefix, data) {
  await ensureDir(REPORT_DIR);
  const file = path.join(REPORT_DIR, `${prefix}-${stamp()}.json`);
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

function compact(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function splitTokens(value) {
  return String(value || '').split(/[,\uFF0C\u3001\s/>-]+/).map((token) => token.trim()).filter(Boolean);
}

function fieldSelector(index) {
  return `[data-sheetkiller-probe-id="${index}"]`;
}

const browserRuntime = String.raw`
(() => {
  const SKIP_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image', 'file', 'password']);
  const SCANNABLE = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
    '[role="combobox"]'
  ].join(',');
  const OPTION_SELECTOR = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="treeitem"]',
    '.ant-select-item-option',
    '.ant-cascader-menu-item',
    '.ant-cascader-menu-item-content',
    '.el-select-dropdown__item',
    '.el-cascader-node:not(.is-disabled)',
    '.el-cascader-node__label',
    '.dropdown-item',
    '.cascader-option',
    '.cascader-item',
    '[class*="option"]'
  ].join(',');

  function norm(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function compact(text) {
    return norm(text).replace(/\s+/g, '').toLowerCase();
  }

  function stripRegionSuffix(text) {
    return compact(text).replace(/[\u7701\u5E02\u533A\u53BF]/g, '');
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  }

  function textWithoutControls(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, option, script, style, svg, button').forEach((child) => child.remove());
    return norm(clone.textContent || '');
  }

  function labelOf(el) {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return norm(label.textContent || '');
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return textWithoutControls(parentLabel);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      return norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
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

  function rootOf(el) {
    return el.closest('tr, fieldset, .form-group, .field, .form-item, .form-row, .ant-form-item, .el-form-item, label, form') ||
      el.parentElement ||
      el;
  }

  function optionsOf(el) {
    if (el instanceof HTMLSelectElement) {
      return Array.from(el.options).map((option) => norm(option.textContent || option.value)).filter(Boolean);
    }
    const ids = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
    if (!ids) return [];
    return ids.split(/\s+/)
      .flatMap((id) => Array.from(document.getElementById(id)?.querySelectorAll('[role="option"]') || []))
      .map((option) => norm(option.textContent || ''))
      .filter(Boolean);
  }

  function kindOf(el) {
    if (el instanceof HTMLTextAreaElement) return 'textarea';
    if (el instanceof HTMLSelectElement) return 'select';
    if (el instanceof HTMLInputElement) {
      if (SKIP_TYPES.has((el.type || 'text').toLowerCase())) return 'skip';
      if (el.type === 'radio') return 'radio';
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'date' || el.type === 'month') return 'date';
      return 'text';
    }
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') return 'contenteditable';
    if (el.getAttribute('role') === 'combobox') return 'custom-select';
    return 'unknown';
  }

  function valueOf(el) {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'radio' || el.type === 'checkbox') return el.checked ? 'true' : 'false';
      return el.value || '';
    }
    if (el instanceof HTMLTextAreaElement) return el.value || '';
    if (el instanceof HTMLSelectElement) return norm(el.selectedOptions[0]?.textContent || el.value || '');
    return norm(el.textContent || '');
  }

  function sensitive(text) {
    if (/captcha|\u9A8C\u8BC1\u7801/i.test(text)) return 'captcha';
    if (/verify.?code|\u77ED\u4FE1|\u6821\u9A8C\u7801/i.test(text)) return 'verify_code';
    if (/password|\u5BC6\u7801/i.test(text)) return 'password';
    if (/upload|\u9644\u4EF6|\u4E0A\u4F20/i.test(text)) return 'upload';
    if (/id.?card|\u8EAB\u4EFD\u8BC1/i.test(text)) return 'id_card';
    return '';
  }

  function scan() {
    return Array.from(document.querySelectorAll(SCANNABLE))
      .filter((el) => visible(el))
      .map((el, index) => {
        const root = rootOf(el);
        const label = labelOf(el);
        const context = textWithoutControls(root);
        const type = kindOf(el);
        const text = [label, context, el.placeholder, el.name, el.id, el.getAttribute('aria-label')].join(' ');
        el.setAttribute('data-sheetkiller-probe-id', String(index));
        return {
          index,
          type,
          label,
          context,
          placeholder: el.getAttribute('placeholder') || '',
          name: el.getAttribute('name') || '',
          id: el.getAttribute('id') || '',
          options: optionsOf(el),
          value: valueOf(el),
          readOnly: Boolean(el.readOnly),
          disabled: Boolean(el.disabled),
          sensitive: sensitive(text)
        };
      })
      .filter((field) => field.type !== 'skip');
  }

  function dispatch(el) {
    for (const name of ['focus', 'input', 'change', 'blur']) {
      const event = name === 'input' || name === 'change'
        ? new Event(name, { bubbles: true, cancelable: true })
        : new FocusEvent(name, { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    }
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  }

  function matchesOption(text, value) {
    const a = stripRegionSuffix(text);
    const b = stripRegionSuffix(value);
    return a === b || a.includes(b) || b.includes(a);
  }

  function annotate(el, attr) {
    const id = 'skp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    document.querySelectorAll('[' + attr + ']').forEach((node) => node.removeAttribute(attr));
    el.setAttribute(attr, id);
    return id;
  }

  function triggerFor(index) {
    const el = document.querySelector('[data-sheetkiller-probe-id="' + index + '"]');
    if (!el) return '';
    const trigger = el.closest('.el-select, .el-cascader, .el-input, .ant-select, .ant-cascader, .ant-cascader-picker, [role="combobox"]') || el;
    return annotate(trigger, 'data-sheetkiller-trigger-id');
  }

  function markOption(value) {
    const candidates = Array.from(document.querySelectorAll(OPTION_SELECTOR)).filter(visible);
    const target = candidates.find((option) => matchesOption(option.textContent || '', value));
    if (!target) return '';
    const clickable = target.closest('.el-cascader-node, .ant-cascader-menu-item, .ant-select-item-option, .el-select-dropdown__item, [role="menuitem"], [role="treeitem"], [role="option"]') || target;
    return annotate(clickable, 'data-sheetkiller-option-id');
  }

  function fallbackFillText(index, value) {
    const el = document.querySelector('[data-sheetkiller-probe-id="' + index + '"]');
    if (!el) return { ok: false, actual: '', reason: 'element missing' };
    setNativeValue(el, value);
    dispatch(el);
    return { ok: true, actual: valueOf(el), reason: 'js fallback' };
  }

  function readField(index) {
    const el = document.querySelector('[data-sheetkiller-probe-id="' + index + '"]');
    if (!el) return { actual: '', visibleText: '', exists: false };
    const root = rootOf(el);
    return {
      actual: valueOf(el),
      visibleText: textWithoutControls(root),
      exists: true
    };
  }

  window.__sheetkillerProbe = { scan, triggerFor, markOption, fallbackFillText, readField };
})();
`;

function usage() {
  console.log(`
Usage:
  npm run manual:probe -- --url="https://example.com/apply?x=1&y=2" --plan="D:\\path\\plan.json"

Commands:
  scan       rescan current page and write fields to reports/
  fill       run the current plan and write a report
  reload     reinject probe runtime
  quit       close browser
`);
}

function findField(fields, item) {
  if (item.index !== undefined) {
    const byIndex = fields.find((candidate) => candidate.index === item.index);
    if (byIndex) return byIndex;
  }
  const needle = compact(item.labelIncludes || item.label || '');
  if (!needle) return undefined;
  return fields.find((candidate) => compact([
    candidate.label,
    candidate.context,
    candidate.placeholder,
    candidate.name,
    candidate.id,
  ].join(' ')).includes(needle));
}

function verifyValue(actual, expected, strategy, visibleText = '') {
  const expectedCompact = compact(expected);
  const actualCompact = compact(actual);
  const visibleCompact = compact(visibleText);
  if (!expectedCompact) return false;
  if (actualCompact === expectedCompact || actualCompact.includes(expectedCompact)) return true;
  if (visibleCompact.includes(expectedCompact)) return true;
  if (strategy === 'cascader-region') {
    return splitTokens(expected).every((token) => {
      const clean = compact(token).replace(/[\u7701\u5E02\u533A\u53BF]/g, '');
      return actualCompact.includes(clean) || visibleCompact.includes(clean);
    });
  }
  return false;
}

async function readField(page, index) {
  return page.evaluate((fieldIndex) => window.__sheetkillerProbe.readField(fieldIndex), index);
}

async function fillTextLike(page, field, value) {
  const locator = page.locator(fieldSelector(field.index)).first();
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    await locator.click({ timeout: 2000, force: true });
    await locator.fill(value, { timeout: 3000 });
    await locator.press('Tab', { timeout: 1000 }).catch(() => {});
  } catch (error) {
    const fallback = await page.evaluate(
      ({ index, nextValue }) => window.__sheetkillerProbe.fallbackFillText(index, nextValue),
      { index: field.index, nextValue: value },
    );
    if (!fallback.ok) return { ok: false, reason: fallback.reason || error.message };
  }
  await page.waitForTimeout(200);
  const readback = await readField(page, field.index);
  return { ok: verifyValue(readback.actual, value, field.type, readback.visibleText), ...readback };
}

async function fillNativeSelect(page, field, value) {
  const locator = page.locator(fieldSelector(field.index)).first();
  try {
    await locator.selectOption({ label: value }, { timeout: 2000 });
  } catch {
    try {
      await locator.selectOption(value, { timeout: 2000 });
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }
  await page.waitForTimeout(200);
  const readback = await readField(page, field.index);
  return { ok: verifyValue(readback.actual, value, 'select', readback.visibleText), ...readback };
}

async function clickMarkedTrigger(page, index) {
  const triggerId = await page.evaluate((fieldIndex) => window.__sheetkillerProbe.triggerFor(fieldIndex), index);
  if (!triggerId) return false;
  await page.locator(`[data-sheetkiller-trigger-id="${triggerId}"]`).first().click({ timeout: 3000, force: true });
  return true;
}

async function clickMarkedOption(page, value) {
  const optionId = await page.evaluate((nextValue) => window.__sheetkillerProbe.markOption(nextValue), value);
  if (!optionId) return false;
  const locator = page.locator(`[data-sheetkiller-option-id="${optionId}"]`).first();
  await locator.hover({ timeout: 1000 }).catch(() => {});
  await locator.click({ timeout: 3000, force: true });
  return true;
}

async function fillCustomSelect(page, field, value) {
  if (!(await clickMarkedTrigger(page, field.index))) return { ok: false, reason: 'trigger not found' };
  await page.waitForTimeout(500);
  if (!(await clickMarkedOption(page, value))) return { ok: false, reason: 'option not found' };
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(300);
  const readback = await readField(page, field.index);
  return { ok: verifyValue(readback.actual, value, 'custom-select', readback.visibleText), ...readback };
}

async function fillCascader(page, field, value) {
  const tokens = splitTokens(value);
  if (tokens.length === 0) return { ok: false, reason: 'empty cascader value' };
  if (!(await clickMarkedTrigger(page, field.index))) return { ok: false, reason: 'trigger not found' };
  await page.waitForTimeout(600);

  let clicked = 0;
  for (const token of tokens) {
    if (!(await clickMarkedOption(page, token))) break;
    clicked += 1;
    await page.waitForTimeout(500);
  }

  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(500);
  const readback = await readField(page, field.index);
  const verified = verifyValue(readback.actual, value, 'cascader-region', readback.visibleText);
  return {
    ok: clicked >= Math.min(tokens.length, 2) && verified,
    actual: readback.actual,
    visibleText: readback.visibleText,
    clicked,
    reason: clicked === 0 ? 'no cascader option clicked' : verified ? 'filled' : 'readback mismatch',
  };
}

async function fillOne(page, field, item) {
  if (field.sensitive && !['phone', 'email', 'id_card'].includes(field.sensitive)) {
    return { ok: false, skipped: true, reason: `sensitive human field: ${field.sensitive}` };
  }
  if (field.disabled) return { ok: false, reason: 'field disabled' };

  const strategy = item.strategy || field.type;
  const value = String(item.value || '');
  if (!value) return { ok: false, reason: 'empty value' };

  if (strategy === 'text' || strategy === 'textarea' || strategy === 'date' || strategy === 'contenteditable') {
    return fillTextLike(page, field, value);
  }
  if (strategy === 'select') return fillNativeSelect(page, field, value);
  if (strategy === 'custom-select') return fillCustomSelect(page, field, value);
  if (strategy === 'cascader-region') return fillCascader(page, field, value);
  return { ok: false, reason: `unsupported strategy: ${strategy}` };
}

async function runPlan(page, plan) {
  const fields = await page.evaluate(() => window.__sheetkillerProbe.scan());
  const reports = [];
  for (const item of plan) {
    const field = findField(fields, item);
    if (!field) {
      reports.push({ item, status: 'failed_to_find_field' });
      continue;
    }
    const result = await fillOne(page, field, item);
    const verified = result.ok && verifyValue(result.actual, item.value, item.strategy || field.type, result.visibleText);
    reports.push({
      field,
      item,
      ok: result.ok,
      verified,
      actual: result.actual || '',
      visibleText: result.visibleText || '',
      reason: result.reason || (verified ? 'filled' : 'fill failed'),
      clicked: result.clicked,
      skipped: result.skipped,
    });
  }
  const afterFields = await page.evaluate(() => window.__sheetkillerProbe.scan());
  return { fields, afterFields, reports };
}

async function main() {
  const url = arg('url');
  const planPath = arg('plan');
  const userDataDir = path.resolve(arg('profile', USER_DATA_DIR));
  if (!url) {
    usage();
    process.exitCode = 1;
    return;
  }

  await ensureDir(REPORT_DIR);
  await ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1360, height: 900 },
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  async function inject() {
    await page.evaluate(browserRuntime);
  }

  async function loadPlan() {
    if (!planPath) return [];
    const text = await fs.readFile(path.resolve(planPath), 'utf8');
    return JSON.parse(text);
  }

  await inject();
  console.log('Visible browser opened. Complete login/CAPTCHA manually if needed.');
  console.log('Type "scan", "fill", "reload", or "quit".');

  const rl = readline.createInterface({ input, output });
  async function handleCommand(rawCommand) {
    const command = rawCommand.trim().toLowerCase();
    if (command === 'quit' || command === 'exit') return true;
    if (command === 'reload') {
      await inject();
      console.log('Probe runtime reinjected.');
      return false;
    }
    if (command === 'scan') {
      await inject();
      const fields = await page.evaluate(() => window.__sheetkillerProbe.scan());
      const file = await writeJson('manual-scan', fields);
      console.log(`Scanned ${fields.length} fields -> ${file}`);
      console.table(fields.map((field) => ({
        index: field.index,
        type: field.type,
        label: field.label || field.context || field.placeholder || field.name || field.id,
        value: field.value,
        readOnly: field.readOnly,
        sensitive: field.sensitive,
        options: field.options?.slice(0, 3).join('|') || '',
      })));
      return false;
    }
    if (command === 'fill') {
      const plan = await loadPlan();
      if (plan.length === 0) {
        console.log('No plan loaded. Pass --plan="D:\\path\\plan.json"');
        return false;
      }
      await inject();
      const result = await runPlan(page, plan);
      const file = await writeJson('manual-fill-report', result);
      console.log(`Filled plan items: ${result.reports.length} -> ${file}`);
      console.table(result.reports.map((report) => ({
        label: report.field?.label || report.field?.context || report.item?.labelIncludes,
        ok: report.ok,
        verified: report.verified,
        actual: report.actual,
        reason: report.reason || report.status,
      })));
      return false;
    }
    if (command) usage();
    return false;
  }

  try {
    if (input.isTTY) {
      while (true) {
        const command = await rl.question('sheetkiller> ');
        if (await handleCommand(command)) break;
      }
    } else {
      for await (const command of rl) {
        if (await handleCommand(command)) break;
      }
    }
  } finally {
    rl.close();
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
