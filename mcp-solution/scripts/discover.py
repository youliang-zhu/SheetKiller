from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from common import (
    BROWSER_USER_DATA_DIR,
    MAPPINGS_DIR,
    PROFILE_PATH,
    add_common_args,
    browser_session_metadata,
    configure_project_environment,
    ensure_runtime_dirs,
    guess_profile_path,
    is_upload_label,
    load_json,
    mask_value,
    now_iso,
    profile_schema,
    save_json,
    strategy_for,
    target_preview,
)


DISCOVERY_JS = r"""
() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  const text = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const attrs = ['name', 'aria-label', 'placeholder', 'data-testid', 'data-test', 'role'];
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (value) return `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };

  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (aria) {
      if (el.getAttribute('aria-labelledby')) {
        return text(el.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.innerText).join(' '));
      }
      return text(aria);
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return text(label.innerText);
    }
    const wrapping = el.closest('label');
    if (wrapping) return text(wrapping.innerText);
    const holder = el.closest('.ant-form-item, .el-form-item, [class*="form-item"], [class*="field"], [class*="row"], [class*="item"]');
    if (holder) {
      const label = holder.querySelector('label, .ant-form-item-label, .el-form-item__label, [class*="label"]');
      if (label) return text(label.innerText);
      const holderText = text(holder.innerText).split('\n')[0];
      if (holderText && holderText.length <= 80) return holderText;
    }
    return text(el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText);
  };

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="section"]')]
    .filter(visible)
    .map((el) => ({ text: text(el.innerText), y: el.getBoundingClientRect().top }))
    .filter((item) => item.text && item.text.length <= 80);

  const sectionFor = (el) => {
    const y = el.getBoundingClientRect().top;
    const before = headings.filter((h) => h.y <= y).slice(-1)[0];
    return before?.text || '';
  };

  const guessControl = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const cls = el.className || '';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (type === 'file') return 'upload';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'date') return 'date';
    if (type === 'month') return 'month';
    if (role === 'combobox' || /select|picker|cascader/i.test(cls)) return 'select_by_text';
    return 'text_input';
  };

  const candidates = [
    ...document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"]')
  ].filter(visible);

  return candidates.map((el, index) => {
    const rect = el.getBoundingClientRect();
    const label = labelFor(el);
    const value = el.value ?? el.getAttribute('value') ?? el.innerText ?? '';
    const required = el.required || el.getAttribute('aria-required') === 'true' || /[*＊]/.test(label);
    const controlType = guessControl(el);
    return {
      field_id: `field.${index + 1}`,
      section: sectionFor(el),
      label,
      placeholder: el.getAttribute('placeholder') || '',
      current_value: value,
      has_current_value: Boolean(value),
      required,
      control_type_guess: controlType,
      dom: {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        selector_candidates: [cssPath(el)],
      },
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    };
  });
}
"""


def normalize_field(field: dict[str, Any]) -> dict[str, Any]:
    value = field.pop("current_value", "")
    field["has_current_value"] = bool(value)
    field["current_value_preview"] = mask_value(value) if value else ""
    if is_upload_label(" ".join([field.get("label", ""), field.get("placeholder", "")]), field.get("control_type_guess", "")):
        field["control_type_guess"] = "upload"
    return field


def make_draft_mapping(site: str, url: str, discovery: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    entries = []
    for field in discovery["fields"]:
        label = " ".join(
            part for part in [field.get("section"), field.get("label"), field.get("placeholder")] if part
        )
        control_type = field.get("control_type_guess", "text_input")
        profile_path, confidence, reason = guess_profile_path(label, control_type)
        strategy = strategy_for(control_type, label)
        enabled = bool(profile_path) and strategy != "skip_upload"
        entries.append(
            {
                "mapping_id": field["field_id"],
                "enabled": enabled,
                "section": field.get("section", ""),
                "label": field.get("label", ""),
                "placeholder": field.get("placeholder", ""),
                "required": field.get("required", False),
                "profile_path": profile_path,
                "target_preview": target_preview(profile, profile_path),
                "control_type": control_type,
                "strategy": strategy,
                "selector": {
                    "type": "css",
                    "value": field.get("dom", {}).get("selector_candidates", [""])[0],
                },
                "verify": {
                    "type": "value_or_text_contains_profile",
                    "profile_path": profile_path,
                },
                "on_fail": "skip_and_report",
                "status": "needs_review" if enabled else ("skipped" if strategy == "skip_upload" else "unmapped"),
                "confidence": confidence,
                "reason": reason,
                "skip_reason": "upload_field" if strategy == "skip_upload" else "",
            }
        )
    return {
        "site": site,
        "target_url": url,
        "generated_at": now_iso(),
        "browser_session": browser_session_metadata(),
        "profile_schema": profile_schema(profile),
        "entries": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover visible form fields and generate a draft mapping.")
    add_common_args(parser)
    parser.add_argument("--no-pause", action="store_true", help="Do not wait for manual login before discovery.")
    args = parser.parse_args()

    ensure_runtime_dirs()
    configure_project_environment()

    user_data_dir = Path(args.user_data_dir).resolve()
    if user_data_dir != BROWSER_USER_DATA_DIR.resolve():
        raise SystemExit(f"user_data_dir must be {BROWSER_USER_DATA_DIR}; got {user_data_dir}")
    if not args.url:
        raise SystemExit("--url is required for discovery")

    profile = load_json(PROFILE_PATH)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_USER_DATA_DIR),
            headless=False,
            viewport={"width": 1440, "height": 1000},
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        if not args.no_pause:
            print("请在打开的浏览器中完成登录/验证码，并进入目标表单页面。")
            input("确认页面已准备好后按 Enter 开始只读发现...")
        try:
            page.wait_for_load_state("networkidle", timeout=8_000)
        except PlaywrightTimeoutError:
            pass

        fields = [normalize_field(field) for field in page.evaluate(DISCOVERY_JS)]
        url = page.url
        discovery = {
            "site": args.site,
            "target_url": url,
            "title": page.title(),
            "discovered_at": now_iso(),
            "browser_session": browser_session_metadata(),
            "fields": fields,
        }
        discovery_path = MAPPINGS_DIR / f"{args.site}.discovery.json"
        draft_path = MAPPINGS_DIR / f"{args.site}.draft.json"
        save_json(discovery_path, discovery)
        save_json(draft_path, make_draft_mapping(args.site, url, discovery, profile))
        print(f"Discovery written: {discovery_path}")
        print(f"Draft mapping written: {draft_path}")
        print("请运行 review UI 检查并保存为 confirmed mapping 后再执行填表。")
        context.close()


if __name__ == "__main__":
    main()
