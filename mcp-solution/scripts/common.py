from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MCP_ROOT = PROJECT_ROOT / "mcp-solution"
MAPPINGS_DIR = MCP_ROOT / "mappings"
REPORTS_DIR = MCP_ROOT / "reports"
PROFILE_PATH = PROJECT_ROOT / "data" / "profile.json"
BROWSER_USER_DATA_DIR = MCP_ROOT / "browser-profile"
MCP_OUTPUT_DIR = MCP_ROOT / "output"

SENSITIVE_PROFILE_KEYS = {"id_number", "phone", "email"}
UPLOAD_HINTS = ("上传", "附件", "简历", "作品集", "证件照", "file", "upload")


def ensure_runtime_dirs() -> None:
    MAPPINGS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    BROWSER_USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    MCP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def site_slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"https?://", "", value)
    value = re.sub(r"[^a-z0-9._-]+", "-", value)
    value = value.strip("-._")
    return value or "site"


def browser_session_metadata(mode: str = "shared_persistent_profile") -> dict[str, str]:
    return {
        "mode": mode,
        "user_data_dir": str(BROWSER_USER_DATA_DIR),
    }


def assert_same_user_data_dir(mapping: dict[str, Any]) -> None:
    recorded = (
        mapping.get("browser_session", {}).get("user_data_dir")
        or mapping.get("discovery", {}).get("browser_session", {}).get("user_data_dir")
    )
    if not recorded:
        raise ValueError("Mapping is missing browser_session.user_data_dir.")
    if Path(recorded).resolve() != BROWSER_USER_DATA_DIR.resolve():
        raise ValueError(
            "Mapping browser profile does not match executor profile: "
            f"{recorded} != {BROWSER_USER_DATA_DIR}"
        )


def configure_project_environment() -> None:
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(PROJECT_ROOT / "pw-browsers"))
    os.environ.setdefault("TEMP", str(PROJECT_ROOT / "tmp"))
    os.environ.setdefault("TMP", str(PROJECT_ROOT / "tmp"))


def mask_value(value: Any, profile_key: str | None = None) -> str:
    if value is None:
        return ""
    text = str(value)
    if not text:
        return ""
    key = (profile_key or "").split(".")[-1]
    if key == "phone" or re.fullmatch(r"\+?\d[\d -]{6,}", text):
        compact = re.sub(r"\D", "", text)
        return compact[:3] + "****" + compact[-4:] if len(compact) >= 7 else "***"
    if key == "email" or "@" in text:
        local, _, domain = text.partition("@")
        return (local[:1] + "***@" + domain) if domain else "***"
    if key == "id_number" or re.fullmatch(r"[0-9A-Za-z]{12,}", text):
        return text[:3] + "****" + text[-4:] if len(text) >= 8 else "***"
    if len(text) <= 2:
        return "*" * len(text)
    return text[:1] + "***" + text[-1:]


def profile_schema(profile: dict[str, Any]) -> dict[str, Any]:
    schema: dict[str, Any] = {}
    for key, value in profile.items():
        if key in SENSITIVE_PROFILE_KEYS:
            schema[key] = {"type": "sensitive_scalar", "preview": mask_value(value, key)}
        elif isinstance(value, list):
            schema[key] = {
                "type": "list",
                "count": len(value),
                "sample_keys": sorted(value[0].keys()) if value and isinstance(value[0], dict) else [],
            }
        elif isinstance(value, dict):
            schema[key] = {"type": "object", "keys": sorted(value.keys())}
        else:
            schema[key] = {"type": "scalar", "present": bool(value)}
    return schema


def resolve_profile_path(profile: dict[str, Any], path: str | None) -> Any:
    if not path:
        return None
    current: Any = profile
    for part in path.split("."):
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)])?", part)
        if not match:
            return None
        key, index = match.groups()
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
        if index is not None:
            if not isinstance(current, list):
                return None
            idx = int(index)
            if idx >= len(current):
                return None
            current = current[idx]
    return current


def target_preview(profile: dict[str, Any], profile_path: str | None) -> str:
    value = resolve_profile_path(profile, profile_path)
    if value is None:
        return ""
    root_key = profile_path.split(".", 1)[0].split("[", 1)[0] if profile_path else ""
    if root_key in SENSITIVE_PROFILE_KEYS:
        return mask_value(value, root_key)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def is_upload_label(label: str, control_type: str = "") -> bool:
    probe = f"{label} {control_type}".lower()
    return any(hint.lower() in probe for hint in UPLOAD_HINTS)


def strategy_for(control_type: str, label: str = "") -> str:
    if is_upload_label(label, control_type):
        return "skip_upload"
    if control_type in {"textarea", "text_input", "checkbox", "radio"}:
        return control_type
    if control_type in {"select", "select_by_text"}:
        return "select_by_text"
    if control_type in {"date", "month", "date_or_month"}:
        return "date_or_month"
    if control_type in {"cascader_region", "autocomplete"}:
        return control_type
    return "text_input"


def guess_profile_path(label: str, control_type: str = "") -> tuple[str | None, float, str]:
    text = re.sub(r"\s+", "", label.lower())
    rules: list[tuple[tuple[str, ...], str, float]] = [
        (("姓名", "name"), "name", 0.95),
        (("性别", "gender"), "gender", 0.95),
        (("出生", "生日", "birth"), "birth_date", 0.92),
        (("身份证", "证件号", "证件号码", "id"), "id_number", 0.9),
        (("手机号", "手机", "电话", "phone"), "phone", 0.9),
        (("邮箱", "email", "e-mail"), "email", 0.9),
        (("籍贯", "家乡", "生源地", "hometown"), "hometown", 0.82),
        (("现居", "当前城市", "居住地", "currentcity"), "current_city", 0.82),
        (("意向工作地点", "期望工作地点", "工作地点", "preferredworklocation"), "preferred_work_location", 0.86),
        (("开发语言", "擅长语言", "编程语言", "language"), "preferred_language_1", 0.78),
        (("学校", "院校"), "education[0].school", 0.72),
        (("学院", "院系"), "education[0].college", 0.68),
        (("专业", "major"), "education[0].major", 0.72),
        (("学历", "degree"), "education[0].degree", 0.7),
        (("导师", "supervisor"), "education[0].supervisor", 0.62),
        (("研究方向", "方向"), "education[0].research_direction", 0.6),
        (("公司", "单位", "组织"), "experience[0].organization", 0.58),
        (("职位", "岗位"), "experience[0].title", 0.58),
        (("项目名称", "项目"), "projects[0].name", 0.55),
    ]
    for hints, path, confidence in rules:
        if any(hint.lower() in text for hint in hints):
            return path, confidence, "keyword_match"
    if is_upload_label(label, control_type):
        return None, 1.0, "upload_skip"
    return None, 0.0, "unmatched"


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--site", required=True, help="Mapping site slug, e.g. iflytek")
    parser.add_argument("--url", help="Target form URL")
    parser.add_argument(
        "--user-data-dir",
        default=str(BROWSER_USER_DATA_DIR),
        help="Persistent browser profile. Must match architecture default unless intentionally changed.",
    )
