# SheetKiller MCP Solution

This directory contains the Playwright-based adapter workflow described in
`architecture.md`.

The workflow is:

1. Discover visible form fields in a logged-in browser profile.
2. Generate a draft mapping.
3. Review and edit the mapping in a local UI.
4. Save the confirmed mapping.
5. Execute the confirmed mapping with local Playwright.

All phases use the same persistent browser profile:

```text
D:\ToolProjectCode\SheetKiller\mcp-solution\browser-profile
```

Do not use a temporary browser profile for real application forms.

## Commands

Run commands from the project root:

```powershell
cd D:\ToolProjectCode\SheetKiller
```

### 1. Discover a Form

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\discover.py `
  --site iflytek `
  --url "https://iflytek.zhiye.com/form?fromPage=job&jobAdId=..."
```

The browser opens visibly. Complete login, CAPTCHA, or SMS verification
manually, then press Enter in the terminal.

Outputs:

```text
mcp-solution\mappings\iflytek.discovery.json
mcp-solution\mappings\iflytek.draft.json
```

Discovery is read-only and does not fill sensitive profile values.

### 2. Review the Draft Mapping

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\serve_review_ui.py
```

Open:

```text
http://127.0.0.1:8765
```

Load `iflytek.draft.json`, edit field mappings, mark rows ready or skipped,
then save as:

```text
iflytek.json
```

### 3. Dry Run

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\execute.py `
  --site iflytek `
  --dry-run
```

Dry run locates mapped fields without writing values.

### 4. Execute

```powershell
.\venv\Scripts\python.exe .\mcp-solution\scripts\execute.py --site iflytek
```

The executor reads `data\profile.json` locally, fills only enabled mapped
fields, skips upload fields, and stops before final submission.

Execution reports are written to:

```text
mcp-solution\reports\
```

## Safety Rules

- Never commit `data\profile.json`, `.env`, browser profiles, screenshots, or
  MCP output with personal data.
- The executor refuses to run if the mapping browser profile does not match
  `mcp-solution\browser-profile`.
- `bounds` in discovery output is only for review UI/debug display. Execution
  must use structural selectors, not coordinates.
- Final submit buttons are never clicked by this workflow.
