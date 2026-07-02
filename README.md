# SheetKiller

SheetKiller is a local Windows workspace for supervised online application
form filling.

The repository now keeps automation approaches separated:

```text
browser-use-solution/   # Original browser-use agent workflow
mcp-solution/           # Playwright/MCP and deterministic Playwright workflow
.agent/                 # Project planning and Codex-agent instructions
data/                   # Local private profile/resume data, ignored by Git
venv/                   # Local Python virtual environment, ignored by Git
Python312/              # Project-local Python runtime, ignored by Git
pw-browsers/            # Project-local Playwright browser binaries, ignored by Git
tmp/                    # Project-local temp files, ignored by Git
```

The root directory is reserved for global project configuration, environment
files, and shared local runtime folders. Sensitive files stay local only.

## Safety Rules

- `.env` is ignored and must stay local.
- `data/` is ignored because it may contain personal profile data and resumes.
- Browser profiles, screenshots, generated mappings, and execution reports are
  ignored when they may contain personal or target-form data.
- Automation must not solve CAPTCHAs, bypass identity checks, or click final
  submit/confirm-submit buttons.
- The user performs final review and final submission manually.

## Local Setup

Run commands from:

```powershell
cd D:\ToolProjectCode\SheetKiller
```

The project uses:

```text
D:\ToolProjectCode\SheetKiller\Python312
D:\ToolProjectCode\SheetKiller\venv
D:\ToolProjectCode\SheetKiller\pipcache
D:\ToolProjectCode\SheetKiller\pw-browsers
D:\ToolProjectCode\SheetKiller\tmp
```

Create a local `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

Create or update local profile data under:

```text
data\profile.json
data\cv.md
```

These files are intentionally ignored by Git.

## Browser-Use Workflow

Use the original autonomous browser-use workflow when you want a model-driven
agent to operate the browser directly.

```powershell
.\venv\Scripts\python.exe .\browser-use-solution\fill_form.py
```

See:

```text
browser-use-solution\README.md
```

## Playwright/MCP Workflow

Use the Playwright/MCP workflow for structural discovery, local review, and
deterministic Playwright execution.

Discovery:

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\discover.py `
  --site iflytek `
  --url "https://example.com/form"
```

Review UI:

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\serve_review_ui.py
```

Execution:

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\execute.py --site iflytek
```

See:

```text
mcp-solution\README.md
mcp-solution\architecture.md
```

