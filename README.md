# ClankerLog CLI

Privacy-friendly command-line clanks for coding-agent activity.

> No code. No prompts. No secrets. Just clanks.

## Quick Start

This is the easiest path: install the CLI, save your API key, allow one project,
then send a test clank.

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

Send one clank:

```bash
clankerlog ping --agent codex --model gpt-5.5
```

That is the whole golden path. The CLI infers stack tags from project files when
you do not pass `--stack`, and `clankerlog init` defaults the public project name
to the folder name.

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

For day-to-day use, wire ClankerLog into your coding agent's stop hook so clanks
are sent automatically after agent turns.

Codex `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
            "timeout": 10,
            "statusMessage": "Sending ClankerLog clank"
          }
        ]
      }
    ]
  }
}
```

Claude Code `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Hook commands read the agent hook JSON from stdin, use the workspace `cwd`, and
ignore assistant messages and transcript paths. Both hook commands support
`--dry-run` for local payload inspection.

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

Projects are denied by default. Run `clankerlog init` or `clankerlog allow`
inside a folder before `clankerlog ping` can send from it.

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
