# Playwright MCP Form-Filling Architecture

## Purpose

This document defines the new form-filling architecture for SheetKiller.

The goal is not to keep expanding a fully autonomous `browser-use` prompt. The target architecture is a **site adapter generator**:

1. Inspect a target application form.
2. Generate a candidate field mapping.
3. Let the user review and correct that mapping in a friendly local UI.
4. Save the result as a site-specific mapping file such as `mappings/iflytek.json`.
5. Run a deterministic local Playwright executor against that mapping.

This preserves partial generality: a new company form requires a new discovery and mapping-review pass, but the discovery, review, strategy library, and executor are reusable.

## Why Change From browser-use

The `browser-use` approach proved useful for initial exploration, but the logs exposed hard limits:

- It repeatedly depends on screenshots and page-state observation.
- Long forms require many model/action rounds.
- Complex pages can trigger `ScreenshotWatchdog` and `DOMWatchdog` timeouts.
- Model output can occasionally fail the strict action JSON schema.
- Sensitive placeholders such as `x_email` can leak into the page when substitution does not match.
- Complex controls such as region cascaders, date widgets, school autocomplete fields, and dynamic dropdowns are unreliable when handled only by a general agent.
- Runtime is too slow for repeatable form filling.

Playwright MCP showed better behavior for structural inspection:

- Accessibility snapshots are fast after browser startup.
- DOM probes can list visible inputs, textareas, labels, placeholders, values, and rough coordinates.
- Non-sensitive controlled writes complete in under one second.

However, MCP tool calls can echo executed JavaScript. Therefore MCP should not directly run code containing raw phone numbers, ID numbers, emails, or other sensitive profile values.

## Core Design

Use a three-layer system:

1. **Discovery Layer**
   - Uses Playwright MCP and/or local Playwright read-only scripts.
   - Extracts field candidates and form structure.
   - Does not fill sensitive data.

2. **Mapping Review Layer**
   - Uses LLM suggestions plus human confirmation.
   - Presents mapping in a local UI instead of requiring direct JSON editing.
   - Saves confirmed mappings to `mcp-solution/mappings/*.json`.

3. **Execution Layer**
   - Local Playwright script only.
   - Reads `data/profile.json` locally.
   - Reads confirmed mapping JSON.
   - Uses deterministic field strategies.
   - Skips upload fields.
   - Never clicks final submit.

This splits responsibilities cleanly:

- MCP understands and inspects the page.
- LLM suggests semantic matches.
- Human confirms or fixes the mapping.
- Local Playwright performs actual data entry.

## Browser Session Policy

Use one browser identity for the whole flow. This is a hard requirement, not
an optimization.

Discovery, mapping review tests, and deterministic execution must reuse the
same authenticated browser state. The user should log in once, and every later
phase should attach to that same state. The preferred model is:

```text
one persistent browser profile
one login state
one source of browser truth
```

Recommended local profile path:

```text
D:\ToolProjectCode\SheetKiller\mcp-solution\browser-profile
```

Recommended output path:

```text
D:\ToolProjectCode\SheetKiller\mcp-solution\output
```

There are two acceptable operating modes:

1. **Shared persistent profile**
   - MCP discovery and local Playwright execution both use the same `user_data_dir`.
   - Do not run two browser processes against the same profile at the same time.

2. **Shared CDP browser**
   - A local script launches Chromium with `--remote-debugging-port`.
   - The browser is launched with the same persistent `user_data_dir`.
   - MCP and local Playwright connect to the same CDP endpoint when needed.

The implementation should choose one mode per run and make it explicit. It
must not silently switch profiles.

Implementation invariants:

- `DISCOVERY_USER_DATA_DIR` and `EXECUTION_USER_DATA_DIR` must resolve to the
  same absolute path.
- Discovery must fail fast if it detects that it is using a temporary or
  default browser profile for a real target form.
