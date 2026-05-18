# ClankerLog CLI

Privacy-friendly command-line clanks for coding-agent activity.

> No code. No prompts. No secrets. Just clanks.

## Install

```bash
npm install -g clankerlog
```

## Setup

Save a dashboard-created API key:

```bash
clankerlog login
```

Non-interactive setup:

```bash
clankerlog login --api-key clk_live_...
```

Allow a project before it can send clanks:

```bash
cd /path/to/project
clankerlog init --name my-project --stack typescript,pnpm
```

Quick allow-list entry:

```bash
clankerlog allow --name my-project
```

## Send A Clank

Preview the exact payload without network access:

```bash
clankerlog ping --dry-run --agent codex --model gpt-5.5 --stack typescript
```

Send one clank:

```bash
clankerlog ping --agent codex --model gpt-5.5 --stack typescript
```

Use a dev or local endpoint:

```bash
clankerlog ping \
  --agent codex \
  --model gpt-5.5 \
  --endpoint https://ingest.dev.clankerlog.ai/v1/clanks
```

Supported environment overrides:

```txt
CLANKERLOG_API_KEY
CLANKERLOG_INGEST_URL
CLANKERLOG_AGENT
CLANKERLOG_MODEL
CLANKERLOG_STACK
```

## Codex Hook

For Codex `Stop` hooks, call the CLI directly:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`clankerlog hook codex stop` reads the Codex hook JSON from stdin, uses `cwd` and `model`, and ignores assistant messages and transcript paths.

For Claude Code `Stop` hooks, call the Claude-specific handler and provide a model
through `CLANKERLOG_MODEL` because Claude's Stop payload does not include one:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='gpt-5.5(low)' clankerlog hook claude stop",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`clankerlog hook claude stop` reads the Claude Code hook JSON from stdin, uses
`cwd`, and ignores assistant messages and transcript paths.

Both hook commands support `--dry-run` for local payload inspection without
sending a clank.

## Doctor

```bash
clankerlog doctor
```

`doctor` reports config status, redacted auth status, endpoint, an authenticated API check when an API key is configured, allowed projects, current project allow-list state, and project-local config. It does not send a clank.

## Privacy

The CLI sends a small event with project display name, agent name, model name, stack tags, and timestamp. It does not read or send source files, prompts, transcripts, diffs, terminal output, secret-looking environment values, or file contents. Stack detection uses filenames only.

Projects are denied by default. Run `clankerlog init` or `clankerlog allow` inside a folder before `clankerlog ping` can send from it.

## Development

This repo uses `mise` for the local toolchain and `pnpm` for package management.

`~/.local/bin/clankerlog-dev` is the local development shim; it runs `src/cli.ts` through this checkout so local testing always uses fresh source instead of the last built `bin/clankerlog.js`.

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
