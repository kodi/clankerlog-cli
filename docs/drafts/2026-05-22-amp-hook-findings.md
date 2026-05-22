# Amp Hook Findings

Date: 2026-05-22

## Summary

Amp can probably be wired into ClankerLog, but not through the documented
`amp.hooks` settings surface. The current `amp.hooks` preview is a policy-style
mechanism around tool execution, not a general shell-command hook runner.

The practical integration point is an Amp plugin:

```txt
Amp agent.end plugin event -> managed ClankerLog plugin -> clankerlog ping --agent amp
```

This looks closer to the existing Pi and OpenClaw integrations than to the
Codex/Claude/Cursor/Hermes config-file transforms.

## Sources Checked

- Amp hooks manual:
  <https://ampcode.com/manual?internal#hooks>
- Amp plugins manual:
  <https://ampcode.com/manual?internal#plugins>
- Amp configuration manual:
  <https://ampcode.com/manual?internal#configuration>
- Amp plugin API reference:
  <https://ampcode.com/manual/plugin-api>
- Local Amp CLI:
  `~/.local/bin/amp`
- Local ClankerLog hook code:
  - `src/hook-config.ts`
  - `src/pi-hook.ts`
  - `src/openclaw-hook.ts`
  - `src/agent-hooks/runtime-shared.ts`
  - `docs/integrations.md`

## What Amp Hooks Support Today

The documented `amp.hooks` setting supports these events:

- `tool:pre-execute`
- `tool:post-execute`

The documented actions are:

- `send-user-message`
- `redact-tool-input`

That means `amp.hooks` can block, steer, or redact tool behavior, but it does
not appear to support running an arbitrary command after a completed agent turn.
It also only matches exact `input.contains` strings, not patterns or regular
expressions.

Conclusion: `amp.hooks` is not enough for `clankerlog hooks install amp`.

## What Amp Plugins Support

Amp plugins are TypeScript files loaded from:

- project plugins: `.amp/plugins/*.ts`
- user/system plugins on macOS/Linux: `~/.config/amp/plugins/*.ts`
- Windows user plugins: `%USERPROFILE%\.config\amp\plugins\*.ts`

The plugin API includes lifecycle events:

- `session.start`
- `agent.start`
- `tool.call`
- `tool.result`
- `agent.end`

The relevant event is `agent.end`, which fires after the agent finishes a user
prompt. The current `AgentEndEvent` type includes:

- `thread.id`
- `message`
- `id`
- `status`: `done`, `error`, or `cancelled`
- `messages`: all messages since `agent.start`

The plugin event context includes a Bun shell helper as `ctx.$`, and the plugin
API object also exposes `amp.$`. The manual examples use that shell helper for
local commands.

Conclusion: a plugin can likely run ClankerLog after each completed Amp turn.

## Local Probe Notes

Installed Amp was present:

```bash
command -v amp
# /Users/kodi/.local/bin/amp

amp --version
# 0.0.1777413583-g06c92b (released 2026-04-28T22:01:27.565Z, 23d ago)
```

There was no existing user Amp config directory at the time of the check:

```txt
~/.config/amp
```

was missing.

Running plugin commands without enabling plugins printed:

```txt
Plugins are disabled (PLUGINS=off). Set PLUGINS=all to enable.
```

With plugins enabled, Amp could list plugins:

```bash
PLUGINS=all amp plugins list
```

A throwaway probe plugin under `/private/tmp/amp-clankerlog-probe/.amp/plugins/`
only loaded after including Amp's required experimental acknowledgement comment:

```ts
// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
```

After that, `amp plugins list` reported the probe as active with `agent.end`.
The `amp plugins exec ... agent.end` smoke command exited cleanly but did not
produce the expected side-effect file during the quick probe. That may be a
limitation or mismatch in the `plugins exec` test harness payload, not proof
that live `agent.end` does not work. A real interactive Amp turn is still needed
before calling the integration validated end to end.

## Recommended ClankerLog Shape

Add Amp as a managed plugin-style hook integration:

```bash
clankerlog hooks install amp
clankerlog hooks status amp
clankerlog hooks uninstall amp
```

The installer should write:

```txt
~/.config/amp/plugins/clankerlog.ts
```

The generated plugin should:

- include the required Amp experimental acknowledgement comment
- register an `agent.end` handler
- skip `status !== "done"` unless we intentionally want failed/cancelled turns
- run `clankerlog ping --agent amp`
- run from Amp's active workspace cwd via the plugin shell context if possible
- ignore `event.message` and `event.messages` contents
- swallow ClankerLog failures so Amp is not interrupted
- use `CLANKERLOG_MODEL` if the user has set it
- avoid model auto-detection until Amp exposes a stable model field in the
  plugin event or context

The runtime command can probably be direct `ping`, not a new stdin-parsing
`clankerlog hook amp stop`, because Amp plugin events do not appear to provide a
small stable JSON hook payload like Codex/Hermes. If we want symmetry with other
runtime hook commands, a future `clankerlog hook amp agent-end` could accept a
minimal generated payload:

```json
{
  "cwd": "/path/to/workspace",
  "status": "done",
  "model": "optional-from-env-or-future-amp-api"
}
```

but that extra command is not required for a first implementation.

## Privacy Notes

The Amp plugin event exposes message content via `event.message` and
`event.messages`. The generated ClankerLog plugin should not forward or inspect
that content. It should use the event only as a lifecycle trigger and rely on
the workspace cwd plus optional model environment variables.

This matches the existing ClankerLog rule for other agent hooks: trigger on
agent activity, send minimal identity metadata, and do not collect assistant
messages or transcripts.

## Open Questions

- Does `ctx.$` in an `agent.end` handler run with the active workspace as cwd in
  live interactive Amp sessions?
- Are plugins enabled by default in normal user installs, or is this local
  environment setting `PLUGINS=off` unusual?
- Should the installer print a next step such as:

  ```txt
  Next: run Amp with PLUGINS=all or enable plugins, then run `plugins: reload`
  if Amp is already open.
  ```

- Does Amp expose the active model anywhere stable to plugins? The checked
  `AgentEndEvent` type did not include a model field.
- Should `clankerlog hooks install amp` support `--model <model>` and bake that
  into the generated plugin environment fallback, similar to Claude Code?

## Implementation Notes

This should not be added to `src/hook-config.ts`, because that module assumes a
config-file transform around JSON/YAML hook declarations and currently models
only `codex`, `claude`, `cursor`, and `hermes`.

Follow the Pi/OpenClaw pattern instead:

- create `src/amp-hook.ts`
- create `src/agent-hooks/amp.ts`
- register Amp from `src/commands/hooks.ts`
- add tests similar to `tests/commands/pi-hooks.test.ts`
- document the integration in `README.md` and `docs/integrations.md`

Suggested generated plugin sketch:

```ts
// clankerlog-amp-plugin-v1
// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now
import type { PluginAPI } from "@ampcode/plugin";

export default function clankerlogAmpPlugin(amp: PluginAPI): void {
  amp.on("agent.end", async (event, ctx) => {
    if (event.status !== "done") {
      return;
    }

    try {
      await ctx.$`clankerlog ping --agent amp`;
    } catch {
      // Do not interrupt Amp when ClankerLog is unavailable.
    }
  });
}
```

The first implementation should verify this in a real Amp session before
declaring the integration complete.