- Execution must fail fast if its configured `user_data_dir` differs from the
  discovery metadata stored in the mapping.
- The mapping file should record the profile identity used during discovery:

```json
{
  "browser_session": {
    "mode": "shared_persistent_profile",
    "user_data_dir": "D:\\ToolProjectCode\\SheetKiller\\mcp-solution\\browser-profile"
  }
}
```

This prevents the practical failure mode where MCP discovery succeeds in one
logged-in browser, but the local executor starts a new browser and asks the
user to scan a QR code again.

## Directory Layout

```text
mcp-solution/
  architecture.md
  probes/
    *.md                  # Non-sensitive experiment notes
    *.js                  # Non-sensitive MCP/local probe snippets
  mappings/
    *.discovery.json      # Raw or normalized field inventory
    *.draft.json          # LLM-generated draft mapping
    *.json                # Human-confirmed site mapping
  scripts/
    discover.py           # Local discovery runner
    execute.py            # Local deterministic executor
    serve_review_ui.py    # Local review UI backend
  reports/
    *.json                # Execution reports
    *.md                  # Human-readable test summaries
  ui/
    ...                   # Optional local review frontend
```

Sensitive files such as `.env`, resumes, profile data, browser profiles, and screenshots with personal data should remain ignored.

## Workflow

### Phase 1: Manual Login

The user opens the target application form in the selected browser profile and completes:

- WeChat login.
- CAPTCHA.
- SMS verification.
- Any other anti-bot or identity checks.

Automation must not bypass verification.

### Phase 2: Discovery

Discovery reads the page without writing sensitive values.

It should collect:

- Current URL and title.
- Page sections.
- Visible fields.
- Candidate labels.
- Placeholder text.
- Existing values.
- Required indicators.
- Bounds metadata for review UI display only.
- Control type guesses.
- Upload controls.
- Dropdown/cascader/autocomplete hints.

Output:

```text
mcp-solution/mappings/<site>.discovery.json
```

### Phase 3: Draft Mapping

An LLM may generate an initial mapping from:

- Discovery JSON.
- Profile schema, not necessarily raw sensitive values.
- Known form-filling rules.

The draft should include uncertainty. It should not pretend that every field is known.

Output:

```text
mcp-solution/mappings/<site>.draft.json
```

### Phase 4: Human Review UI

The user reviews and edits the draft mapping in a local UI.

The user should not be forced to edit raw JSON for routine changes.

The UI should support:

- Grouping fields by form section.
- Displaying page field label, placeholder, current value, required status, and control type.
- Showing suggested profile key.
- Showing target value preview, with sensitive values masked.
- Editing strategy, verify rule, and failure behavior.
- Marking fields as skipped.
- Marking upload fields as `skip_upload`.
- Running optional single-field tests.
- Saving the confirmed mapping.

Output:

```text
mcp-solution/mappings/<site>.json
```

### Phase 5: Deterministic Execution

The executor:

- Reads `data/profile.json`.
- Reads confirmed mapping JSON.
- Connects to the logged-in browser/session.
- Fills mapped fields by strategy.
- Verifies each field.
- Skips upload fields.
- Stops before final submit.

Output:

```text
mcp-solution/reports/<site>-<timestamp>.json
```

### Phase 6: Review And Iterate

The user checks the browser manually.

Failures are fed back into the mapping:

- Bad selector.
- Wrong control type.
- Missing candidate.
- Required field skipped.
- Validation failed.

The mapping is updated through the Review UI.

## Review UI Design

The Mapping Review UI is central to the architecture.

It should make mapping confirmation human-friendly. The UI can start simple: a local web page backed by Python FastAPI or a lightweight local HTTP server.

### Main Table

Rows represent page fields.

Recommended columns:

```text
Section | Page Field | Current Value | Required | Control Type | Suggested Profile Key | Strategy | Status
```

Example:

