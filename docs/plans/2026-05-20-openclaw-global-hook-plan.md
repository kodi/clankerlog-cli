# OpenClaw Global Hook Integration Plan

## Summary

Add first-class ClankerLog support for OpenClaw by installing a global managed
OpenClaw hook under `~/.openclaw/hooks/clankerlog/`. The hook should listen to
OpenClaw `message:sent` events, filter to successful outbound messages, and send
one privacy-preserving clank without reading prompt, response, transcript, code,
diff, or terminal output.

This is intentionally not another agent JSON config writer. OpenClaw internal
hooks are discovered from hook directories containing `HOOK.md` and
`handler.ts`, then enabled through `openclaw hooks enable <name>`. The CLI should
therefore manage a hook directory and expose install/status/uninstall commands
that fit the existing `clankerlog hooks ...` surface.

## Decisions

- Use OpenClaw's `message:sent` event as the first integration point.
- Install the hook globally as a managed hook:

```txt
~/.openclaw/hooks/clankerlog/
├── HOOK.md
└── handler.ts
```

- Treat workspace-local hooks, such as `<workspace>/hooks/clankerlog/`, as out
  of scope for the first implementation.
- Keep the existing `clankerlog hook codex|claude|cursor|hermes stop` runtime
  commands unchanged.
- Add OpenClaw as a separate hook installation type instead of forcing it
  through the current JSON/YAML config transform path.
- The OpenClaw handler should use `clankerlog ping` or a new
  `clankerlog hook openclaw message-sent` command only with explicit metadata.
- Prefer a new runtime command if it meaningfully improves validation and dry-run
  testing; prefer shelling out to `clankerlog ping` if the OpenClaw event context
  does not provide enough stable fields to justify a schema-specific command.
- Do not send `event.context.content`. The fact that a successful outbound
  message happened is enough for a clank.
- Status should inspect the global hook files and, when available, the OpenClaw
  CLI's view of discovered/enabled hooks. It should not send a test clank.
- Uninstall should remove only the ClankerLog-managed global OpenClaw hook
  directory and should refuse to remove files that do not match the expected
  ClankerLog hook markers.

## Scope

In scope:

- `clankerlog hooks install openclaw`
- `clankerlog hooks status openclaw`
- `clankerlog hooks uninstall openclaw`
- `--dry-run` support for install and uninstall.
- A global managed hook directory under `~/.openclaw/hooks/clankerlog/`.
- Generated `HOOK.md` with OpenClaw metadata for `message:sent`.
- Generated `handler.ts` that filters successful `message:sent` events and
  triggers ClankerLog without collecting message content.
- Tests for file generation, idempotence, status, dry-run, and safe uninstall.
- README and `docs/integrations.md` updates.

Out of scope:

- Workspace-local hook installation in every project.
- OpenClaw plugin-pack publishing through `openclaw.hooks` in `package.json`.
- Driving `openclaw hooks enable clankerlog` automatically unless a local
  OpenClaw CLI check proves that is reliable and non-disruptive.
- Reading OpenClaw message content, channel content, transcripts, prompts,
  source code, diffs, terminal output, or secrets.
- Replacing Codex, Claude Code, Cursor, or Hermes hook behavior.

## Current State

- Current hook agents are limited to `codex`, `claude`, `cursor`, and `hermes`.
- Current hook installers edit agent-specific config files:
  - `~/.codex/hooks.json`
  - `~/.claude/settings.json`
  - `~/.cursor/hooks.json`
  - `~/.hermes/config.yaml`
- Runtime hook commands parse agent-provided stdin JSON and call the same
  `handlePing` path as `clankerlog ping`.
- OpenClaw support does not exist in the CLI.
- The OpenClaw documentation describes internal hooks as discovered directories
  with `HOOK.md` and `handler.ts`, including managed hooks in
  `~/.openclaw/hooks/` and event keys such as `message:sent`.

## Behavior To Preserve

- Existing hook commands and configs for Codex, Claude Code, Cursor, and Hermes
  must continue to work.
- `clankerlog-dev` remains a source-backed local development shim and should not
  be written into user-facing installed OpenClaw hook files.
- Hook-triggered clanks should stay non-blocking from the host agent's
  perspective. Failures should not interrupt OpenClaw message delivery.
- Existing privacy boundaries remain: no prompt text, response text, transcript,
  code, diff, terminal output, or secrets.
- Status commands should inspect configuration and file state only. They should
  not simulate or send clanks.

## Implementation Shape

Add OpenClaw-specific hook directory management alongside the existing
config-file helpers. Keep shared command wiring in `src/commands/hooks.ts`, but
avoid overloading `src/hook-config.ts` if the OpenClaw file/directory contract
would make that module awkward.

Likely structure:

```txt
src/openclaw-hook.ts
src/commands/hooks.ts
tests/commands/openclaw-hooks.test.ts
docs/integrations.md
README.md
```

The generated `HOOK.md` should include frontmatter metadata equivalent to:

```yaml
---
name: clankerlog
description: "Send a ClankerLog clank after successful OpenClaw outbound messages"
metadata: { "openclaw": { "events": ["message:sent"], "requires": { "bins": ["clankerlog"] } } }
---
```

