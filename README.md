# ClankerLog CLI

Command-line tools for sending privacy-friendly coding-agent activity clanks to ClankerLog.

This package is an early public entrypoint for the future ClankerLog collector.

Core promise:

> No code. No prompts. No secrets. Just clanks.

## Usage

```bash
npm install -g clankerlog
clankerlog
```

The full collector CLI is coming soon.

## Development

This repo uses `mise` for the local toolchain and `pnpm` for package management.

```bash
mise install
pnpm install
mise run local-ci
```

Useful scripts:

```bash
pnpm run build
pnpm run check
pnpm run format
```