```text
个人信息 | 姓名       | empty | required | text_input      | name                    | text_input       | needs review
个人信息 | 邮箱       | empty | required | text_input      | email                   | text_input       | needs review
求职意向 | 意向工作地点 | empty | optional | cascader_region | preferred_work_location | cascader_region  | needs test
上传简历 | 上传简历    | empty | optional | upload          | none                    | skip_upload      | skipped
教育经历 | 学校名称    | empty | required | autocomplete    | education[0].school     | autocomplete     | needs test
```

### Detail Panel

Clicking a row opens a side panel:

```text
Page label: 意向工作地点
Section: 求职意向
Current page value: empty
Suggested profile key: preferred_work_location
Target preview: 广东省广州市
Control type: cascader_region
Strategy: cascader_region
Verify: display_text_contains 广东省/广州市
On failure: skip_and_report
```

Editable fields:

- Profile key.
- Strategy.
- Verify rule.
- Failure behavior.
- Skip reason.

### Value Preview

Sensitive fields should be masked:

- Phone: `139****8297`
- ID number: show only prefix/suffix.
- Email: optionally mask local part.

### Single-Field Test

For high-risk fields, the UI should support a controlled test:

- Test only this field.
- Do not save or submit.
- Show result: success, failed verification, skipped, or needs manual handling.

This is especially important for cascaders, date controls, autocomplete fields, and dynamic lists.

## JSON Schema Concepts

### Discovery Field

```json
{
  "field_id": "personal.name",
  "section": "个人信息",
  "label": "姓名",
  "placeholder": "请输入",
  "current_value": "",
  "required": true,
  "control_type_guess": "text_input",
  "dom": {
    "tag": "input",
    "type": "text",
    "selector_candidates": [
      "..."
    ]
  },
  "bounds": {
    "x": 548,
    "y": 613,
    "width": 275,
    "height": 32
  }
}
```

`bounds` is debug and review metadata only. It may be used by the Review UI to
draw a highlight box, help the user visually identify a field, or compare two
nearby controls. The execution layer must not use `bounds` for clicking,
selector generation, or fallback behavior.

Execution must target fields through confirmed structural selectors:

- label or accessible name
- stable DOM attributes
- role and nearby text
- normalized section plus field identity
- site-specific strategy code

Coordinate-based execution is allowed only as an explicit manual debug action
inside the Review UI, with user confirmation, and must never run in unattended
execution.

### Mapping Entry

```json
{
  "mapping_id": "personal.name",
  "enabled": true,
  "section": "个人信息",
  "label": "姓名",
  "profile_path": "name",
  "control_type": "text_input",
  "strategy": "text_input",
  "selector": {
    "type": "label_contains",
    "value": "姓名"
  },
  "verify": {
    "type": "input_value_equals_profile",
    "profile_path": "name"
  },
  "on_fail": "skip_and_report"
}
```

### Execution Report Entry

```json
{
  "mapping_id": "personal.name",
  "label": "姓名",
  "status": "filled",
  "sensitive": false,
  "message": "Verified input value."
}
```

## Control Strategy Library

High-risk controls need explicit strategies.

### `text_input`

Use for normal text inputs and textareas.

Steps:

1. Locate field by confirmed selector.
2. Focus input.
3. Set value using native value setter.
4. Dispatch `input`, `change`, and `blur`.
5. Verify DOM value or visible value.

Failure behavior:

- If selector ambiguous, skip.
- If value does not persist, report validation failure.

### `select_by_text`

Use for dropdowns where options are visible after clicking a trigger.

Steps:

1. Click trigger.
2. Wait for popup/listbox/menu.
3. Locate option by exact text first.
4. Fall back to normalized text match only if configured.
5. Click option.
6. Verify trigger display text.

Failure behavior:

- If no exact option, skip and report candidates.

### `cascader_region`

Use for province/city/region controls.

Input value should be structured:

```json
["广东省", "广州市"]
```

Steps:

1. Click cascader trigger.
2. Wait for popup.
3. Try search if the widget provides a search input.
4. If search returns candidates, select exact semantic candidate.
5. If search fails, navigate tree level by level:
   - province
   - city
   - district if required
6. Confirm if the widget has a confirm button.
7. Verify display text contains expected province/city.

Failure behavior:

- Do not loop indefinitely.
- If no candidate after configured attempts, skip and report.

### `date_or_month`

Use for date and month fields.

Steps:

1. Determine accepted format from existing value, placeholder, or widget behavior.
2. Convert profile value to target format:
   - `2025年9月 – 2026年6月`
   - `2025-09`
   - `2025.09`
3. Try direct input only if input is editable.
4. Dispatch events and blur.
5. If widget rejects direct input, use picker controls.
6. Verify visible value.

Failure behavior:

- If format cannot be determined, skip and report.

### `autocomplete`

Use for school names and similar fields.

Steps:

1. Focus input.
2. Type search text.
3. Wait for suggestions.
4. Prefer exact match.
5. Fall back to contains match only if configured.
6. Click suggestion.
7. Verify field display value.

Failure behavior:

- If no suggestion appears, do not force plain text unless mapping explicitly permits it.

### `dynamic_list_add`

Use for repeated sections such as education, project, internship.

Steps:

1. Detect existing item count.
2. Fill first existing empty item if available.
3. Click add button only when another item is needed.
4. Re-discover fields inside the new item.
5. Fill child mappings by item index.

Failure behavior:

- Stop adding after configured max count.

### `skip_upload`

Use for file uploads.

Steps:

1. Detect upload control.
2. Do nothing.
3. Add skipped upload item to report.

Failure behavior:

- If upload is required and blocks preview/save, report manual action needed.

## Mapping Generation Strategy

The LLM should generate a draft mapping, not execute the form.

Inputs:

- Discovery JSON.
- Profile schema or masked profile preview.
- Strategy library.
- Site-specific notes.

Outputs:

- Draft mapping JSON.
- Confidence score per mapping.
- Reason for each uncertain field.

The Review UI is responsible for final human confirmation.

## Generality Tradeoff

This design changes the original goal.

It is not a fully general real-time LLM form-filling agent. It is a reusable workflow for generating and executing site-specific adapters.

Tradeoff:

- Less universal at runtime.
- More stable and faster after mapping confirmation.
- Better privacy control.
- Easier debugging.
- Requires one discovery/review pass per new company or form type.

This is acceptable if the goal is to repeatedly handle real-world forms with better reliability. For a new form, the user runs discovery and reviews a new mapping. That workflow can still be highly automated and human-friendly.

## Testing Plan

### Test 1: Read-Only Inspection

Goal:

- Verify current URL.
- Collect field list.
- Confirm visible modules.

No writes.

### Test 2: Non-Sensitive Write

Goal:

- Write and clear a disposable value in a low-risk field.
- Confirm DOM value and UI update.

No save or submit.

### Test 3: Mapping Draft

Goal:

- Generate candidate mapping from discovery.
- Review confidence and uncertainty.

No browser writes.

### Test 4: Review UI

Goal:

- Edit and save mapping through a local UI.
- Avoid direct JSON editing for normal workflow.

No browser writes unless single-field test is explicitly triggered.

### Test 5: Single-Field Strategy Tests

Goal:

- Test high-risk controls one by one:
  - dropdown
  - date/month
  - region cascader
  - school autocomplete

No submit.

### Test 6: Local Dry Run

Goal:

- Fill confirmed non-upload fields using local Playwright.
- Stop before final submit.
- Produce execution report.

## Current Recommendation

Proceed with MCP-assisted discovery, a Mapping Review UI, and a deterministic local Playwright executor.

Do not make browser-use the primary implementation for this long form. Browser-use remains useful for broad exploratory tasks, but the target system should be an adapter generator plus local executor.