The generated `handler.ts` should:

- export a default async handler.
- return unless `event.type === "message"` and `event.action === "sent"`.
- return unless `event.context?.success === true`.
- determine the workspace from a safe source. Candidate order:
  - `event.context.workspaceDir` if OpenClaw provides it in practice.
  - `process.env.CLANKERLOG_WORKSPACE_DIR`.
  - omit workspace and let `clankerlog ping` run from the hook process cwd only
    if OpenClaw reliably starts hooks in the active workspace.
- determine model from `process.env.CLANKERLOG_MODEL` unless OpenClaw provides a
  stable event/context field in practice.
- set agent to `openclaw`.
- spawn the published CLI command, never `clankerlog-dev`.
- avoid passing `event.context.content`.
- swallow or log failures in a way that does not fail the OpenClaw event.

Possible handler command shape:

```bash
clankerlog ping --agent openclaw --model "$CLANKERLOG_MODEL"
```

If workspace cwd is not reliable, use a runtime command that can accept explicit
workspace metadata:

```bash
clankerlog hook openclaw message-sent
```

That command can parse a deliberately minimal JSON payload emitted by the
handler, such as:

```json
{
  "workspaceDir": "/path/to/project",
  "model": "configured-openclaw-model",
  "success": true
}
```

## Cross-Slice Rules

- Do not read or forward OpenClaw message content.
- Do not install project-local hooks unless the user explicitly asks for that in
  a later slice.
- Generated user-facing hook files must use `clankerlog`, not `clankerlog-dev`.
- Install and uninstall must support `--dry-run`.
- Status must not send network requests or clanks.
- Keep OpenClaw implementation separate enough that unsupported OpenClaw behavior
  cannot regress Codex, Claude Code, Cursor, or Hermes.
- Any command that shells out from `handler.ts` must be explicit about
  environment variables and must not depend on shell interpolation if Node spawn
  can do the job directly.

## Testing Plan

Per-slice verification should use focused tests:

```bash
pnpm test -- tests/commands/openclaw-hooks.test.ts
pnpm test -- tests/commands/hooks.test.ts
```

Final verification:

```bash
pnpm check
pnpm test
pnpm build
```

Manual verification, if OpenClaw is installed locally:

```bash
clankerlog hooks install openclaw --dry-run
clankerlog hooks install openclaw
openclaw hooks list
openclaw hooks info clankerlog
openclaw hooks enable clankerlog
clankerlog hooks status openclaw
```

## Files to Add

- `src/openclaw-hook.ts`
- `tests/commands/openclaw-hooks.test.ts`
- `docs/plans/2026-05-20-openclaw-global-hook-plan.md`

## Files to Change

- `src/commands/hooks.ts`
- `src/commands/hook.ts` if a dedicated OpenClaw runtime command is added.
- `src/cli.ts` only if new command registration is needed.
- `README.md`
- `docs/integrations.md`
- `tests/commands/hooks.test.ts` if the shared hook command matrix is expanded.

## Open Questions

- Does OpenClaw `message:sent` include a workspace path in real events? The docs
  list `to`, `content`, `success`, and `channelId`, but not `workspaceDir`.
- Does OpenClaw expose the active model in `message:sent` context or config in a
  way a hook can read without depending on internal APIs?
- Does OpenClaw run managed hook handlers with the active workspace as process
  cwd?
- Should `clankerlog hooks install openclaw` run `openclaw hooks enable
clankerlog`, or should it only write files and print the enable command?
- Should the first implementation require `--model <model>` for OpenClaw, like
  Claude Code, if the event does not expose model?

## Slice 1: OpenClaw Contract Probe

Status: `[ ]` Not started

Goal: Prove the minimum OpenClaw runtime contract needed by the handler before
writing production behavior.

Why here: The docs establish the hook directory shape and `message:sent` event,
but they do not confirm workspace cwd or model availability for this use case.

This slice should implement:

- Create a temporary or development-only OpenClaw hook that logs safe metadata
  keys only.
- Trigger a `message:sent` event in a local OpenClaw session if available.
- Record whether `workspaceDir`, model, process cwd, and `success` are present.
- Update this plan's Working Notes with exact findings.

Expected output:

- A clear decision on whether the handler can use `clankerlog ping` directly or
  needs `clankerlog hook openclaw message-sent`.
- No committed production behavior unless the probe needs a reusable test
  fixture.

Verification:

```bash
openclaw hooks list
openclaw hooks info <probe-hook>
```

Dependencies:

- Local OpenClaw CLI/gateway availability.

## Slice 2: File Generation and Status Helpers

Status: `[ ]` Not started

Goal: Add pure helper logic that plans, writes, inspects, and removes the global
OpenClaw hook directory.

Why here: Safe filesystem transforms should be tested before Commander wiring
and before runtime handler behavior.

This slice should implement:

- Resolve the default target directory to `~/.openclaw/hooks/clankerlog/`.
- Support test-injected home/target directories.
- Generate deterministic `HOOK.md` and `handler.ts` content.
- Detect whether existing files match ClankerLog-managed content.
- Refuse uninstall if the target directory exists but is not ClankerLog-managed.
- Support dry-run plans without writing.

