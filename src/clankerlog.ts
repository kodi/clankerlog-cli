#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log("0.0.1");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`ClankerLog CLI

Usage:
  clankerlog [--help]
  clankerlog [--version]

No code. No prompts. No secrets. Just clanks.

The full collector CLI is coming soon.`);
  process.exit(0);
}

console.log("ClankerLog CLI is coming soon.");
console.log("No code, prompts, diffs, or secrets are collected.");
console.log("Learn more: https://clankerlog.ai");
