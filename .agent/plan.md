# browser-use 本地部署与网申自动填表方案（Windows / Codex 执行版）

## 0. 总体目标与硬性约束

- **平台**：Windows（本机执行，浏览器和代码在同一台机器上，不涉及远程服务器/跨机器 CDP 连接）。
- **模型**：GPT-5.5（通过用户自己的 OpenAI API Key 调用，不使用 Browser Use Cloud 的付费模型）。
- **目录约束**：所有可控的安装位置与项目文件（Python 解释器、虚拟环境、pip 缓存、Playwright 浏览器内核、临时目录、脚本、配置文件）一律放在 **当前项目目录 `D:\ToolProjectCode\SheetKiller` 内**，不再使用额外的项目目录。除非某个 Windows 组件明确不支持自定义路径，否则不允许写入 C 盘。
- **人工介入点只有一个**：用户手动把 OpenAI API Key 填进 `.env` 文件里。除此之外全部自动化执行。
- **执行者**：Codex（在 Windows 本机以命令行/PowerShell 方式执行）。以下每个阶段都写明「命令」「验证方式」「失败时怎么办」，Codex 应逐阶段执行并在每步验证通过后再进入下一步，不要跳步。

---

## 1. 目录规划（先建好，后面所有东西往里装）

```powershell
cd D:\ToolProjectCode\SheetKiller
New-Item -ItemType Directory -Force .\venv          # 虚拟环境，稍后创建
New-Item -ItemType Directory -Force .\pipcache      # pip 缓存
New-Item -ItemType Directory -Force .\pw-browsers   # Playwright 浏览器内核
New-Item -ItemType Directory -Force .\tmp           # 临时文件目录
New-Item -ItemType Directory -Force .\data          # 存放 profile.json 等个人信息文件
New-Item -ItemType Directory -Force .\screenshots   # 调试用截图输出
New-Item -ItemType Directory -Force .\Python312     # Python 解释器安装目录（项目内）
```

> 说明：当前项目根目录固定为 `D:\ToolProjectCode\SheetKiller`。Python 解释器、虚拟环境、缓存、浏览器内核、临时文件和自动化脚本都放在这个目录内，保持项目自包含，方便整体迁移或删除。

---

## 2. 安装 Python（项目目录内）

**前置检查**：先确认当前项目目录内是否已经有 Python。

```powershell
cd D:\ToolProjectCode\SheetKiller
if (Test-Path .\Python312\python.exe) {
    .\Python312\python.exe --version
} else {
    Write-Host "项目内 Python 尚未安装。"
}
```

- 如果 `.\Python312\python.exe` 已存在且版本是 Python 3.11 及以上，可以跳过安装，直接进入第 3 步。
- 如果不存在，或版本低于 3.11，按下面步骤全新装一个到当前项目目录内，不使用系统已有的 Python 作为最终运行环境。

**下载**（去官网找当前稳定版的 Windows amd64 安装包，例如 3.12.x）：

```powershell
# 用官方安装器静默安装到当前项目目录，不装 C 盘，不影响系统默认 python
Start-Process -FilePath ".\python-3.12.x-amd64.exe" -ArgumentList `
  "/quiet InstallAllUsers=0 TargetDir=D:\ToolProjectCode\SheetKiller\Python312 PrependPath=0 Include_launcher=0" `
  -Wait
```

> 关于「除非迫不得已」的说明：Python 安装器本身会在注册表和 `C:\Windows` 下写入极少量的系统级登记信息，这是安装器机制决定的、无法完全避免的部分，但**主体文件（解释器、标准库）都在 `D:\ToolProjectCode\SheetKiller\Python312`**，符合约束的精神。`PrependPath=0` 是特意不把它加进系统 PATH，避免和你电脑上其他 Python 环境冲突，后面全部通过完整路径或激活虚拟环境的方式调用。

**验证**：

```powershell
D:\ToolProjectCode\SheetKiller\Python312\python.exe --version
# 期望输出：Python 3.12.x 或以上
```

