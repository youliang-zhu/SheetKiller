# Browser-Use Solution

This directory contains the original `browser-use` implementation.

It uses an OpenAI model plus `browser-use` to operate a visible browser through
CDP. The user completes login, CAPTCHA, SMS verification, and final submission
manually.

Run from the project root:

```powershell
cd D:\ToolProjectCode\SheetKiller
.\venv\Scripts\python.exe .\browser-use-solution\fill_form.py
```

The script reads:

```text
D:\ToolProjectCode\SheetKiller\.env
D:\ToolProjectCode\SheetKiller\data\profile.json
```

Runtime browser state is stored under the ignored project browser profile
directory. Do not commit profile data, screenshots, `.env`, or `data\`.

