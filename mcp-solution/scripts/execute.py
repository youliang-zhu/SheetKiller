from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from playwright.sync_api import Locator, TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from common import (
    BROWSER_USER_DATA_DIR,
    MAPPINGS_DIR,
    PROFILE_PATH,
    REPORTS_DIR,
    add_common_args,
    assert_same_user_data_dir,
    configure_project_environment,
    ensure_runtime_dirs,
    load_json,
    now_iso,
    resolve_profile_path,
    save_json,
)


FINAL_SUBMIT_TEXT = ("确认提交", "提交", "Submit", "Confirm submission")
SAFE_SAVE_TEXT = ("暂存", "保存草稿", "保存", "预览", "Preview", "Save draft")


def report_entry(entry: dict[str, Any], status: str, message: str, sensitive: bool = False) -> dict[str, Any]:
    return {
        "mapping_id": entry.get("mapping_id", ""),
        "label": entry.get("label", ""),
        "strategy": entry.get("strategy", ""),
        "profile_path": entry.get("profile_path"),
        "status": status,
        "sensitive": sensitive,
        "message": message,
    }


def locator_for(page, entry: dict[str, Any]) -> Locator:
    selector = entry.get("selector", {})
    selector_type = selector.get("type")
    value = selector.get("value")
    if not value:
        raise ValueError("Missing selector.value")
    if selector_type == "css":
        return page.locator(value).first()
    if selector_type == "label_contains":
        return page.get_by_label(value).first()
    if selector_type == "placeholder":
        return page.get_by_placeholder(value).first()
    if selector_type == "role_name":
        return page.get_by_role(selector.get("role", "textbox"), name=value).first()
    raise ValueError(f"Unsupported selector type: {selector_type}")


def set_native_value(locator: Locator, value: str) -> None:
    locator.evaluate(
        """(el, value) => {
          const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor && descriptor.set) descriptor.set.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }""",
        value,
    )


def field_value(locator: Locator) -> str:
    return locator.evaluate(
        """(el) => {
          if ('value' in el) return el.value || '';
          return el.innerText || el.textContent || '';
        }"""
    )


def fill_text_like(page, entry: dict[str, Any], value: Any, dry_run: bool) -> str:
    locator = locator_for(page, entry)
    locator.wait_for(state="visible", timeout=8_000)
    text = str(value)
    if dry_run:
        return "dry_run: field located; value not written"
    set_native_value(locator, text)
    actual = field_value(locator)
    if text not in actual and actual not in text:
        raise ValueError("value did not persist after input/change/blur")
    return "filled and verified"


def select_by_text(page, entry: dict[str, Any], value: Any, dry_run: bool) -> str:
    locator = locator_for(page, entry)
    locator.wait_for(state="visible", timeout=8_000)
    text = str(value)
    if dry_run:
        return "dry_run: trigger located; option not selected"
    locator.click()
    option = page.get_by_text(text, exact=True).last
    try:
        option.wait_for(state="visible", timeout=3_000)
    except PlaywrightTimeoutError:
        option = page.get_by_text(text, exact=False).last
        option.wait_for(state="visible", timeout=3_000)
    option.click()
    return "selected by visible text"


def skip_upload(entry: dict[str, Any]) -> dict[str, Any]:
    return report_entry(entry, "skipped", "upload/file field skipped by policy")


