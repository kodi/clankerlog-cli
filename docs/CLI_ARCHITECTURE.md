# ClankerLog CLI Handoff

This note is for building the separate `clankerlog` CLI/collector repo.

The web/API monorepo is `/Users/kodi/data/personal/clankerlog-ai`. The CLI should live outside it, in the separate publishable package repo:

```txt
/Users/kodi/data/personal/clankerlog-cli
```

## Product Context

ClankerLog is a personal, public activity log for coding agents: "Last.fm for AI coding work".

Users install a local collector, claim a public profile on `clankerlog.ai`, and send small privacy-friendly project-level events called clanks. A clank is an atomic activity ping with metadata such as project name, agent name, model name, stack tags, and timestamp.

Privacy promise:

```txt
No code. No prompts. No secrets. Just clanks.
```

The CLI must not collect prompts, transcripts, diffs, code contents, terminal output, environment secrets, or file contents.

## Current Backend State

Development:

```txt
Web:        https://dev.clankerlog.ai
Web API:    https://dev.clankerlog.ai/api/*
Ingestion:  https://ingest.dev.clankerlog.ai/v1/clanks
D1:         clankerlog-dev
Queue:      clankerlog-events-dev
```

Production:

```txt
Web:        https://clankerlog.ai
Web API:    https://clankerlog.ai/api/*
Ingestion:  https://ingest.clankerlog.ai/v1/clanks
D1:         clankerlog
Queue:      clankerlog-events
```

Both D1 databases have migrations through `0003_user_badges.sql`. The rollup workers run every minute and read canonical raw clanks from `clank_events`.

## Ingestion API Contract

Collector auth uses a dashboard-created API key:

```txt
Authorization: Bearer clk_live_<key_id>_<secret>
```

The ingestion API validates `key_id` against the `api_keys` table and verifies the secret hash. The resulting `user_id` comes from that API key record, not from a browser session.

Single clank:

```txt
POST https://ingest.clankerlog.ai/v1/clanks
```

Batch clanks:

```txt
POST https://ingest.clankerlog.ai/v1/clanks/batch
```

Single clank payload:

```json
{
  "type": "clank",
  "timestamp": "2026-05-17T20:22:00Z",
  "project": {
    "display_name": "clankerlog"
  },
  "agent": "codex",
  "model": "gpt-5.5",
  "stack": ["typescript", "hono", "d1"]
}
```

Batch payload:

```json
{
  "clanks": [
    {
      "type": "clank",
      "timestamp": "2026-05-17T20:22:00Z",
      "project": {
        "display_name": "clankerlog"
      },
      "agent": "codex",
      "model": "gpt-5.5",
      "stack": ["typescript"]
    }
  ]
}
```

Validation rules:

- `type` must be exactly `clank`.
- `timestamp` must be an ISO datetime with an offset, such as `2026-05-17T20:22:00Z`.
- `project.display_name` is required, trimmed, max 120 chars.
- `agent` is required, trimmed, max 80 chars.
- `model` is required, trimmed, max 120 chars.
- `stack` defaults to `[]`, max 32 tags.
- Stack tags are lowercase-ish tokens matching `^[a-z0-9][a-z0-9.+-]*$`, max 64 chars each.
- Batch size is 1 to 100 clanks.

Expected responses:

- `202` with `{ "id": "...", "ok": true }` for one clank.
- `202` with `{ "accepted": 3, "ok": true }` for batch.
- `400` with `{ "error": "Invalid clank payload", "issues": [...], "ok": false }` for schema errors.
- `401` text responses for missing or invalid bearer tokens.

## CLI MVP

Package name:

```txt
clankerlog
```

Preferred implementation:

- TypeScript.
- Small dependency footprint.
- Publishable npm package with a `clankerlog` bin.
- Default to production ingestion.
- Allow dev endpoint override.

Core commands:

```bash
clankerlog login
clankerlog init
clankerlog allow
clankerlog ping
clankerlog ping --dry-run
clankerlog doctor
```

Privacy gate:

- All project folders are denied by default.
- The CLI only sends clanks from an allowed project folder.
- A project becomes allowed when the user runs `clankerlog init` or `clankerlog allow` inside that folder.
- Project identity should come from the allow-list/project config, not from silently scanning arbitrary folders.

### `clankerlog login`

Purpose: save the dashboard-created API key in the global config file.

Interactive flow:

```bash
clankerlog login
```

Behavior:

- Ask the user to paste their API key.
- Save it in the global config file.
- Keep file permissions tight where practical.
- Never print the full API key after saving it.

Suggested global config file:

```txt
~/.config/clankerlog/config.json
```

Global config shape:

```json
{
  "apiKey": "clk_live_...",
  "endpoint": "https://ingest.clankerlog.ai/v1/clanks",
  "allowedProjects": [
    {
      "path": "/Users/kodi/data/personal/clankerlog-ai",
      "displayName": "clankerlog-ai"
    }
  ]
}
```

### `clankerlog init`

Purpose: allow the current project and optionally write project-level display defaults.

Typical flow:

```bash
cd /path/to/project
clankerlog init
```

Behavior:

- Add the current project root to the global allow-list.
- Ask for the public display name, defaulting to the folder name.
- Optionally write a project-local override file for display name, stack tags, or future project defaults.
- Do not collect prompts, code, diffs, transcripts, terminal output, secrets, or file contents.

Project-local override file:

```txt
.clankerlog.json
```

Example:

```json
{
  "displayName": "clankerlog-ai",
  "stack": ["typescript", "hono", "d1"]
}
```

### `clankerlog allow`

Purpose: allow the current project without doing a fuller setup flow.

Typical flow:

```bash
cd /path/to/project
clankerlog allow --name clankerlog-ai
```

Behavior:

