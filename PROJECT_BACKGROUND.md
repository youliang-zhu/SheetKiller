# SheetKiller Project Direction

## Goal

SheetKiller aims to become a general local assistant for automatically filling
online job application forms.

The target is not to automate one specific company form, and not to be tied to
one specific automation library. The target workflow is:

1. The user opens a job application form in a visible local browser.
2. The user completes login, CAPTCHA, SMS verification, file uploads, and any
   identity checks manually.
3. SheetKiller reads local personal information, such as `data/cv.md` and
   `data/profile.json`.
4. SheetKiller inspects the current page structure and visible form fields.
5. An LLM matches page fields to the user's profile information.
6. A deterministic browser automation layer fills fields that can be mapped
   with enough confidence.
7. The tool reports filled, skipped, uncertain, and failed fields.
8. The user manually reviews the form and performs final submission.

The system must never click final submit or confirmation-submit buttons.

## Product Principle

The core product should feel like:

```text
Open a form -> let the assistant fill a first draft -> review and fix manually
```

The user should not need to build a custom adapter before every application.
For repeated or important sites, the system may save learned knowledge, but the
main experience should remain general and form-driven.

## Current Repository Layout

```text
browser-use-solution/   # Original browser-use exploration
mcp-solution/           # Playwright/MCP exploration and deterministic tools
.agent/                 # Project instructions and planning context
data/                   # Local private profile/resume data, ignored by Git
```

Root-level files describe the whole project and shared environment. Individual
automation approaches live in their own directories.

## Attempts So Far

### Browser-Use Agent

The first implementation used `browser-use` with an OpenAI model controlling a
visible browser. It was useful because it could reason about the page and make
progress without a prebuilt mapping.

Observed strengths:

- Good for fast exploration.
- Can interpret page text and make semantic decisions.
- Requires relatively little site-specific code.

Observed limits:

- Slow on long forms because every step can require observation and model
  reasoning.
- Screenshot and DOM watchdog timeouts can interrupt progress.
- Complex widgets such as region cascaders, date controls, autocomplete school
  fields, and dynamic sections are unreliable when left to a general agent.
- Strict action JSON parsing can fail.
- Prompt-only control is not enough for sensitive data and final-submit safety.

The browser-use code is kept in `browser-use-solution/` as a reference and
fallback workflow.

### Playwright/MCP Mapping Workflow

The second implementation explored Playwright MCP and local Playwright scripts.
It introduced discovery, draft mapping, a local review UI, and deterministic
execution.

Observed strengths:

- DOM/accessibility inspection is faster and more structured than screenshot
  loops.
- Deterministic Playwright execution is easier to verify and debug.
- A review UI can make field mappings human-editable.
- Sensitive values can stay local and avoid being sent through MCP tool calls.

Observed limits:

- If every new website requires a manually reviewed mapping file first, the
  workflow becomes too adapter-oriented.
- The mapping workflow is stable for repeated sites, but less natural for
  one-off job applications.
- The highest-risk controls still need strategy code, not just field mapping.

The MCP code is kept in `mcp-solution/` because its discovery, Playwright
execution, profile reuse, reporting, and review UI pieces can still be reused.

## Updated Direction

The preferred direction is a dynamic DOM-plus-LLM filling workflow.

Instead of requiring a user-confirmed mapping before filling, the tool should:

1. Read `data/cv.md` and/or `data/profile.json`.
2. Convert the user's information into a structured internal profile.
3. Inspect the current page through Playwright DOM and accessibility data.
4. Ask an LLM to produce a one-time fill plan:

```json
{
  "field": "visible page field identity",
  "profile_source": "profile path or extracted CV fact",
  "target_value": "value to fill",
  "strategy": "text_input | select_by_text | date_or_month | cascader_region | autocomplete | skip",
  "confidence": 0.0,
  "reason": "why this field matches"
}
```

5. Execute only high-confidence actions with deterministic Playwright
   strategies.
6. Skip low-confidence fields and report them clearly.
7. Stop before final submission.

This keeps the generality of an LLM-driven assistant while avoiding the slow
and fragile behavior of screenshot-by-screenshot browser control.

## Recommended Architecture

The long-term architecture should have these layers:

```text
Profile Layer
  - Parse cv.md and profile.json.
  - Produce structured facts with provenance.

Page Inspection Layer
  - Use Playwright to read DOM, labels, placeholders, roles, sections,
    required markers, current values, and control types.
  - Avoid coordinate-based execution.

LLM Planning Layer
  - Generate a one-time fill plan from profile facts and page fields.
  - Include confidence, reasoning, and skip decisions.
  - Never decide to submit the form.

Execution Layer
  - Use deterministic Playwright strategies.
  - Dispatch proper input/change/blur events.
  - Handle dropdowns, dates, cascaders, autocomplete, and dynamic sections
    through explicit strategy functions.

Verification Layer
  - Check whether values actually persisted in the page.
  - Produce a report of filled, skipped, failed, and uncertain fields.

Human Review Layer
  - Leave the browser open.
  - Let the user inspect and manually fix remaining fields.
```

Mappings should become optional cache artifacts, not the primary user-facing
workflow. If a site is used repeatedly, a successful fill plan can be saved and
reused. For a new one-off site, the assistant should fill a first draft
directly.

## Non-Negotiable Safety Rules

- Keep `.env`, `data/`, browser profiles, generated mappings, screenshots, and
  execution reports out of Git unless explicitly sanitized.
- Do not ask the user to paste API keys or private identity data into chat.
- Do not bypass CAPTCHA, QR login, SMS verification, or other identity checks.
- Do not upload files unless the user explicitly provides a file path and
  confirms the action.
- Do not click final submit or confirmation-submit buttons.
- Always leave the final application review and submission to the user.

## Near-Term Implementation Plan

1. Keep the current `browser-use-solution/` and `mcp-solution/` code separated.
2. Add a new dynamic-fill prototype, likely under a new directory such as
   `dynamic-fill-solution/`.
3. Reuse Playwright browser profile handling and field discovery code from
   `mcp-solution/`.
4. Add a profile extraction layer that reads `data/cv.md` and `data/profile.json`.
5. Add an LLM planner that outputs structured fill actions, not direct browser
   operations.
6. Add deterministic Playwright execution for the generated fill plan.
7. Add a final report and leave the browser open for user review.

This direction keeps the project focused on the real objective: general,
supervised automatic filling of job application forms.

