# SheetKiller Dynamic Fill Notices

This prototype combines original SheetKiller code with code and design ideas
from the following open-source projects.

## form-pilot

- Repository: https://github.com/rockbenben/form-pilot
- Local research copy: `D:\ToolProjectCode\SheetKiller\external\candidate-03-form-pilot`
- Commit used for this implementation base:
  `2b7f5b0ad2b7b223e8bb47d3829980078a3ef340`
- License: MIT
- Usage: extension project base, scanner, deterministic fillers, storage,
  draft/memory mechanics, tests, and UI structure.

## auto-filler

- Repository: https://github.com/kalinplus/auto-filler
- Local research copy: `D:\ToolProjectCode\SheetKiller\external\candidate-01-auto-filler`
- Commit referenced:
  `907236006c8f2cf5994cec384d532124202c1317`
- License: Apache-2.0
- Usage: design reference for OpenAI-compatible semantic matching, confidence
  output, and enriched field context extraction.

Apache-2.0-derived files or substantial adaptations should retain the original
license notice in the file header when code is copied directly. This initial
implementation re-implements the planner and context extraction in SheetKiller
terms while preserving attribution here.
