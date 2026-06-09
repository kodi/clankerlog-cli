`~/.local/bin/clankerlog-dev` is the local development shim for this repo; keep it pointed at `src/cli.ts` so local testing exercises fresh TypeScript source instead of the built package bin.

API, backend, db and workers are checkedout in a sibling path: `../clankerlog`. Find more info there.

Use the fff MCP tools for all file search operations instead of default tools.

NEVER use pnpm commands directly for test, typecheck, format, or lint; always use
the mise equivalents.

Available mise commands:

- `mise run test`
- `mise run test -- <test-file-or-pattern>`
- `mise run typecheck`
- `mise run format`
- `mise run format-check`
- `mise run lint`
- `mise run lint-fix`
- `mise run check`
- `mise run build`
- `mise run local-ci`
