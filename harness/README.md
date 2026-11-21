# Codex Lean Harness

Small project-local starter to reduce unnecessary context and repeated Codex tool calls. It does not guarantee a particular token reduction, and is not a usage cap.

## Install

From the ROOT OF YOUR OWN repository, merge or copy the included files:
- `AGENTS.md` — Codex project instructions (merge if the repo already has one).
- `.codex/config.toml` — default low reasoning and verbosity (merge if it already exists).
- `bin/codex-lean` — optional Bash launcher with an explicit low/medium override.
- `TASK_TEMPLATE.md` — optional template, NOT auto-loaded as instructions.

Never blindly overwrite an existing `AGENTS.md` or `.codex/config.toml`.

## Run

```bash
# In the project root, with Codex CLI installed:
./bin/codex-lean

# Start interactive CLI with an immediate scoped task:
./bin/codex-lean 'Fix the failing test in backend/tests/test_health.py; run that test only.'

# Medium reasoning for complex debugging/architecture:
./bin/codex-lean --deep 'Investigate the concurrency bug in backend/worker/.'
```

Without the launcher, `codex` reads the project `.codex/config.toml` in trusted projects.
To inspect the settings and usage in an interactive session, enter `/status`. Run `codex --strict-config` to catch unsupported config keys in the installed CLI version.

## Keeping token usage down

1. State the target path, expected outcome, and acceptance test in each task.
2. Prefer focused tasks; avoid `explain the whole repo` and `rewrite everything`.
3. Start a fresh session for unrelated tasks. Use `/compact` if a long session must continue.
4. Don't add large architecture documents to `AGENTS.md` (they are read at session start). Use short pointers to optional docs.
5. Validate changes with targeted tests; broader checks when necessary.

## Notes

- `model_reasoning_effort="low"` can be overridden with the launcher `--deep` mode.
- `model_verbosity="low"` mostly reduces answer verbosity, not every category of billed tokens.
- Project `.codex/config.toml` is ignored when Codex does not trust the repository. CLI `-c` overrides still work.
- No model is forced: the available default remains controlled by your Codex client/account.
- Never disable the sandbox or approval checks just to save tokens.
- This package has been syntax-checked but not executed against a signed-in Codex instance.

Official docs:
- https://learn.chatgpt.com/docs/config-file/config-basic
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