失败处理：如果报错找不到文件，检查安装器是否真的执行完成（`/quiet` 模式下没有进度条，用 `echo $LASTEXITCODE` 确认返回码是 0）。

---

## 3. 创建虚拟环境（项目目录内）

```powershell
D:\ToolProjectCode\SheetKiller\Python312\python.exe -m venv D:\ToolProjectCode\SheetKiller\venv
```

**激活**（后续所有 pip/python 命令都要在激活状态下执行）：

```powershell
D:\ToolProjectCode\SheetKiller\venv\Scripts\Activate.ps1
```

**验证**：

```powershell
python --version
where python
# where python 的输出应该指向 D:\ToolProjectCode\SheetKiller\venv\Scripts\python.exe
```

---

## 4. 配置缓存与临时目录环境变量（避免写到 C 盘）

在**当前 PowerShell 会话**里先设置（用于本次执行）：

```powershell
$env:PIP_CACHE_DIR = "D:\ToolProjectCode\SheetKiller\pipcache"
$env:PLAYWRIGHT_BROWSERS_PATH = "D:\ToolProjectCode\SheetKiller\pw-browsers"
$env:TEMP = "D:\ToolProjectCode\SheetKiller\tmp"
$env:TMP = "D:\ToolProjectCode\SheetKiller\tmp"
```

同时用 `setx` 写成**永久环境变量**（下次开新终端也生效，注意 `setx` 设置后需要新开一个终端窗口才会读取到）：

```powershell
setx PIP_CACHE_DIR "D:\ToolProjectCode\SheetKiller\pipcache"
setx PLAYWRIGHT_BROWSERS_PATH "D:\ToolProjectCode\SheetKiller\pw-browsers"
setx TEMP "D:\ToolProjectCode\SheetKiller\tmp"
setx TMP "D:\ToolProjectCode\SheetKiller\tmp"
```

> 这一步必须在安装 pip 包和 Playwright 浏览器**之前**做，因为这些工具是在安装时读取这些环境变量决定下载/缓存位置的，装完了再改环境变量不会让已经下载的东西"搬家"。

---

## 5. 安装 browser-use 及依赖

```powershell
python -m pip install --upgrade pip
pip install browser-use python-dotenv openai
```

**验证**：

```powershell
pip show browser-use
python -c "import browser_use; print(browser_use.__file__)"
# 期望路径以 D:\ToolProjectCode\SheetKiller\venv 开头，确认包装在虚拟环境里而不是全局 site-packages
```

---

## 6. 安装 Playwright 浏览器内核（Chromium）到项目目录内

```powershell
playwright install chromium
```

**验证**：

```powershell
dir D:\ToolProjectCode\SheetKiller\pw-browsers
# 应该能看到类似 chromium-xxxx 的文件夹，说明浏览器内核确实装进了当前项目目录，而不是默认的
# C:\Users\<用户名>\AppData\Local\ms-playwright
```

失败处理：如果这个目录是空的、内核还是跑去了 C 盘的默认路径，说明第 4 步的环境变量没有在这次终端会话里生效——检查是不是开了新终端窗口但没有重新执行 `$env:PLAYWRIGHT_BROWSERS_PATH = ...` 这一行（`setx` 设置的值只在**新开的**终端里自动生效，当前这个终端如果是 `setx` 之前就打开的，要么重开终端，要么用 `$env:` 方式在当前会话手动补一遍）。

---

## 7. 确认 GPT-5.5 在 browser-use 里的调用方式

因为 browser-use 更新较快，不同版本里 `ChatOpenAI` 的导入路径可能不一样，Codex 执行到这一步时应先探测一下当前安装版本实际支持的写法，不要死板照抄下面某一种：

```powershell
python -c "from browser_use import Agent, ChatOpenAI; print('standard import OK')"
```

如果上面这行报错（ImportError），再试：

```powershell
python -c "from browser_use.beta import Agent, ChatOpenAI; print('beta import OK')"
```

