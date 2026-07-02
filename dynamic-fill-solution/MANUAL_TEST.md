# Manual Site Probe Quick Test

## 1. Prepare

Open PowerShell:

```powershell
cd D:\ToolProjectCode\SheetKiller\dynamic-fill-solution
$env:PLAYWRIGHT_BROWSERS_PATH='D:\ToolProjectCode\SheetKiller\pw-browsers'
```

## 2. Edit Test Plan

Edit:

```text
D:\ToolProjectCode\SheetKiller\dynamic-fill-solution\manual-plan.example.json
```

Example:

```json
[
  { "labelIncludes": "姓名", "value": "测试姓名", "strategy": "text" },
  { "labelIncludes": "籍贯", "value": "湖南省 娄底市", "strategy": "cascader-region" }
]
```

Use fake/non-sensitive values first.

## 3. Start Browser

```powershell
$url = "https://careers.oppo.com/university/oppo/center/resume"
$plan = "D:\ToolProjectCode\SheetKiller\dynamic-fill-solution\manual-plan.example.json"

npm run manual:probe -- --url="$url" --plan="$plan"
```

## 4. Manual Login

In the opened browser, manually finish:

- login
- QR code
- CAPTCHA
- SMS verification

Do not click final submit.

## 5. Scan Fields

In the terminal:

```text
scan
```

Check the generated scan report under:

```text
D:\ToolProjectCode\SheetKiller\dynamic-fill-solution\reports
```

Then adjust `manual-plan.example.json` if needed.

## 6. Fill Test Fields

In the terminal:

```text
fill
```

Review the browser page and the generated fill report.

## 7. Exit

```text
quit
```

## Safety

- Test only non-sensitive fields first.
- Do not test final submit.
- Do not test file upload at this stage.
- Use fake values until the filling behavior is verified.
