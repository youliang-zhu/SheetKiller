# SheetKiller Codex Agent Instructions

This repository is the control workspace for a Windows local `browser-use` automation project. Before making changes or running setup steps, read the canonical project prompt at `.agent/agent.md` and follow it.

Critical project rules:

- Work on Windows with PowerShell commands.
- Keep all controllable installs, caches, browser binaries, temporary files, and generated project files inside `D:\ToolProjectCode\SheetKiller`.
- Do not put Python, virtual environments, pip cache, Playwright browsers, or generated automation files on `C:\` unless a Windows component absolutely cannot be redirected.
- Never ask the user to paste `OPENAI_API_KEY` into chat. Create or check `.env`; the user enters the key locally.
- Execute the setup step by step. Verify each stage before moving on.
- Use visible browser mode (`headless=False`) for form automation.
- Never click a final submit or confirmation-submit button in a real application form. Stop at preview/draft/final review and leave the final action to the user.
- Treat `.env` and `data/profile.json` as sensitive local-only files and keep them out of git or cloud sync.
