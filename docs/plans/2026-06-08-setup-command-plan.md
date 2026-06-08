# Setup Command Plan

## Summary

Add `clankerlog setup` as the guided path for users who want ClankerLog wired
into every coding agent already present on their machine. The command should
detect installed/supported agents, install the matching hook or plugin for each
detected agent, print a per-agent summary, include the exact uninstall command
for each installed hook, then exit cleanly.

This plan exists because `clankerlog integrations install <agent>` already has
the low-level installers, but users currently need to know which agents are
supported and run each installer manually.

## Decisions

- Keep `clankerlog integrations install|status|uninstall <agent>` as the
  explicit low-level surface.
- Add `clankerlog setup` as the high-level guided surface.
- Reuse existing integration install logic rather than creating a second hook
  writer.
- Treat `setup` as semi-interactive by default when stdin/stdout are TTYs:
  discover candidates, show what will be installed, ask for missing required
  values, confirm writes, run installers, print summary, exit.
- Add non-interactive flags so setup can be used in scripts:
  `--yes`, `--dry-run`, `--all`, `--include <agents>`, `--exclude <agents>`,
  and `--model <model>` for Claude Code.
- Never install into every supported integration blindly by default. Only install
  for agents that discovery says are present, unless the user explicitly opts
  into all or includes specific agents.
- Default setup presents what will be installed before writing. If the user does
  not want those changes, they can abort at the confirmation prompt.
- In non-interactive mode, skip Claude Code with a clear warning when Claude is
  detected but no model was supplied. Do not fail the whole setup for that case.
- Treat either a known executable on PATH or a known config/plugin directory as
  enough evidence that an agent is installed.
- Discovery executable names are `codex`, `claude`, `cursor`, `hermes`,
  `topchester`, `opencode`, `openclaw`, and `pi`.
- Keep setup focused on hook installation. After setup completes, print a helper
  next step telling the user how to run `clankerlog doctor` to confirm the
  system is operational.

## Scope

In scope:

- `clankerlog setup`
- detection for currently supported integrations:
  `codex`, `claude`, `cursor`, `hermes`, `topchester`, `opencode`, `openclaw`,
  and `pi`
- installing hooks/plugins/extensions for detected agents
- idempotent handling of already-installed ClankerLog hooks
- per-agent summary output covering installed, already installed, skipped, and
  failed entries
- uninstall instructions for every installed or already-installed hook
- `--dry-run` support that performs detection and planning without writes
- `--all` support that installs every supported integration even when an agent
  is not detected
- hidden test overrides for home directory, PATH, and config/plugin paths
- focused tests for discovery, setup command flow, summary output, and failure
  handling
- README and `docs/integrations.md` updates that make `setup` the recommended
  starting point while preserving explicit integration commands

Out of scope:

- changing hook runtime payload behavior
- adding new agents
- driving another agent's UI to approve hooks, such as automating Codex `/hooks`
- replacing or removing existing non-ClankerLog hooks
- requiring users to be logged in before hook installation, unless current
  installer behavior already requires it
- running `doctor`, `ping`, or backend checks during setup
- checking the sibling backend repo beyond manual local verification notes

## Current State

- `src/commands/integrations.ts` registers `integrations list`, `install`,
  `status`, and `uninstall`.
- Config-backed integrations share `src/hook-config.ts`:
  Codex, Claude Code, Cursor, Hermes, and Topchester.
- File/plugin-backed integrations have dedicated modules:
  `src/opencode-hook.ts`, `src/openclaw-hook.ts`, and `src/pi-hook.ts`.
- Existing install handlers write human-readable output directly to
  `CliRuntime.stdout`.
- Claude Code installation requires a model because the Claude Stop payload does
  not provide one.
- Existing tests already cover low-level hook transforms and installer behavior
  in `tests/commands/hooks.test.ts`, `tests/commands/opencode-hooks.test.ts`,
  `tests/commands/openclaw-hooks.test.ts`, and `tests/commands/pi-hooks.test.ts`.

## Behavior To Preserve

- Existing explicit integration commands continue to work exactly as documented.
- Hook commands written into user config continue to use `clankerlog`, not the
  local `clankerlog-dev` shim.
- The local development shim at `~/.local/bin/clankerlog-dev` remains pointed at
  `src/cli.ts`; setup implementation and tests should not change that.