哪一种能跑通，第 9 步的脚本里就用哪一种对应的 `import` 写法（下面给出的示例脚本默认写的是标准写法，如果你的环境测出来只有 beta 能用，把脚本里的 import 那一行换成 beta 版本即可，其余代码逻辑不用改）。

---

## 8. 创建 `.env` 文件模板（等待用户手动填 Key）

```powershell
@"
OPENAI_API_KEY=
"@ | Out-File -FilePath "D:\ToolProjectCode\SheetKiller\.env" -Encoding utf8
```

**⏸️ 到这一步暂停，等待用户手动操作**：

> 请手动打开 `D:\ToolProjectCode\SheetKiller\.env` 这个文件，在 `OPENAI_API_KEY=` 后面粘贴你的 OpenAI API Key（不要有多余空格或引号），保存关闭。
> Codex 不应该替用户输入或询问用户把 Key 粘贴到对话里——Key 只应该由用户自己写进这个本地文件。

Codex 检测用户是否已经填好（不读取 Key 内容本身，只检查文件是否非空且格式大致正确）：

```powershell
$envContent = Get-Content "D:\ToolProjectCode\SheetKiller\.env" -Raw
if ($envContent -match "OPENAI_API_KEY=\S+") {
    Write-Host "检测到 API Key 已填写，可以继续。"
} else {
    Write-Host "尚未检测到有效的 API Key，请填写后再继续。"
}
```

---

## 9. 项目文件：个人信息文件 + 填表脚本

在 `D:\ToolProjectCode\SheetKiller\data\profile.json` 里放个人信息（结构示例，需替换成真实内容）：

```json
{
  "name": "张三",
  "gender": "男",
  "birth_date": "1998-01-01",
  "id_number": "在这里填真实身份证号",
  "phone": "在这里填真实手机号",
  "email": "在这里填真实邮箱",
  "hometown": "湖南省娄底市",
  "current_city": "广州市",
  "preferred_work_location": "广东省广州市",
  "preferred_language_1": "Python"
}
```

在 `D:\ToolProjectCode\SheetKiller\fill_form.py` 放执行脚本：

```python
"""
使用 browser-use + GPT-5.5 读取本地个人信息文件，自动填写网申表单。
运行方式：
    (venv 激活状态下) python fill_form.py
"""

import asyncio
import json
import os
from pathlib import Path

from browser_use import Agent, BrowserProfile, ChatOpenAI  # 若第7步测出只有 beta 可用，改成 from browser_use.beta import ...
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(PROJECT_ROOT / "pw-browsers"))
os.environ.setdefault("TEMP", str(PROJECT_ROOT / "tmp"))
os.environ.setdefault("TMP", str(PROJECT_ROOT / "tmp"))
os.environ.setdefault("BROWSER_USE_DISABLE_EXTENSIONS", "1")

load_dotenv(PROJECT_ROOT / ".env")  # 读取同目录下的 .env 里的 OPENAI_API_KEY

# ------------------ 只需要改这两行 ------------------
TARGET_URL = "https://example.com/apply"        # 换成实际的网申表单地址
PROFILE_PATH = PROJECT_ROOT / "data" / "profile.json"  # 你的个人信息文件路径
# -----------------------------------------------------


def load_profile(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


async def main():
    profile = load_profile(PROFILE_PATH)

    sensitive_data = {
        TARGET_URL: {
            "x_id_number": profile.get("id_number", ""),
            "x_phone": profile.get("phone", ""),
            "x_email": profile.get("email", ""),
        }
    }

    public_info = {
        k: v for k, v in profile.items()
        if k not in ("id_number", "phone", "email") and v
    }

    task = f"""
打开这个网申表单：{TARGET_URL}

第一步：如果页面需要微信登录，点击登录按钮弹出二维码后停在那里等待，
不要做任何其他操作。我会用手机扫码完成登录，登录成功、页面跳转后你再继续。

第二步：根据以下个人信息，逐个填写页面上能对应上的字段，
没有对应信息的字段留空，不要编造：
{json.dumps(public_info, ensure_ascii=False, indent=2)}

身份证号请填入占位符 x_id_number，手机号填 x_phone，邮箱填 x_email，
这三个占位符会在填写时被自动替换成真实值。

重要规则：
1. 每填完一个区域，先看一眼截图确认字段没填错，遇到不确定的下拉选项，
   选语义最接近的一项，如果实在无法判断就跳过并在最后告诉我。
2. 如果遇到验证码，或者需要上传文件（比如证件照），停下来告诉我，
   不要自己尝试绕过或猜测上传内容。
3. 所有能填的字段都填完后，只允许点击"预览"或"暂存"类的按钮，
   绝对不要点击最终的"提交"/"确认提交"按钮，最后必须留给我自己人工确认。
"""

    agent = Agent(
        task=task,
        llm=ChatOpenAI(model="gpt-5.5"),
        sensitive_data=sensitive_data,
        browser_profile=BrowserProfile(
            headless=False,   # 打开可见浏览器窗口，方便扫码和全程盯着
            enable_default_extensions=False,
            executable_path=PROJECT_ROOT / "pw-browsers" / "chromium-1228" / "chrome-win64" / "chrome.exe",
            window_size={"width": 1280, "height": 900},
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
            ],
        ),
    )

    history = await agent.run(max_steps=60)
    print("---- 执行结果 ----")
    print(history.final_result())


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 10. 冒烟测试（先别直接跑真实网申，先验证环境能跑通）

在真正指向招聘网站之前，先用一个无需登录的简单任务确认整条链路（Python → browser-use → GPT-5.5 → Chromium）是通的：

```powershell
python -c @"
import asyncio
from browser_use import Agent, ChatOpenAI
from dotenv import load_dotenv
load_dotenv()

