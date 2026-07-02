# Evaluation: berellevy/job_app_filler

## Repository

```text
https://github.com/berellevy/job_app_filler
```

Local checkout:

```text
D:\ToolProjectCode\SheetKiller\external\job_app_filler
```

The external checkout is ignored by Git.

## What It Is

`job_app_filler` is a Chrome extension for autofilling job application sites.
It is not an LLM agent. It uses site-specific field discovery and field filling
logic for supported applicant tracking systems.

Supported domains in the extension manifest:

```text
https://*.myworkdayjobs.com/*
https://*.myworkdaysite.com/*
https://*.greenhouse.io/*
```

Its current architecture is closest to:

```text
Chrome extension
  -> content script
  -> injected page script
  -> site-specific field classes
  -> local extension storage for answers
```

## Simple Test Performed

Commands were run with npm cache redirected into this project workspace:

```powershell
$env:npm_config_cache='D:\ToolProjectCode\SheetKiller\tmp\npm-cache'
npm install
.\node_modules\.bin\webpack.cmd --config webpack.prod.js --mode production
```

Result:

- Dependencies installed successfully, although the first `npm install` command
  exceeded the tool timeout after writing `node_modules` and `package-lock.json`.
- `npm list --depth=0` resolved all declared dependencies.
- One-shot production webpack build completed successfully.
- Build output was written to `external\job_app_filler\dist`.
- Webpack produced bundle-size warnings only; there were no build errors.

Generated extension assets included:

```text
dist\manifest.json
dist\contentScript.js
dist\inject.js
dist\popup.html
dist\popup.js
```

No real SheetKiller profile data was used for this test.

## Useful Ideas For SheetKiller

### 1. Injected Script For React Forms

The project uses both a content script and an injected page script. This matters
because browser extension content scripts are isolated from the page's own
JavaScript context, while many modern job forms are React-controlled.

The injected script can access page-level React props and call handlers such as
`onChange` and `onBlur`. This is more reliable than only setting DOM values and
dispatching generic events.

This directly applies to SheetKiller's future execution layer.

### 2. Site-Specific Strategy Classes

The project has separate implementations for:

```text
workday/
greenhouse/
greenhouseReact/
```

Each site has field classes such as text input, textarea, dropdown, searchable
dropdown, date, checkbox, and file fields.

This supports the idea that SheetKiller should have a general LLM planner, but
still keep explicit deterministic strategy code for high-risk controls.

### 3. MutationObserver-Based Rediscovery

The extension watches DOM mutations and rediscover fields when new elements
appear. This is useful for job forms where fields appear after selecting an
option, clicking "Add education", or moving between steps.

SheetKiller should use a similar rediscovery loop after major page actions.

### 4. Answer Storage Model

The extension stores answers by a path:

```text
page -> section -> field type -> field name
```

This is similar to our previous mapping idea, but used as a local memory/cache
rather than the only way to run the workflow.

For SheetKiller, saved mappings or successful fill plans should be optional
cache artifacts, not mandatory upfront work.

## Limitations For Our Use Case

- It is not a general job-application filler for arbitrary sites.
- It currently targets Workday and Greenhouse style pages.
- It does not read a resume or CV and infer values with an LLM.
- It relies on a browser extension UX, while SheetKiller is currently a local
  Playwright/Python workspace.
- It saves and reuses user-entered answers, while our preferred direction is to
  generate a first draft directly from `data\cv.md` and `data\profile.json`.

## Fit With Current SheetKiller Direction

This project is not a drop-in replacement for SheetKiller, but it is a strong
reference for the execution layer.

Recommended takeaways:

1. Keep SheetKiller's main direction as dynamic DOM-plus-LLM fill planning.
2. Borrow the idea of site-specific strategy modules for Workday, Greenhouse,
   and other major ATS platforms.
3. Consider using injected JavaScript for React-controlled fields when generic
   Playwright input events do not persist.
4. Add DOM rediscovery after dynamic page changes.
5. Treat mappings and saved answers as optional memory, not the primary user
   workflow.

## Next Step

The next SheetKiller prototype should not directly fork this extension.

Instead, build `dynamic-fill-solution/` and reuse these ideas:

```text
profile/cv parser
  -> Playwright DOM field inventory
  -> LLM one-time fill plan
  -> deterministic strategy executor
  -> verification report
  -> user final review
```

