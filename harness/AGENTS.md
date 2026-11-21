# Efficient coding workflow

Deliver the requested behavior with the smallest correct change and minimal context/tool usage.

## Scope and discovery
- Start from paths, symbols, errors, and acceptance criteria given in the task.
- Search narrowly (`rg --files -g ...`, `rg -n PATTERN path/`); expand scope only if needed.
- Read relevant file ranges, not entire large files. Do not dump the repository tree.
- Avoid inspecting generated output, dependencies, binaries, logs, and lockfiles unless directly relevant.
- Reuse information already learned in this session; avoid repeated unchanged reads.
- Read architecture docs only when necessary for the change.

## Execution
- For straightforward tasks, implement directly. For complex tasks, state a plan in at most 3 bullets.
- Preserve existing architecture, conventions, dependencies, and interfaces.
- Keep diffs focused. Do not do unrelated cleanup or add packages without a clear reason.
- Prefer targeted commands and bounded output. On failure, inspect only relevant diagnostics.
- Never save tokens by silently skipping required correctness or security checks.

## Verification and response
- Run the most relevant tests/lint/build checks; widen validation when the change warrants it.
- Never claim a check passed unless it was run.
- Final response: brief summary, tests and results, any blocker. Usually <= 5 lines.
- Do not produce lengthy explanations, repository tours, or repeated status messages.
