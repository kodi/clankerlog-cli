# ClankerLog CLI V0 Implementation Plan

## Summary

Build the first real implementation of the `clankerlog` CLI from the current placeholder package. V0 should provide minimal but working versions of the documented commands:

```bash
clankerlog login
clankerlog init
clankerlog allow
clankerlog ping
clankerlog ping --dry-run
clankerlog doctor
```

The goal is a publishable TypeScript npm package with a working `clankerlog` bin, conservative privacy defaults, client-side payload validation, readable API errors, and enough tests to let later polish happen safely.

## Decisions

- Keep the package name `clankerlog` and the public bin name `clankerlog`.
- Use TypeScript, ESM, and Node `>=20`, matching the existing package baseline.
- Use `commander` for the CLI command tree and option parsing.
- Use `fetch-safe` for ingestion HTTP calls. Handle network/API results through `Result` or tuple-style `[data, err]` flows and map `HttpError`, `NetworkError`, `ParseError`, and `ValidationError` to readable CLI messages.
- Keep HTTP call sites free of broad `try/catch`; reserve exception handling for filesystem, JSON parsing, and command-boundary safety where Node APIs can still throw.
- Use `zod` for schema-backed validation of config, payloads, and successful ingestion responses.
- Default to production ingestion and allow endpoint overrides through flags, env vars, and saved config.
- Keep manual `ping` as the V0 runtime path. Hook installation, daemon behavior, retries, and background collection are deferred.

## Type Schema Note

Use `zod` for runtime schemas and infer plain TypeScript types from those schemas. `fetch-safe` accepts validators with a `.parse(value)` method, so Zod schemas can also validate successful ingestion responses at the HTTP boundary.

## Scope

In scope:

- TypeScript source structure, build scripts, and executable bin wiring.
- Minimal implementations for all current MVP commands.
- Global config at `~/.config/clankerlog/config.json`.
- Project-local `.clankerlog.json` support.
- Deny-by-default project allow-list behavior.
- Manual clank payload construction and validation.
- Dry-run output that never prints secrets.
- Single-clank POST support against production, dev, or local ingestion endpoints.
- Focused unit and smoke tests for config, validation, command behavior, and ingestion error formatting.
- README updates for the first usable CLI.

Out of scope for V0:

- Batch clank command.
- Local offline queue or retry buffer.
- Hook install/status/uninstall commands.
- Harness-specific Codex or Claude adapters.
- Dashboard browser login flow.
- Background daemon, file watchers, shell history, prompt capture, transcript capture, diff capture, or code-content inspection.
- Rich project root detection beyond a conservative first implementation.

## Current State

- `package.json` is a minimal publishable placeholder for `clankerlog@0.0.1`.
- `bin/clankerlog.js` prints a "coming soon" message.
- `README.md` is a short package placeholder.
- `docs/CLI_ARCHITECTURE.md` defines the command surface, privacy promise, ingestion contract, config shapes, detection rules, and acceptance checklist.
- There is no TypeScript source tree, build setup, or test setup yet.

## Implementation Shape

Recommended source layout:

```txt
src/
  cli.ts
  commands/
    allow.ts
    doctor.ts
    init.ts
    login.ts
    ping.ts
  config.ts
  errors.ts
  ingest.ts
  output.ts
  project.ts
  schemas.ts
  stack.ts
  redact.ts
tests/
  commands/
  config.test.ts
  ingest.test.ts
  project.test.ts
  schemas.test.ts
```

Command flow:

- `src/cli.ts` owns the Commander program, global flags, command registration, and top-level error-to-exit-code behavior.
- Each command module receives parsed options plus an injectable runtime context for tests, such as cwd, env, stdin/stdout, and config path overrides.
- `config.ts` owns global config load/save, default config creation, config file permissions where practical, and schema validation.
- `project.ts` owns V0 project identity. Start with `realpath(process.cwd())` as the allowed project path. Future slices can add git-root or package-root detection after the exact privacy boundary is agreed.
- `schemas.ts` owns runtime schemas for config, project config, clank payloads, and API responses.
- `ingest.ts` owns `fetch-safe` calls. `ping` should depend on this module rather than calling HTTP helpers directly.
- `output.ts` owns human-readable command output so tests can assert stable text without coupling to command internals.

Config precedence:

1. Command flags.
2. Environment variables: `CLANKERLOG_API_KEY`, `CLANKERLOG_INGEST_URL`, `CLANKERLOG_AGENT`, `CLANKERLOG_MODEL`, `CLANKERLOG_STACK`.
3. Project-local `.clankerlog.json`.
4. Global config.
5. Built-in defaults.

Privacy rules that apply everywhere:

- Never read source files, prompts, transcripts, diffs, terminal output, or secret-looking env values.
- Stack detection may look at filenames only.
- `--project` may override the display name for one ping, but must not bypass the allow-list.
- `doctor` must not send a clank unless a future explicit test-send flag is added.
- Dry-run may show the payload and endpoint, but must redact API key context.

## Testing Plan

Per-slice checks should be small and fast. The final V0 gate should be:

```bash
pnpm check
pnpm test
pnpm build
node bin/clankerlog.js --help
npm pack --dry-run
```

Use temporary config directories in tests rather than writing to the real home directory. Mock `globalThis.fetch` for ingestion tests so 202, 400, 401, invalid JSON, and network failure paths are deterministic.

## Files to Add

- `src/**`
- `tests/**`
- `tsconfig.json`
- build config for the selected bundler, likely `tsdown.config.ts` if keeping the same small-package style as nearby ClankerLog tooling
- optional `mise.toml` if this repo should expose local tasks immediately
- `docs/plans/2026-05-17-cli-v0-implementation-plan.md`

## Files to Change

- `package.json`
- `bin/clankerlog.js`
- `README.md`
- `.gitignore`, only if generated build or coverage output needs ignoring

## Slice 1: TypeScript CLI Scaffold

Status: `[ ]` Not started

Goal: Replace the placeholder executable with a TypeScript-powered Commander CLI shell that can show help and register all V0 command names.

Why here: Every later slice needs a stable command boundary, package scripts, and a runnable bin.

This slice should implement:

- Add runtime dependencies for `commander`, `fetch-safe`, and the chosen schema package.
- Add dev dependencies for TypeScript, the build runner, the test runner, and repo-standard check/format tools.
- Add `src/cli.ts` with Commander setup, version, help text, and command registration stubs.
- Update `bin/clankerlog.js` so the published bin runs the built CLI.
- Add scripts for `build`, `check`, `test`, and a dev command that can run the CLI from source.
- Keep each command stub explicit and minimal, returning a "not implemented yet" message only inside this slice.

Expected output:

- `clankerlog --help` lists `login`, `init`, `allow`, `ping`, and `doctor`.
- The package still has one public bin and remains publishable.

Verification:

```bash
pnpm install
pnpm build
node bin/clankerlog.js --help
```

Dependencies: none.

## Slice 2: Schemas, Config, and Privacy Foundation

Status: `[ ]` Not started

Goal: Add the typed config and project model that all commands share.

Why here: `login`, `init`, `allow`, `ping`, and `doctor` all depend on consistent config loading, saving, validation, and redaction.

This slice should implement:

- Global config schema for `apiKey`, `endpoint`, and `allowedProjects`.
- Project-local schema for `.clankerlog.json` with `displayName` and `stack`.
- Clank payload schema matching `docs/CLI_ARCHITECTURE.md`.
- Ingestion success response schemas for `{ ok: true, id: string }` and future-compatible response validation.
- Config path resolution, with test override support.
- Safe config read/write helpers with readable parse and permission errors.
- API key redaction helper.
- Project path normalization with `realpath`.
- Allow-list lookup that fails closed.

Expected output:

- Shared modules can load an absent config as an empty default, save config, parse existing config, and reject malformed config cleanly.
- Tests cover valid config, invalid config, redaction, and denied-by-default project lookup.

Verification:

```bash
pnpm test -- config schemas project
pnpm check
```

Dependencies: Slice 1.

## Slice 3: `login`, `init`, and `allow`

Status: `[ ]` Not started

Goal: Implement the local setup commands that create auth and allow-list state without sending network requests.

Why here: `ping` should not exist as a bypass around local consent. The allow-list and auth setup should be working before send behavior is added.

This slice should implement:

- `clankerlog login`
  - Prompt for an API key with Node readline.
  - Accept `--api-key` for tests and non-interactive local workflows.
  - Save the key to global config.
  - Never print the full key after saving.
- `clankerlog init`
  - Allow the current project path.
  - Prompt for display name, defaulting to the current folder name.
  - Write or update `.clankerlog.json` with `displayName` and optional stack tags when provided.
  - Update global config allow-list.