- Add the current project root to the global allow-list.
- Store the display-name mapping in global config unless a project-local `.clankerlog.json` exists.
- If the project is already allowed, print the existing mapping and exit cleanly.

### `clankerlog ping`

Purpose: send one clank from an allowed project.

If the current project is not allowed, fail closed with a helpful message:

```txt
This project is not allowed to clank yet.
Run `clankerlog init` here to allow it.
```

Minimum manual usage:

```bash
clankerlog ping \
  --agent codex \
  --model gpt-5.5 \
  --stack typescript,hono,d1
```

Dev testing:

```bash
clankerlog ping \
  --agent codex \
  --model gpt-5.5 \
  --stack typescript,hono,d1 \
  --endpoint https://ingest.dev.clankerlog.ai/v1/clanks
```

Flags:

```txt
--agent <name>
--model <name>
--project <name>
--stack <tags>        comma-separated and repeatable
--timestamp <iso>     default current UTC time
--endpoint <url>
--api-key <key>
--dry-run
```

Environment overrides:

```txt
CLANKERLOG_API_KEY
CLANKERLOG_INGEST_URL
CLANKERLOG_AGENT
CLANKERLOG_MODEL
CLANKERLOG_STACK
```

Default endpoint:

```txt
https://ingest.clankerlog.ai/v1/clanks
```

### `clankerlog ping --dry-run`

Print the exact payload that would be sent, with no network request.

Do not print the API key. If auth context needs to be shown, print only a redacted prefix, for example:

```txt
api key: clk_live_81aa...redacted
```

### `clankerlog doctor`

Suggested checks:

- Global config exists and can be parsed.
- API key is configured.
- Endpoint is configured.
- Current project is allowed or clearly reported as denied.
- Allowed projects are listed with path and display-name mapping.
- Project-local override files are listed when present.
- Agent/model can be resolved or are provided.
- Optional: perform `GET /health` against the ingestion host.

Suggested output shape:

```txt
auth: ok
endpoint: https://ingest.clankerlog.ai/v1/clanks

allowed projects:
- /Users/kodi/data/personal/clankerlog-ai -> clankerlog-ai (.clankerlog.json)
- /Users/kodi/data/personal/topchester-agent -> Topchester

current project: allowed as clankerlog-ai
```

Do not send a clank from `doctor` unless the user explicitly passes something like `--send-test`.

## Detection Rules

Initial detection should be conservative and privacy-preserving.

Project:

- First resolve the current project root.
- Require that root to exist in the global allow-list.
- Prefer `.clankerlog.json` `displayName` when present.
- Else use the global allow-list display-name mapping.
- Else use the folder basename only during `init`/`allow` prompts.
- `--project` may override the display name for a manual one-off ping, but it must not bypass the allow-list.

Stack:

- Detect from filenames only, not file contents.
- Safe examples:
  - `package.json` -> `typescript` or `javascript` if supported by CLI heuristics.
  - `pnpm-lock.yaml` -> `pnpm`.
  - `go.mod` -> `go`.
  - `Cargo.toml` -> `rust`.
  - `pyproject.toml` -> `python`.
  - `deno.json` -> `deno`.
  - `wrangler.jsonc` -> `cloudflare`.
- Normalize to valid stack tags.
- Keep detection explainable in `--dry-run`.

Agent/model:

- Prefer explicit flags.
- Then environment variables.
- Later, harness-specific hooks may provide these values.
- If model cannot be safely detected, ask for it or use a clear explicit fallback only for manual testing.

## Harness/Hook Direction

The CLI should support manual `ping` first. After that, add hook/install helpers.

Future commands:

```bash
clankerlog hook install codex
clankerlog hook install claude
clankerlog hook status
clankerlog hook uninstall codex
```

The hook contract is simple: trigger a clank and supply minimal identity metadata.

Do not assume every coding agent exposes model metadata in the same way. Keep explicit flags and env vars as the stable base, then add harness-specific adapters.

## Local Prototype Reference

The web/API repo has a shell prototype:

```txt
scripts/clank-local.sh
```

It already supports:

```txt
--agent
--model
--project
--stack
--timestamp
--url
--api-key
```

It sends the same JSON shape expected by ingestion. Use it as behavior reference, not as the final architecture.

Local backend test URL:

```txt
http://127.0.0.1:8787/v1/clanks
```

Local seeded fake key in the web/API repo:

```txt
clk_live_local_local-secret
```

## Acceptance Checklist

- `clankerlog --help` works.
- `clankerlog login` asks for the API key, writes global config, and redacts key in output.
- `clankerlog init` allows the current project and can write `.clankerlog.json`.
- `clankerlog allow` allows the current project and records its display-name mapping.
- `clankerlog ping --dry-run` prints a valid clank payload only for allowed projects.
- `clankerlog ping` fails closed from denied project folders.
- `clankerlog ping` can send to `https://ingest.dev.clankerlog.ai/v1/clanks`.
- `clankerlog doctor` lists allowed projects and their naming mappings.
- Invalid payloads are caught client-side before sending where reasonable.
- API errors are readable, especially `401` and `400`.
- No prompts, code, diffs, transcripts, terminal output, or secrets are collected.
- The package can run with `npx clankerlog`.
- The package can be packed with `npm pack --dry-run`.

## Open Questions For CLI Session

- Exact config filename and whether to support project-local config in addition to user config.
- Whether `login` should eventually open the dashboard after the pasted-key flow works.
- Whether the allow command should be `clankerlog allow`, `clankerlog init`, or both.
- Whether to add a local queue/retry buffer for offline clanks in MVP or defer it.
- How much stack auto-detection belongs in v0 versus explicit `--stack`.
- First hook target: Codex, Claude Code, or a generic shell command hook.