- Existing user hooks and unrelated config keys are preserved.
- Malformed or unsupported config files are not overwritten.
- Re-running setup does not duplicate hooks.
- Hook runtime commands stay quiet and continue to avoid reading message content,
  transcripts, prompts, source code, diffs, terminal output, or secrets.

## Recommended Approach

Build `setup` around a small integration registry that exposes structured
operations for each supported integration:

- display name
- agent key
- discovery signals
- install planner/runner
- status checker
- uninstall command string
- post-install next step
- required setup inputs, currently only Claude Code model

Do not make `setup` call `handleInstall...` functions and parse printed text.
Instead, move the existing install/status/uninstall code toward shared helpers
that return structured plans/results, then let both `integrations` and `setup`
format those results for their own command surfaces.

Recommended discovery signals:

- PATH executable exists, using a local PATH scanner rather than shelling out:
  `codex`, `claude`, `cursor`, `hermes`, `topchester`, `opencode`, `openclaw`,
  and `pi`.
- known home-directory config/plugin directories exist, for users whose agent
  binary is not on PATH
- current ClankerLog hook already installed, so setup can report it even if the
  agent binary is unavailable

Any one of those signals is enough to count the agent as detected. The summary
should still name which signal matched so users can understand why setup
selected the agent.

Discovery should be conservative and explain the signal:

```txt
Detected:
  codex       Codex CLI found at /Users/.../.local/bin/codex
  opencode    config directory exists at ~/.config/opencode

Skipped:
  claude      not detected
  pi          not detected
```

Recommended default interaction:

1. Detect agents.
2. Show detected and skipped agents.
3. Prompt only when needed:
   - ask for Claude model if Claude is detected and `--model` was not provided
   - ask for confirmation before writes unless `--yes` is provided
4. Install each selected integration.
5. Continue after per-agent failures, but exit non-zero if any selected install
   failed.
6. Print a final summary with uninstall commands and next steps.
7. Print a final health-check helper:
   `Next: run clankerlog doctor to confirm ClankerLog is operational.`

Recommended output shape:

```txt
ClankerLog setup

Installed:
  codex       installed Stop hook at ~/.codex/hooks.json
              remove: clankerlog integrations uninstall codex
              next: run /hooks in Codex if command approval is required
  opencode    already installed at ~/.config/opencode/plugins/clankerlog.ts
              remove: clankerlog integrations uninstall opencode

Skipped:
  claude      not detected
  pi          not detected

Failed:
  cursor      ~/.cursor/hooks.json is not valid JSON
```

## Cross-Slice Rules

- Use the `fff` MCP tools for file search operations while working in this repo.
- Keep setup output deterministic enough for tests; prompts can vary only where
  tests explicitly cover them.
- Prefer pure discovery/planning helpers with injected home directory and PATH
  over hard-coded process globals.
- Setup should never install an integration just because it is supported; it
  needs a detection signal or explicit user selection.
- Any write path used by setup must have a matching `--dry-run` path.
- A failure for one selected integration should not hide results for the rest.
- Final setup exit code should be `1` if any selected integration failed, and
  `0` when all selected integrations were installed, already installed, skipped
  by detection, or skipped by user choice.

## Testing Plan

Per-slice verification:

```bash
pnpm test -- tests/commands/setup.test.ts
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
```

Final verification:

```bash
pnpm run check
pnpm test
pnpm run build
```

Important test cases:

- setup command is registered in `buildProgram()`
- no detected agents prints a clear message and exits successfully without
  writes
- PATH detection finds an agent executable
- config-directory detection finds an agent without a PATH executable
- already-installed hooks are included in the summary
- `--dry-run` reports planned changes and writes nothing
- `--yes` installs detected agents without prompting
- interactive setup asks for Claude model when needed
- non-interactive Claude setup without `--model` skips Claude with a clear
  warning and keeps processing other selected agents
- `--all` selects all supported integrations regardless of discovery
- one malformed config produces a failed entry while other agents still install
- `--include codex,opencode` limits setup to those agents
- `--exclude cursor` omits Cursor even when detected
- summary includes uninstall commands for every installed/already-installed
  integration

## Files to Add

- `src/commands/setup.ts`
- `src/setup.ts`
- `tests/commands/setup.test.ts`
- `docs/plans/2026-06-08-setup-command-plan.md`

## Files to Change

- `src/cli.ts`
- `src/commands/integrations.ts`
- `src/agent-hooks/config-agent-hooks.ts`
- `src/agent-hooks/install-shared.ts`
- `src/agent-hooks/opencode.ts`
- `src/agent-hooks/openclaw.ts`
- `src/agent-hooks/pi.ts`
- `src/hook-config.ts`
- `src/opencode-hook.ts`
- `src/openclaw-hook.ts`
- `src/pi-hook.ts`
- `README.md`
- `docs/integrations.md`

