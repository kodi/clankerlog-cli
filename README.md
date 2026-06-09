# ClankerLog CLI

Privacy-friendly command-line clanks for coding-agent activity.

[clankerlog.ai](https://clankerlog.ai)

> No code. No prompts. No secrets. Just clanks.

## Contents

- [Quick Start](#quick-start)
- [Project Setup](#project-setup)
- [Agent Hooks](#agent-hooks)
- [Useful Options](#useful-options)
- [Doctor](#doctor)
- [Privacy](#privacy)
- [Development](#development)

## Quick Start

This is the easiest path: install the CLI, save your API key, allow one project,
preview the payload, then run setup to connect ClankerLog to the coding agents
already present on your machine.

```bash
npm install -g clankerlog
```

```bash
clankerlog login
```

```bash
cd /path/to/project
clankerlog init
```

Preview the payload without sending it:

```bash
clankerlog ping --dry-run --agent codex --model gpt-5.5
```

Connect detected coding-agent hooks:

```bash
clankerlog setup
```

Setup prints the integrations it detected, asks before writing in an interactive
terminal, installs the matching hooks, and prints the uninstall command for each
installed hook. Then run `/hooks` in Codex if command approval is required. That
is the whole golden path. The CLI infers stack tags from project files when you
do not pass `--stack`, and `clankerlog init` defaults the public project name to
the folder name.

## Project Setup

Projects are denied by default. Run one of these from a project folder before it
can send clanks:

```bash
clankerlog init
```

Use `allow` when you only want to add the current folder to the allow-list and
skip the project-local `.clankerlog.json` setup:

```bash
clankerlog allow
```

To track every project without allowing each folder manually, enable automatic
project tracking once:

```bash
clankerlog allow --all
```

This sets `autoTrackProjects` in the global config. Explicitly allowed projects
still keep their configured display names; every other project uses its
`.clankerlog.json` display name when present, otherwise the folder name.

You can override the public project name when needed. The same `--name` option
also works with `allow`.

```bash
clankerlog init --name my-public-project
```

Add explicit stack tags only if inference is not enough:

```bash
clankerlog init --stack typescript,pnpm
```

## Agent Hooks

For day-to-day use, wire ClankerLog into your coding agent's hook system so
clanks are sent automatically after agent activity. The recommended path is:

```bash
clankerlog setup
```

`setup` detects supported agents from PATH, known config/plugin directories, or
already-installed ClankerLog hooks. Use `--dry-run` to preview, `--yes` for
non-interactive installs, `--all` to install every supported integration, and
`--include` or `--exclude` to narrow the selection.

You can also pick an agent manually and run its installer.

### Codex

Install the Codex Stop hook:

```bash
clankerlog integrations install codex
```

After installing, run `/hooks` in Codex if command approval is required.

### Claude Code

Install the Claude Code SessionStart and Stop hooks:

```bash
clankerlog integrations install claude
```

The SessionStart hook records Claude's current model for the session. You can
still pass `--model claude-sonnet-4.5` to install a Stop-hook fallback for older
or incomplete hook payloads.

### Cursor

Install the Cursor stop hook:

```bash
clankerlog integrations install cursor
```

### Hermes

Install the Hermes shell hook:

```bash
clankerlog integrations install hermes
```

### Topchester

Install the Topchester Stop hook:

```bash
clankerlog integrations install topchester
```

### OpenClaw

Install the global OpenClaw `message:sent` hook:

```bash
clankerlog integrations install openclaw
```

This writes a managed hook directory at `~/.openclaw/hooks/clankerlog/` with
`HOOK.md` and `handler.ts`. The generated handler sends clanks only for
successful outbound messages, calls `clankerlog hook openclaw message-sent`, and
does not read or forward message content. If OpenClaw does not enable the hook
automatically, run:

```bash
openclaw hooks enable clankerlog
```

### Opencode

Install the global Opencode `session.idle` plugin:

```bash
clankerlog integrations install opencode
```

This writes `~/.config/opencode/plugins/clankerlog.ts`. Restart Opencode after
installing so it loads the plugin.

### Pi

Install the Pi `agent_end` extension:

```bash
clankerlog integrations install pi
```

This writes `~/.pi/agent/extensions/clankerlog.ts`. If Pi is already running,
run `/reload` after installing.

### Managing Hooks

Supported agent names are `codex`, `claude`, `cursor`, `hermes`,
`topchester`, `opencode`, `openclaw`, and `pi`.

Preview an install without writing files:

```bash
clankerlog integrations install codex --dry-run
```

Check or remove an installed hook:

```bash
clankerlog integrations list
clankerlog integrations status <agent>
clankerlog integrations uninstall <agent>
```

Hook commands read the agent hook JSON payload from stdin, use the workspace
path from the hook payload, and ignore assistant messages, message content, and
transcript paths. Hook commands support `--dry-run` for local payload
inspection.

See [docs/integrations.md](docs/integrations.md) for the fuller manual install
runbook, local development commands, and integration notes.

## Useful Options

Non-interactive login:

```bash
clankerlog login --api-key clk_live_...
```

Explicit stack tags for a one-off clank:

```bash
clankerlog ping --agent codex --model gpt-5.5 --stack typescript,pnpm
```

Dev or local endpoint:

```bash
clankerlog ping \
  --agent codex \
  --model gpt-5.5 \
  --endpoint https://ingest.dev.clankerlog.ai/v1/clanks
```

Environment overrides:

```txt
CLANKERLOG_API_KEY
CLANKERLOG_INGEST_URL
CLANKERLOG_AGENT
CLANKERLOG_MODEL
CLANKERLOG_STACK
```

Use `CLANKERLOG_AGENT` for generic integrations that call `clankerlog ping`
directly. Agent-specific hooks like `clankerlog hook codex stop` infer their
default agent name.

## Doctor

```bash
clankerlog doctor
```

`doctor` reports config status, redacted auth status, endpoint, an authenticated
API check when an API key is configured, allowed projects, current project
allow-list state, and project-local config. It does not send a clank.

## Privacy

The CLI sends a small event with project display name, agent name, model name,
stack tags, and timestamp. It does not read or send source files, prompts,
transcripts, diffs, terminal output, secret-looking environment values, or file
contents. Stack detection uses filenames only.

Example payload:

```json
{
  "type": "clank",
  "project": {
    "display_name": "my-project"
  },
  "agent": "codex",
  "model": "gpt-5.5",
  "stack": ["typescript", "pnpm"],
  "timestamp": "2026-05-18T15:30:00.000Z"
}
```

Projects are denied by default. Run `clankerlog init` or `clankerlog allow`
inside a folder before `clankerlog ping` can send from it, or run
`clankerlog allow --all` once to enable automatic tracking for every project.

## Development

This repo uses `mise` for the local toolchain and `pnpm` for package management.

`~/.local/bin/clankerlog-dev` is the local development shim; it runs `src/cli.ts`
through this checkout so local testing always uses fresh source instead of the
last built `bin/clankerlog.js`.

```bash
mise install
pnpm install
mise run local-ci
```

Useful scripts:

```bash
pnpm run build
pnpm run check
pnpm run test
pnpm run format
```
