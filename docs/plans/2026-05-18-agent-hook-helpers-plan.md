# Agent Hook Helper Commands Plan

## Summary

Implement safe helper commands that install, inspect, and remove ClankerLog Stop
hooks for Codex and Claude Code. The target user flow is that a user can run one
`clankerlog hooks install <agent>` command, see exactly what filesystem change
will happen, preserve any existing Stop hooks, and get a clear verification path
without hand-editing agent config files.

The installed hook commands must use the published CLI name:

```bash
clankerlog hook codex stop
clankerlog hook claude stop
```

`clankerlog-dev` remains only a local development/testing shim and should not be
written into user hook config by the installer.

## Decisions

- Add a new plural command group, `clankerlog hooks`, for install/status/uninstall
  helpers. Keep the existing singular `clankerlog hook <agent> stop` commands as
  runtime hook handlers.
- Manage only JSON hook surfaces:
  - Codex: `~/.codex/hooks.json`
  - Claude Code: `~/.claude/settings.json`
- Preserve existing Stop hooks and unrelated config keys. Installer writes should
  append or remove only ClankerLog's own hook object.
- Do not write extra marker fields into agent hook objects unless compatibility
  is proven. Identify ClankerLog hooks by exact command and status message, and
  tolerate the marker if it appears in existing configs.
- Default to dry, conservative behavior on malformed files: report validation
  errors and do not write partial fixes.
- The generated hook command should be visible in command output before writes.
- Claude Code install needs a model because Claude Stop hook payloads do not
  include one. Require `clankerlog hooks install claude --model <model>` and
  show a hint for Opus/Sonnet formatting, such as `claude-opus-4.5` or
  `claude-sonnet-4.5`.
- `clankerlog hooks status` should inspect hook config only. It should not run
  an automatic `clankerlog hook <agent> stop --dry-run` simulation.
- Uninstall should preserve existing JSON containers, including now-empty
  `hooks.Stop` arrays or hook groups, unless a later explicit cleanup command is
  added.
- Do not touch Codex `notify` in `~/.codex/config.toml`; hooks and notifications
  are separate integration surfaces.

## Scope

In scope:

- `clankerlog hooks install codex`
- `clankerlog hooks install claude --model <model>`
- `clankerlog hooks status codex|claude`
- `clankerlog hooks uninstall codex|claude`
- `--dry-run` support for install and uninstall.
- Test-only config path override so tests never write real home directories.
- JSON validation, idempotence, atomic writes, and safe directory creation.
- Tests proving existing Stop hooks are preserved.
- README and integration doc updates that use `clankerlog`, not `clankerlog-dev`,
  for user-facing install instructions.

Out of scope:

- Editing `~/.codex/config.toml` or Codex `notify`.
- Reading transcripts, prompts, source, diffs, terminal output, or secrets.
- Agent hook approval automation, such as driving Codex `/hooks`.
- Project-local hook discovery beyond the documented global config files.
- Supporting JSONC unless current agent docs require it.
- Installing dev shim commands into user config.

## Current State

- `clankerlog hook codex stop` and `clankerlog hook claude stop` already handle
  Stop hook stdin payloads.
- README documents manual Codex and Claude hook JSON examples using the published
  `clankerlog` command.
- `docs/integrations.md` records the manual install runbook and automation notes.
- There is no installer/status/uninstaller yet.
- Current tests cover runtime hook payload handling, quiet failures, dry-runs,
  and Commander wiring for `hook codex stop` and `hook claude stop`.

## Behavior To Preserve

- Existing Stop hook entries must remain in order and remain byte-for-byte
  equivalent after JSON parse/stringify, aside from normal formatting if a write
  is required.
- Non-Stop hooks and unrelated top-level settings must be preserved.
- Existing Codex notification settings in `~/.codex/config.toml` must not be
  read, modified, or replaced by these commands.
- Re-running install must not duplicate the ClankerLog hook.
- Uninstall must remove only the ClankerLog hook marker/command, leaving other
  hooks untouched.
- Hook runtime commands must stay quiet during real agent runs and keep using
  existing privacy rules.

## Implementation Shape

Add a new module for hook config editing instead of mixing installer behavior
into `src/commands/hook.ts`.

Likely structure:

```txt
src/commands/hooks.ts
src/hook-config.ts
tests/commands/hooks.test.ts
```

`src/commands/hooks.ts` should own Commander wiring and user-facing output.
`src/hook-config.ts` should own agent definitions, config path resolution, JSON
loading, validation, hook object construction, idempotent transforms, and atomic
writes.

Recommended command surface:

```bash
clankerlog hooks install codex [--dry-run]
clankerlog hooks install claude --model claude-sonnet-4.5 [--dry-run]
clankerlog hooks status codex
clankerlog hooks status claude
clankerlog hooks uninstall codex [--dry-run]
clankerlog hooks uninstall claude [--dry-run]
```