- `clankerlog allow`
  - Add the current project path to the global allow-list.
  - Accept `--name <name>`.
  - If already allowed, print the existing mapping and exit successfully.
- Tests for all three commands using temp config/project directories.

Expected output:

- A user can configure auth and allow a project without touching the ingestion API.
- Re-running setup commands is idempotent and readable.

Verification:

```bash
pnpm test -- commands/login commands/init commands/allow
pnpm build
```

Dependencies: Slice 2.

## Slice 4: `ping` and `ping --dry-run`

Status: `[ ]` Not started

Goal: Implement the manual clank send path and dry-run preview.

Why here: This is the core collector behavior and depends on the consent/config foundation from earlier slices.

This slice should implement:

- Resolve endpoint, API key, project display name, agent, model, stack, and timestamp from the documented precedence rules.
- Require the current project to be allowed before building or sending a clank.
- Validate payloads client-side before sending.
- Support documented flags:
  - `--agent <name>`
  - `--model <name>`
  - `--project <name>`
  - `--stack <tags>`
  - `--timestamp <iso>`
  - `--endpoint <url>`
  - `--api-key <key>`
  - `--dry-run`
- Implement comma-separated and repeatable stack flags.
- Implement minimal filename-only stack detection as a supplement to explicit stack values.
- Print exact dry-run payload JSON without network access and without showing the full API key.
- Use `fetch-safe` `postJson` in `ingest.ts` for real sends.
- Format 202, 400, 401, JSON parse, validation, timeout, and network failures into clear CLI output.

Expected output:

- `clankerlog ping --dry-run` prints a valid clank payload from an allowed project.
- `clankerlog ping` fails closed from denied project folders.
- `clankerlog ping` can send one clank to production, dev, or local ingestion endpoints.

Verification:

```bash
pnpm test -- commands/ping ingest
pnpm build
```

Manual local check when the backend is available:

```bash
CLANKERLOG_API_KEY=clk_live_local_local-secret node bin/clankerlog.js ping \
  --agent codex \
  --model gpt-5.5 \
  --stack typescript \
  --endpoint http://127.0.0.1:8787/v1/clanks
```

Dependencies: Slices 1, 2, and 3.

## Slice 5: `doctor`, README, and Package Verification

Status: `[ ]` Not started

Goal: Add the support command and bring docs/package checks up to the V0 behavior.

Why here: `doctor` is most useful once config, allow-list, payload resolution, and HTTP assumptions exist.

This slice should implement:

- `clankerlog doctor`
  - Report config parse status.
  - Report whether an API key is configured, redacted only.
  - Report endpoint.
  - List allowed projects with path and display-name mapping.
  - Report whether the current project is allowed or denied.
  - Report project-local config when present.
  - Report whether agent/model can be resolved from flags or env.
  - Optionally support a health check only if the backend has a stable `GET /health` path.
- README usage for install, login, init, allow, ping, dry-run, endpoint override, and privacy promise.
- Package file list review so `npm pack --dry-run` includes only the intended runtime files and docs.
- Final acceptance pass against the architecture checklist items that apply to V0.

Expected output:

- `doctor` gives enough local state to debug setup without sending data.
- README reflects the actual command behavior.
- Package can be packed for npm.

Verification:

```bash
pnpm check
pnpm test
pnpm build
node bin/clankerlog.js --help
node bin/clankerlog.js doctor
npm pack --dry-run
```

Dependencies: Slices 1 through 4.

## Open Questions

- Should V0 project root be exactly `realpath(process.cwd())`, or should it resolve the nearest git/package root?
- Should `clankerlog init` write `.clankerlog.json` by default, or ask before writing it?
- Should `doctor` attempt `GET /health` in V0, and what exact URL should it derive from the configured ingestion endpoint?
- Should this separate public repo adopt `mise` tasks immediately, or keep only `pnpm` scripts until the first implementation lands?

## Working Notes

- `docs/CLI_ARCHITECTURE.md` is the source of truth for V0 command behavior and privacy boundaries.
- `fetch-safe` currently exposes JSON helpers such as `postJson<T>(url, body, opts?)`, returns `Result<T, FetchError>`, supports tuple destructuring, and supports schema validation through `.parse()` validators.
- `fetch-safe@0.2.4` is the current latest npm version observed while drafting this plan.
- Keep follow-up hook work as a later plan after manual `ping` is usable.

## Next Slice

Start with Slice 1: TypeScript CLI Scaffold.
