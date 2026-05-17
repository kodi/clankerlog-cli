import { readdir } from "node:fs/promises";
import { stackSchema } from "./schemas.js";

export function parseStackValues(values: readonly string[] | undefined): string[] {
  const stack = values
    ?.flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return stackSchema.parse(stack ?? []);
}

export async function detectStackFromFilenames(projectPath: string): Promise<string[]> {
  const filenames = new Set(await readdir(projectPath));
  const detected: string[] = [];

  if (filenames.has("package.json")) {
    detected.push("typescript");
  }

  if (filenames.has("pnpm-lock.yaml")) {
    detected.push("pnpm");
  }

  if (filenames.has("go.mod")) {
    detected.push("go");
  }

  if (filenames.has("Cargo.toml")) {
    detected.push("rust");
  }

  if (filenames.has("pyproject.toml")) {
    detected.push("python");
  }

  if (filenames.has("deno.json")) {
    detected.push("deno");
  }

  if (filenames.has("wrangler.jsonc") || filenames.has("wrangler.toml")) {
    detected.push("cloudflare");
  }

  return uniqueStack(detected);
}

export function uniqueStack(values: readonly string[]): string[] {
  return stackSchema.parse([...new Set(values)]);
}