Recommended installed hook objects:

```json
{
  "type": "command",
  "command": "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
  "timeout": 10,
  "statusMessage": "Sending ClankerLog clank"
}
```

```json
{
  "type": "command",
  "command": "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
  "timeout": 10,
  "statusMessage": "Sending ClankerLog clank"
}
```

Marker compatibility finding: compatibility for extra hook object fields was not
proven during this implementation, so new installs omit the marker and identify
installed hooks by exact command plus `statusMessage`.

## Cross-Slice Rules

- Every user-facing hook command example in docs should use `clankerlog`.
- Keep test fixtures under temp directories and pass config file paths through
  hidden or injectable options.
- Use structured JSON parsing and schema checks, not string replacement.
- Any write path must have a matching `--dry-run` path that prints the target
  file and planned action without writing.
- Never overwrite a malformed config file. Show the parse/validation issue and
  tell the user which file needs manual repair.

## Testing Plan

Per-slice verification should use focused Vitest files:

```bash
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
```

Final verification:

```bash
pnpm check
pnpm test
pnpm build
```

Test fixture coverage should include:

- Missing Codex hook file creates `hooks.Stop` with one ClankerLog entry.
- Missing Claude settings file creates `hooks.Stop` with one ClankerLog entry.
- Existing Stop hooks are preserved when installing Codex.
- Existing Stop hooks are preserved when installing Claude.
- Existing non-Stop hooks and unrelated settings are preserved.
- Install is idempotent and does not duplicate the ClankerLog hook.
- Uninstall removes only the marked ClankerLog hook.
- Uninstall no-ops cleanly when ClankerLog is not installed.
- Malformed JSON refuses to write and prints a clear error.
- Unexpected `hooks.Stop` shape refuses to write instead of clobbering.
- `--dry-run` reports planned changes and leaves files absent/unchanged.
- Claude install requires `--model` and includes `CLANKERLOG_MODEL`.
- Codex install uses the Codex payload model and does not embed
  `CLANKERLOG_MODEL`.

## Files to Add

- `src/commands/hooks.ts`
- `src/hook-config.ts`
- `tests/commands/hooks.test.ts`
- `docs/plans/2026-05-18-agent-hook-helpers-plan.md`

## Files to Change

- `src/cli.ts`
- `README.md`
- `docs/integrations.md`
- Potentially `src/output.ts` if shared status/dry-run formatting needs a helper.

## Slice 1: Hook Config Transform Foundation

Status: `[x]` Done

Goal: Add pure config transform helpers for Codex and Claude hook files.

Why here: Safe installers depend on deterministic read/transform/write behavior.
This slice can prove preservation and idempotence without Commander complexity.

This slice should implement:

- Agent definitions for Codex and Claude config file locations, Stop hook path,
  default timeout, status message, and installed command builder.
- Zod or narrow TypeScript validation for the hook config shape:
  top-level object, optional `hooks` object, optional `hooks.Stop` array, hook
  groups with a `hooks` array.
- Pure transforms:
  - `planInstallHook(config, agent, options)`
  - `planUninstallHook(config, agent)`
  - `getHookStatus(config, agent)`
- Idempotence detection for the ClankerLog hook.
- Preservation of existing Stop hook groups and commands.
- Focused unit tests for missing config, existing Stop hooks, non-Stop hooks,
  duplicate prevention, and removal.

Expected output:

- A pure helper module can take JSON-like input and return changed JSON-like
  output plus a human-readable action summary.
- No filesystem writes or Commander wiring yet.

Verification:

```bash
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
mise run local-ci
```

Dependencies: none.

Completed in this slice:

- Added pure hook config transforms in `src/hook-config.ts`.
- Added focused transform tests in `tests/commands/hooks.test.ts`.
- Verified with `pnpm test -- tests/commands/hooks.test.ts`, `pnpm typecheck`,
  and `mise run local-ci`.

## Slice 2: Filesystem Safety and Dry-Run Planning

Status: `[x]` Done

Goal: Add safe config file read/write helpers around the pure transforms.

Why here: The command layer should be thin; filesystem behavior is the risky
part and deserves its own tests.

This slice should implement:

- Resolve default Codex and Claude config paths from the user's home directory.
- Add test override support for config paths, likely as hidden command options
  or direct function parameters.
- Load missing files as an empty object.
- Reject malformed JSON with a clear `CliError`.
- Reject unsupported hook shapes without modifying files.
- Write JSON atomically through a temporary file and rename when possible.
- Create parent directories with private permissions where practical.
- Implement dry-run planning that returns the target path, action, installed
  command, and whether a write would occur.

Expected output:

- Filesystem helpers can safely install/uninstall in temp directories and report
  no-op/idempotent states.

Verification:

```bash
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
mise run local-ci
```

Dependencies: Slice 1.

Completed in this slice:

- Added config path resolution, JSON loading, malformed/unsupported config
  errors, atomic writes, and dry-run-aware install/uninstall file helpers.
- Added temp-directory tests for missing files, dry-runs, idempotent installs,
  safe uninstalls, malformed JSON, and unsupported shapes.
- Verified with `pnpm test -- tests/commands/hooks.test.ts`, `pnpm typecheck`,
  and `mise run local-ci`.

## Slice 3: `clankerlog hooks install`

Status: `[x]` Done

Goal: Expose safe install commands for Codex and Claude.

Why here: Install is the main user workflow and validates the command surface
before status/uninstall are added.

This slice should implement:

- Register `clankerlog hooks install codex`.
- Register `clankerlog hooks install claude --model <model>`.
- Support `--dry-run`.
- When Claude install is missing `--model`, fail with a concise hint that model
  names should be passed in the same family/version style as
  `claude-sonnet-4.5` or `claude-opus-4.5`.
- Print concise output:
  - target file
  - whether the hook was installed, already installed, or would be installed
  - exact command written into the agent config
  - next manual approval step when relevant, such as Codex `/hooks`
- Use `clankerlog` in generated commands.
- Add Commander integration tests.

Expected output:

- Users can install Codex and Claude Stop hooks without hand-editing JSON.
- Re-running install is safe and non-duplicating.

Verification:

```bash
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
mise run local-ci
```

Dependencies: Slice 2.

Completed in this slice:

- Added the plural `clankerlog hooks install` command group for Codex and
  Claude Code.
- Added dry-run support, Claude model validation with examples, hidden
  test-only config path overrides, and concise install output with exact
  commands.
- Registered the new command group in `src/cli.ts`.
- Verified with `pnpm test -- tests/commands/hooks.test.ts`, `pnpm typecheck`,
  and `mise run local-ci`.

## Slice 4: `clankerlog hooks status` and `uninstall`

Status: `[x]` Done

Goal: Add inspection and cleanup commands that operate only on ClankerLog-owned
hook entries.

Why here: Users need a safe way to verify or reverse the installer before docs
can present this as the preferred path.

This slice should implement:

- Register `clankerlog hooks status codex|claude`.
- Register `clankerlog hooks uninstall codex|claude`.
- Support `--dry-run` on uninstall.
- Status should report:
  - target file
  - installed/not installed
  - whether the installed command matches the expected current command
  - existing malformed/unsupported config state if applicable
- Status should not run an automatic hook dry-run simulation.
- Uninstall should remove only the ClankerLog hook and leave existing empty hook
  arrays/groups in place.
- Tests for safe removal, no-op removal, and preserving neighboring hooks.

Expected output:

- Users can confirm and remove installed hooks without risking unrelated agent
  automation.

Verification:

```bash
pnpm test -- tests/commands/hooks.test.ts
pnpm typecheck
mise run local-ci
```

Dependencies: Slice 3.

Completed in this slice:

- Added `clankerlog hooks status codex|claude` and
  `clankerlog hooks uninstall codex|claude`.
- Added uninstall dry-runs, command-match status output, and tests proving safe
  removal/no-op behavior with neighboring hooks preserved.
- Verified with `pnpm test -- tests/commands/hooks.test.ts`, `pnpm typecheck`,
  and `mise run local-ci`.

## Slice 5: Documentation and Final Verification

Status: `[x]` Done

Goal: Make the helper commands the documented path and keep the manual JSON
examples available as fallback/reference.

Why here: Docs should only change after the commands and safety behavior exist.

This slice should implement:

- Update README Agent Hooks section to lead with:
  - `clankerlog hooks install codex`
  - `clankerlog hooks install claude --model claude-sonnet-4.5`
  - `clankerlog hooks status codex`
  - `clankerlog hooks uninstall codex`
- Keep manual JSON examples in `docs/integrations.md` for troubleshooting.
- Update `docs/integrations.md` automation notes with actual implemented
  behavior, validation errors, and approval instructions.
- Ensure local development notes still reserve `clankerlog-dev` for source-based
  testing only.

Expected output:

- User-facing docs show one-command install with safe status/uninstall flows.
- Manual runbook remains useful for debugging.

Verification:

```bash
pnpm check
pnpm test
pnpm build
mise run local-ci
```

Dependencies: Slice 4.

Completed in this slice:

- Updated README Agent Hooks instructions to lead with helper install, status,
  uninstall, and dry-run commands.
- Updated `docs/integrations.md` with implemented helper behavior, validation
  guarantees, approval instructions, and manual JSON fallback examples that use
  the published `clankerlog` command.
- Verified with direct `pnpm test`, direct underlying check/build commands
  (`oxlint`, `oxfmt --check`, `tsgo --noEmit`, `tsdown`), and
  `mise run local-ci`.

## Open Questions

- None right now. The current plan assumes required Claude `--model`, config-only
  status checks, and preservation of empty hook containers during uninstall.