Expected output:

- `src/openclaw-hook.ts` with pure plan/apply/status helpers.
- Focused tests for missing directory, idempotence, drift detection, dry-run,
  and safe uninstall refusal.

Verification:

```bash
pnpm test -- tests/commands/openclaw-hooks.test.ts
```

Dependencies:

- Slice 1 findings for final handler content if the runtime command shape is not
  obvious.

## Slice 3: CLI Command Wiring

Status: `[ ]` Not started

Goal: Expose OpenClaw through the same user-facing command family as the other
agents.

Why here: Once the file helpers are deterministic, Commander wiring can stay
small and mostly concerned with output.

This slice should implement:

- `clankerlog hooks install openclaw [--dry-run]`
- `clankerlog hooks status openclaw`
- `clankerlog hooks uninstall openclaw [--dry-run]`
- Output the target path and the next manual command:

```bash
openclaw hooks enable clankerlog
```

- If a model is required by Slice 1 findings, add
  `clankerlog hooks install openclaw --model <model>` and bake the model into
  safe environment handling in `handler.ts`.

Expected output:

- OpenClaw appears in helper command tests and help output.
- Install/status/uninstall behavior is consistent with existing hook helpers.

Verification:

```bash
pnpm test -- tests/commands/openclaw-hooks.test.ts
pnpm test -- tests/commands/hooks.test.ts
```

Dependencies:

- Slice 2.

## Slice 4: Runtime Handler Path

Status: `[ ]` Not started

Goal: Implement the actual event-to-clank path for successful OpenClaw outbound
messages.

Why here: Runtime behavior should be added after install mechanics are stable
and after the event contract is known.

This slice should implement one of these paths:

- Direct generated `handler.ts` spawning `clankerlog ping --agent openclaw`.
- Or generated `handler.ts` spawning
  `clankerlog hook openclaw message-sent` with a minimal stdin JSON payload.

If adding a runtime command, it should:

- validate only the fields needed for a clank.
- default agent to `openclaw`.
- use model from validated payload or `CLANKERLOG_MODEL`.
- use workspace from validated payload or current cwd.
- stay quiet on success and swallow failures outside `--dry-run`.
- include focused tests similar to existing hook runtime tests.

Expected output:

- A generated handler that never forwards message content.
- Runtime tests proving successful messages clank and unsuccessful messages no-op.

Verification:

```bash
pnpm test -- tests/commands/openclaw-hooks.test.ts
pnpm test -- tests/commands/hook.test.ts
```

Dependencies:

- Slice 1.
- Slice 2.
- Slice 3 if command surface is already wired.

## Slice 5: Docs and Release Notes

Status: `[ ]` Not started

Goal: Document the OpenClaw setup path clearly without implying it is the same
kind of hook as Codex, Claude Code, Cursor, or Hermes.

Why here: Users need to know where `handler.ts` lives and why global managed
hooks are the default.

This slice should implement:

- Add README OpenClaw install/status/uninstall examples.
- Add a `docs/integrations.md` OpenClaw section covering:
  - `~/.openclaw/hooks/clankerlog/HOOK.md`
  - `~/.openclaw/hooks/clankerlog/handler.ts`
  - `message:sent`
  - `openclaw hooks enable clankerlog`
  - privacy boundaries
  - global managed hook vs per-workspace hook directories
- Record manual verification notes if OpenClaw was tested locally.

Expected output:

- User-facing docs explain both the command and the file layout.

Verification:

```bash
pnpm check
```

Dependencies:

- Slices 2-4.

## Slice 6: Manual OpenClaw Verification

Status: `[ ]` Not started

Goal: Validate the installed global hook in a real OpenClaw session.

Why here: File generation and unit tests cannot prove OpenClaw discovers,
enables, and executes the hook correctly.

This slice should implement:

- Install the hook with the source-backed dev shim only in a temporary local test
  setup if needed.
- Confirm `openclaw hooks list` discovers `clankerlog`.
- Enable the hook with `openclaw hooks enable clankerlog`.
- Trigger a successful `message:sent` event.
- Confirm ClankerLog receives a clank for the expected allowed project.
- Confirm no message content is sent.

Expected output:

- Working Notes updated with exact commands and observed results.
- Any docs caveats updated from real behavior.

Verification:

```bash
openclaw hooks list
openclaw hooks info clankerlog
clankerlog hooks status openclaw
```

Dependencies:

- Slices 1-5.
- Local OpenClaw installed and configured.

## Working Notes

- OpenClaw docs reviewed on 2026-05-20:
  https://docs.openclaw.ai/automation/hooks
- The docs say managed hooks live under `~/.openclaw/hooks/`.
- The docs say workspace hooks can live under `<workspace>/hooks/`, but are
  disabled by default until explicitly enabled.
- The docs list `message:sent` context as `to`, `content`, `success`, and
  `channelId`; workspace/model availability remains unverified.

## Next Slice

Start with Slice 1. The core risk is not file generation; it is whether
OpenClaw's `message:sent` event gives enough workspace/model context for a
correct privacy-preserving clank.
