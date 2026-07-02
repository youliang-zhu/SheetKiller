r"""
使用 browser-use + OpenAI 模型读取本地个人信息文件，自动填写网申表单。

运行方式：
    D:\ToolProjectCode\SheetKiller\venv\Scripts\python.exe fill_form.py
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from browser_use import Agent, BrowserProfile, ChatOpenAI
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(PROJECT_ROOT / "pw-browsers"))
os.environ.setdefault("TEMP", str(PROJECT_ROOT / "tmp"))
os.environ.setdefault("TMP", str(PROJECT_ROOT / "tmp"))
os.environ.setdefault("BROWSER_USE_DISABLE_EXTENSIONS", "1")

load_dotenv(PROJECT_ROOT / ".env")

# ------------------ 只需要改这两行 ------------------
TARGET_URL = "https://iflytek.zhiye.com/form?fromPage=job&jobAdId=6dfa1f52-ca9d-447f-a950-496d228cc1b0&userId=199984273"
PROFILE_PATH = PROJECT_ROOT / "data" / "profile.json"
BROWSER_PROFILE_DIR = PROJECT_ROOT / "browser-profile"
CHROME_PATH = (
    PROJECT_ROOT
    / "pw-browsers"
    / "chromium-1228"
    / "chrome-win64"
    / "chrome.exe"
)
CDP_PORT = 9222
CDP_URL = f"http://127.0.0.1:{CDP_PORT}"
# -----------------------------------------------------


def load_profile(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_form_profile(profile: dict) -> dict:
    """Return exactly the data the agent may use to fill the form."""
    allowed_keys = [
        "name",
        "gender",
        "birth_date",
        "id_number",
        "phone",
        "email",
        "current_city",
        "hometown",
        "preferred_work_location",
        "preferred_language_1",
        "education",
        "publications",
        "experience",
        "skills",
        "projects",
        "resume_summary",
    ]
    return {key: profile[key] for key in allowed_keys if profile.get(key)}


def cdp_is_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def start_manual_login_browser() -> subprocess.Popen | None:
    if cdp_is_ready():
        print(f"检测到已有可连接的浏览器调试端口：{CDP_URL}")
        return None

    BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        str(CHROME_PATH),
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={BROWSER_PROFILE_DIR}",
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--window-size=1280,900",
        TARGET_URL,
    ]
    process = subprocess.Popen(args)

    deadline = time.time() + 30
    while time.time() < deadline:
        if cdp_is_ready():
            return process
        time.sleep(0.5)

    raise RuntimeError(f"浏览器已启动，但 {CDP_URL} 在 30 秒内不可连接。")


async def main() -> None:
    profile = load_profile(PROFILE_PATH)
    form_profile = build_form_profile(profile)
    start_manual_login_browser()

    print("\n请在打开的浏览器窗口中完成人工登录/验证码。")
    print("确认已经进入网申表单页面后，回到这个命令行窗口按 Enter，脚本才会开始自动填写。")
    input("准备好后按 Enter 继续...")

    task = f"""
当前浏览器窗口应已经由用户完成登录，并停留在这个网申表单或可访问该表单：
{TARGET_URL}

第一步：判断当前是否已经登录并进入网申表单页面。
如果仍停在登录页、验证码、二维码、手机验证或任何反自动化验证页面，
立即停止并告诉我需要继续人工处理，不要尝试点击验证码、绕过验证或重新登录。
只要已经登录且表单页面可见，就直接开始填写，不要因为页面中存在上传/附件区域而停止。

第二步：根据以下个人信息，逐个填写页面上能对应上的字段，
没有对应信息的字段留空，不要编造：
{json.dumps(form_profile, ensure_ascii=False, indent=2)}

重要规则：
1. 一切以以上 JSON 中的当前 profile 信息为准。不要使用记忆、网页旧值、猜测值或示例值覆盖 profile。
2. 禁止向页面填写 x_email、x_phone、x_id_number 等占位符字符串；如果你发现自己只能填写占位符，立即停止。
3. 只有在明确知道字段含义且 profile 中有对应非空值时才填写；如果目标值为空、字段含义不确定、或只是猜测，不要清空该字段，跳过并在最后报告。
4. 不要清空已有字段，除非你已经明确确认该字段对应 profile 中的某个非空值，并会立即写入该值。
5. 每填完一个区域，先看一眼截图确认字段没填错，遇到不确定的下拉选项，
   选语义最接近的一项，如果实在无法判断就跳过并在最后告诉我。
6. 如果遇到验证码、二维码、短信验证、手机验证或反自动化验证页面，立即停止并告诉我。
7. 所有上传/附件/简历/作品集/证件照/文件选择类字段一律跳过，不要上传文件，不要因为看到这些字段而停止；
   只需要在最后汇总告诉我哪些上传字段被跳过。
8. 继续填写其他能对应上的普通字段，包括文本框、日期、单选、多选、下拉框、地区选择等。
9. 所有能填的非上传字段都填完后，只允许点击"预览"或"暂存"类的按钮，
   绝对不要点击最终的"提交"/"确认提交"按钮，最后必须留给我自己人工确认。
"""

    agent = Agent(
        task=task,
        llm=ChatOpenAI(model="gpt-5.5"),
        browser_profile=BrowserProfile(
            cdp_url=CDP_URL,
            keep_alive=True,
            allowed_domains=["https://iflytek.zhiye.com/*"],
        ),
    )

    history = await agent.run(max_steps=60)
    print("---- 执行结果 ----")
    print(history.final_result())
    print("\n浏览器窗口会保持打开，请你人工核对所有字段。确认无误后再手动提交。")


if __name__ == "__main__":
    asyncio.run(main())