def execute_entry(page, profile: dict[str, Any], entry: dict[str, Any], dry_run: bool) -> dict[str, Any]:
    if not entry.get("enabled", False):
        return report_entry(entry, "skipped", "mapping disabled")

    strategy = entry.get("strategy", "text_input")
    if strategy == "skip_upload":
        return skip_upload(entry)

    profile_path = entry.get("profile_path")
    value = resolve_profile_path(profile, profile_path)
    sensitive = (profile_path or "").split(".", 1)[0].split("[", 1)[0] in {"id_number", "phone", "email"}
    if value in (None, ""):
        return report_entry(entry, "skipped", "profile value is empty or missing", sensitive)

    try:
        if strategy in {"text_input", "textarea", "date_or_month", "autocomplete"}:
            message = fill_text_like(page, entry, value, dry_run)
        elif strategy == "select_by_text":
            message = select_by_text(page, entry, value, dry_run)
        elif strategy in {"checkbox", "radio"}:
            locator = locator_for(page, entry)
            if dry_run:
                message = "dry_run: checkbox/radio located"
            else:
                locator.check(timeout=8_000)
                message = "checked"
        elif strategy == "cascader_region":
            message = select_by_text(page, entry, value, dry_run)
        else:
            return report_entry(entry, "skipped", f"unsupported strategy: {strategy}", sensitive)
        return report_entry(entry, "dry_run" if dry_run else "filled", message, sensitive)
    except Exception as exc:
        return report_entry(entry, "failed", str(exc), sensitive)


def click_safe_save(page) -> str:
    for text in SAFE_SAVE_TEXT:
        try:
            button = page.get_by_role("button", name=text).first
            if button.count() and button.is_visible():
                name = button.inner_text(timeout=1_000)
                if any(blocked in name for blocked in FINAL_SUBMIT_TEXT):
                    continue
                button.click()
                return f"clicked safe button: {name}"
        except Exception:
            continue
    return "no safe save/preview button clicked"


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute a confirmed mapping with local Playwright.")
    add_common_args(parser)
    parser.add_argument("--mapping", help="Mapping JSON path. Defaults to mcp-solution/mappings/<site>.json")
    parser.add_argument("--allow-draft", action="store_true", help="Allow executing <site>.draft.json for testing.")
    parser.add_argument("--dry-run", action="store_true", help="Locate and verify fields without writing values.")
    parser.add_argument("--save-draft", action="store_true", help="Click a safe preview/draft/save button after filling.")
    args = parser.parse_args()

    ensure_runtime_dirs()
    configure_project_environment()
    user_data_dir = Path(args.user_data_dir).resolve()
    if user_data_dir != BROWSER_USER_DATA_DIR.resolve():
        raise SystemExit(f"user_data_dir must be {BROWSER_USER_DATA_DIR}; got {user_data_dir}")
    mapping_path = Path(args.mapping) if args.mapping else MAPPINGS_DIR / f"{args.site}.json"
    if not mapping_path.exists() and args.allow_draft:
        mapping_path = MAPPINGS_DIR / f"{args.site}.draft.json"
    if not mapping_path.exists():
        raise SystemExit(f"Mapping not found: {mapping_path}")

    mapping = load_json(mapping_path)
    assert_same_user_data_dir(mapping)
    profile = load_json(PROFILE_PATH)
    target_url = args.url or mapping.get("target_url")
    if not target_url:
        raise SystemExit("No target URL found. Provide --url or include target_url in mapping.")

    results: list[dict[str, Any]] = []
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_USER_DATA_DIR),
            headless=False,
            viewport={"width": 1440, "height": 1000},
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(target_url, wait_until="domcontentloaded", timeout=60_000)
        print("请确认浏览器已经登录并停留在目标表单。")
        input("确认后按 Enter 开始执行 mapping...")

        for entry in mapping.get("entries", []):
            results.append(execute_entry(page, profile, entry, args.dry_run))

        save_message = "not requested"
        if args.save_draft and not args.dry_run:
            save_message = click_safe_save(page)

        report = {
            "site": args.site,
            "mapping_path": str(mapping_path),
            "target_url": page.url,
            "started_at": now_iso(),
            "dry_run": args.dry_run,
            "save_action": save_message,
            "results": results,
        }
        report_path = REPORTS_DIR / f"{args.site}-{datetime_safe(now_iso())}.json"
        save_json(report_path, report)
        print(f"Execution report written: {report_path}")
        print("浏览器会在你按 Enter 后关闭。请先人工核对页面。")
        input("核对完成后按 Enter 关闭浏览器...")
        context.close()


def datetime_safe(value: str) -> str:
    return value.replace(":", "").replace("+", "_").replace("-", "")


if __name__ == "__main__":
    main()