## Slice 1: Integration Registry And Structured Results

Status: `[ ]` Not started

Goal: Add a registry layer that describes every supported integration and lets
callers get structured install/status/uninstall results.

Why here: `setup` needs consistent summaries and uninstall instructions across
all integration types. Building that on top of stdout parsing would make the new
command brittle.

This slice should implement:

- integration keys and display names in one registry
- per-integration install/status functions that return structured data
- uninstall command and next-step metadata
- adapters from existing hook config/plugin helpers
- no user-facing behavior change for `integrations` commands

Expected output:

- Existing `clankerlog integrations ...` commands still print the same practical
  information.
- Setup has a stable internal contract to call later.

Verification:

```bash
pnpm test -- tests/commands/hooks.test.ts tests/commands/opencode-hooks.test.ts tests/commands/openclaw-hooks.test.ts tests/commands/pi-hooks.test.ts
pnpm typecheck
```

Dependencies: none.

## Slice 2: Agent Discovery

Status: `[ ]` Not started

Goal: Implement deterministic detection for supported agents with testable
signals and reasons.

Why here: Setup should only install hooks for agents that appear to exist unless
the user explicitly selects agents.

This slice should implement:

- PATH executable detection with injectable PATH and filesystem access
- home-directory/config-directory detection with injectable home directory
- already-installed ClankerLog hook detection
- detection result reasons for output and debugging
- tests for present, absent, and already-installed cases

Expected output:

- A pure setup planning helper can report detected and skipped integrations
  without writing files.

Verification:

```bash
pnpm test -- tests/commands/setup.test.ts
pnpm typecheck
```

Dependencies: Slice 1.

## Slice 3: `clankerlog setup` Command Flow

Status: `[ ]` Not started

Goal: Register and implement the high-level setup command.

Why here: The command flow depends on the registry and discovery contracts from
the first two slices.

This slice should implement:

- `registerSetupCommand(program)` and CLI registration in `src/cli.ts`
- setup options:
  - `--dry-run`
  - `--yes`
  - `--all`
  - `--include <agents>`
  - `--exclude <agents>`
  - `--model <model>`
- TTY-aware semi-interactive confirmation
- Claude model prompt when needed
- non-interactive behavior for required missing inputs based on the final
  decision: skip Claude with a warning when `--model` is missing
- hidden test overrides for home directory and PATH

Expected output:

- `clankerlog setup --dry-run` performs discovery and prints a plan.
- `clankerlog setup --yes` installs detected agents without asking for
  confirmation.
- `clankerlog setup --all --yes --model <model>` installs every supported
  integration regardless of discovery.

Verification:

```bash
pnpm test -- tests/commands/setup.test.ts
pnpm typecheck
```

Dependencies: Slice 2.

## Slice 4: Summary, Failure Handling, And Exit Codes

Status: `[ ]` Not started

Goal: Make setup output complete and operationally useful.

Why here: The setup command is not done until users can see what happened and
how to undo it.

This slice should implement:

- grouped summary sections for installed, already installed, skipped, and failed
- uninstall command line for each installed/already-installed integration
- next-step notes such as Codex `/hooks`, Opencode restart, Pi `/reload`, and
  OpenClaw enable command
- final `clankerlog doctor` helper note
- continue-on-error behavior across selected integrations
- exit code behavior covered by tests

Expected output:

- Setup can partially succeed while still producing a complete report and the
  correct exit code.

Verification:

```bash
pnpm test -- tests/commands/setup.test.ts
pnpm typecheck
```

Dependencies: Slice 3.

## Slice 5: Docs And Final Verification

Status: `[ ]` Not started

Goal: Update user-facing docs and run the final confidence pass.

Why here: `setup` changes the recommended onboarding flow, but explicit
integration commands remain important as manual fallback and uninstall paths.

This slice should implement:

- README setup-first instructions
- `docs/integrations.md` setup section and manual fallback notes
- final verification command log in this plan

Expected output:

- Users see `clankerlog setup` as the primary path and still know how to manage
  individual integrations.

Verification:

```bash
pnpm run check
pnpm test
pnpm run build
```

Dependencies: Slice 4.

## Open Questions

No product questions are currently open.

## Next Slice

Start Slice 1.
