import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stackTagSchema } from "../src/schemas.js";
import {
  detectStackFromEntries,
  stackDetectionRules,
  type StackDetectionRule,
} from "../src/stack-detection.js";
import { detectStackFromFilenames, mergeStack } from "../src/stack.js";

describe("stack detection registry", () => {
  it.each([
    ["Dockerfile", "docker"],
    [".dockerignore", "docker"],
    ["compose.yaml", "docker"],
    ["compose.yml", "docker"],
    ["docker-compose.yaml", "docker"],
    ["docker-compose.yml", "docker"],
    ["Package.swift", "swift"],
    [".swift-version", "swift"],
    [".swiftformat", "swift"],
    [".swiftlint.yml", "swift"],
    [".swiftlint.yaml", "swift"],
    ["package.json", "nodejs"],
    ["tsconfig.json", "typescript"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["pnpm-workspace.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    [".yarnrc", "yarn"],
    [".yarnrc.yml", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["bunfig.toml", "bun"],
    ["deno.json", "deno"],
    ["deno.jsonc", "deno"],
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["setup.py", "python"],
    ["setup.cfg", "python"],
    ["Pipfile", "python"],
    ["poetry.lock", "python"],
    ["uv.lock", "python"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["wrangler.toml", "cloudflare"],
    ["wrangler.json", "cloudflare"],
    ["wrangler.jsonc", "cloudflare"],
  ])("detects exact marker %s as %s", (entryName, tag) => {
    expect(detectStackFromEntries([entryName])).toEqual([tag]);
  });

  it.each([
    ["service.Dockerfile", "docker"],
    ["Dockerfile.production", "docker"],
    ["App.xcodeproj", "xcode"],
    ["App.xcworkspace", "xcode"],
    ["main.tf", "terraform"],
    ["main.tf.json", "terraform"],
    ["tsconfig.build.json", "typescript"],
  ])("detects pattern marker %s as %s", (entryName, tag) => {
    expect(detectStackFromEntries([entryName])).toEqual([tag]);
  });

  it.each([
    "NotDockerfile",
    "Dockerfilebackup",
    "service.Dockerfile.backup",
    "project.xcodeproj.backup",
    "project.xcworkspace.backup",
    "main.tfvars",
    "terraform.tfstate",
    ".terraform",
    "tsconfig.json.backup",
    "tsconfigbuild.json",
  ])("does not detect nearby pattern miss %s", (entryName) => {
    expect(detectStackFromEntries([entryName])).toEqual([]);
  });

  it("does not infer Swift from Xcode markers", () => {
    expect(detectStackFromEntries(["App.xcodeproj", "App.xcworkspace"])).toEqual(["xcode"]);
  });

  it("distinguishes Node.js projects from TypeScript projects", () => {
    expect(detectStackFromEntries(["package.json"])).toEqual(["nodejs"]);
    expect(detectStackFromEntries(["package.json", "tsconfig.json"])).toEqual([
      "nodejs",
      "typescript",
    ]);
  });

  it("keeps registry order independent of entry order and deduplicates rule signals", () => {
    expect(
      detectStackFromEntries([
        "wrangler.toml",
        "Cargo.toml",
        "package.json",
        "wrangler.jsonc",
        "pnpm-lock.yaml",
      ]),
    ).toEqual(["nodejs", "pnpm", "rust", "cloudflare"]);
  });

  it("returns no tags for empty or unknown entries", () => {
    expect(detectStackFromEntries([])).toEqual([]);
    expect(detectStackFromEntries(["README.md", "src"])).toEqual([]);
  });

  it("supports exact, prefix, suffix, combined, and all-of matching", () => {
    const rules: readonly StackDetectionRule[] = [
      { tag: "exact", anyOf: [{ exact: "match.exact" }] },
      { tag: "prefix", anyOf: [{ prefix: "prefix." }] },
      { tag: "suffix", anyOf: [{ suffix: ".suffix" }] },
      { tag: "combined", anyOf: [{ prefix: "config.", suffix: ".json" }] },
      { tag: "grouped", allOf: [{ exact: "one" }, { exact: "two" }] },
    ];

    expect(
      detectStackFromEntries(
        ["match.exact", "prefix.value", "value.suffix", "config.dev.json", "one", "two"],
        rules,
      ),
    ).toEqual(["exact", "prefix", "suffix", "combined", "grouped"]);
    expect(
      detectStackFromEntries(["config.json.backup", "configuration.json", "one"], rules),
    ).toEqual([]);
  });

  it("defines unique, schema-valid tags and a signal for every rule", () => {
    const tags = stackDetectionRules.map((rule) => rule.tag);

    expect(new Set(tags).size).toBe(tags.length);
    expect(() => tags.forEach((tag) => stackTagSchema.parse(tag))).not.toThrow();
    for (const rule of stackDetectionRules) {
      const matchers = rule.anyOf ?? rule.allOf;
      expect(matchers.length).toBeGreaterThan(0);
      for (const matcher of matchers) {
        expect(
          matcher.exact !== undefined ||
            matcher.prefix !== undefined ||
            matcher.suffix !== undefined,
        ).toBe(true);
      }
    }
  });

  it("matches 50,000 entries with the complete registry in under 1,000 ms", () => {
    const entries = Array.from({ length: 50_000 }, (_, index) => `unknown-${index}.txt`);
    entries.push("package.json", "Cargo.toml", "wrangler.toml");
    detectStackFromEntries(entries);

    const startedAt = performance.now();
    const detected = detectStackFromEntries(entries);
    const duration = performance.now() - startedAt;

    expect(detected).toEqual(["nodejs", "rust", "cloudflare"]);
    expect(duration).toBeLessThan(1_000);
  });
});

describe("filesystem stack detection", () => {
  it("reads the project root once regardless of registry size", async () => {
    const readDirectory = vi.fn(async () => ["package.json", "one", "two"]);
    const smallestRegistry: readonly StackDetectionRule[] = [
      { tag: "single", anyOf: [{ exact: "one" }] },
    ];

    await expect(
      detectStackFromFilenames("/project", readDirectory, smallestRegistry),
    ).resolves.toEqual(["single"]);
    expect(readDirectory).toHaveBeenCalledTimes(1);

    readDirectory.mockClear();
    await expect(detectStackFromFilenames("/project", readDirectory)).resolves.toEqual(["nodejs"]);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it("reads marker names without opening marker files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clankerlog-stack-"));
    await writeFile(path.join(root, "package.json"), "not valid JSON and intentionally unread");

    await expect(detectStackFromFilenames(root)).resolves.toEqual(["nodejs"]);
  });

  it("surfaces directory read errors", async () => {
    const failure = new Error("directory unavailable");
    const readDirectory = vi.fn(async () => Promise.reject(failure));

    await expect(detectStackFromFilenames("/missing", readDirectory)).rejects.toBe(failure);
  });
});

describe("stack merging", () => {
  it("keeps explicit tags first and detected tags in registry order", () => {
    expect(mergeStack(["hono", "typescript"], ["typescript", "pnpm", "go"])).toEqual([
      "hono",
      "typescript",
      "pnpm",
      "go",
    ]);
  });

  it("preserves all explicit tags and caps only detected additions", () => {
    const explicit = Array.from({ length: 31 }, (_, index) => `explicit-${index}`);

    expect(mergeStack(explicit, ["detected-first", "detected-second"])).toEqual([
      ...explicit,
      "detected-first",
    ]);
    expect(mergeStack([...explicit, "explicit-31"], ["detected"])).toEqual([
      ...explicit,
      "explicit-31",
    ]);
  });

  it("deduplicates explicit tags by first occurrence", () => {
    expect(mergeStack(["nodejs", "nodejs", "pnpm"], ["nodejs", "go"])).toEqual([
      "nodejs",
      "pnpm",
      "go",
    ]);
  });
});