async def main():
    agent = Agent(task='打开 https://www.baidu.com 并搜索 test', llm=ChatOpenAI(model='gpt-5.5'))
    await agent.run(max_steps=10)

asyncio.run(main())
"@
```

**验证**：应该会弹出一个 Chromium 窗口，自动打开百度并完成搜索。如果这一步能跑通，说明环境全部就绪，再进入第 11 步跑真实表单。

失败处理：
- 报 API Key 相关错误 → 回到第 8 步确认 `.env` 里 Key 是否填对、有没有多余空格。
- 浏览器窗口没弹出/卡住不动 → 回到第 6 步用 `playwright install chromium --force` 强制重装一次内核。
- 报模型不存在/不支持 → 确认 OpenAI 账号下 `gpt-5.5` 这个模型名是否可用，必要时先用 `gpt-5` 或账号已确认能访问的模型名做冒烟测试排除是不是模型名的问题，再切回 `gpt-5.5`。

---

## 11. 正式运行网申填表

```powershell
cd D:\ToolProjectCode\SheetKiller
python fill_form.py
```

跑起来后：遇到微信登录二维码，手动用手机扫码；表单填完停在"预览"页面后，自己核对一遍身份证号、手机号这些关键信息，确认无误再手动点击最终提交按钮。

---

## 12. 磁盘占用与安全检查清单（收尾自查）

- [ ] `dir D:\ToolProjectCode\SheetKiller` 确认虚拟环境、pip缓存、浏览器内核、项目文件都在这里，`C:\Users\<用户名>\AppData` 下**没有**新增大体积的 `ms-playwright` 或 `pip` 缓存文件夹。
- [ ] `.env` 和 `data\profile.json` 里含有真实敏感信息，**不要**把这两个文件传到任何 Git 仓库或云盘同步文件夹里；如果这个项目文件夹本身在 Git 仓库里，建 `.gitignore` 排除这两个文件。
- [ ] 确认脚本里 `headless=False`，方便你随时盯着屏幕，遇到问题能及时人工介入。
- [ ] 确认脚本任务描述里明确写了"不要点击最终提交按钮"，最后一步始终由人工确认。
