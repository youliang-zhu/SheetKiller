# SheetKiller

SheetKiller is a local Windows workflow for supervised web form automation. It uses `browser-use`, Playwright Chromium, and an OpenAI model to fill matching fields in an online application form from a local profile file.

The project is designed for human-in-the-loop use: login, CAPTCHA, file uploads, and final submission stay under user control.

## What It Does

- Opens the target application form in a local Chromium browser.
- Lets the user complete login and verification manually.
- Connects to the already-open browser through CDP.
- Fills matching non-file fields from `data/profile.json`.
- Skips upload fields such as resume, portfolio, attachments, and ID photos.
- Stops before final submission so the user can review and submit manually.

## Safety Rules

- `.env` is ignored and must stay local.
- `data/` is ignored because it may contain personal profile data and resumes.
- The script does not solve CAPTCHAs or bypass verification.
- The script does not upload files automatically.
- The script must not click final submit or confirm-submit buttons.

## Local Setup

This repository is intended to run from:

```powershell
D:\ToolProjectCode\SheetKiller
```

The full Windows setup plan is documented in:

```text
.agent/plan.md
```

The current local layout keeps Python, the virtual environment, caches, Playwright browsers, temporary files, and browser profile data inside the project directory.

## Required Local Files

Create a local `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

Create a local `data/profile.json` file. This file is intentionally ignored by Git.

Example structure:

```json
{
  "name": "张三",
  "gender": "男",
  "birth_date": "1998-01-01",
  "id_number": "身份证号",
  "phone": "手机号",
  "email": "邮箱",
  "hometown": "湖南省娄底市",
  "current_city": "广州市",
  "preferred_work_location": "广东省广州市",
  "preferred_language_1": "Python"
}
```

## Usage

Run:

```powershell
D:\ToolProjectCode\SheetKiller\venv\Scripts\python.exe D:\ToolProjectCode\SheetKiller\fill_form.py
```

Workflow:

1. The script opens the target form URL in the project Chromium browser.
2. Complete login, WeChat scan, CAPTCHA, SMS verification, or other checks manually.
3. After the form page is visible, return to the terminal and press Enter.
4. The agent fills matching non-upload fields.
5. Upload fields are skipped and reported.
6. Review all fields manually in the browser.
7. Submit manually only after confirming the result.

## Changing The Target Form

Edit `TARGET_URL` in `fill_form.py`:

```python
TARGET_URL = "https://example.com/form"
```

Then rerun the script.

## Notes

- The browser profile is stored in `browser-profile/` and is ignored by Git.
- If login state expires, complete login again in the browser window opened by the script.
- If the site changes its form structure, update the profile fields or task prompt in `fill_form.py`.

