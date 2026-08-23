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

const waveTwoExactCases: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["composer.json", ["php", "composer"]],
  ["composer.lock", ["php", "composer"]],
  ["Gemfile", ["ruby"]],
  ["Gemfile.lock", ["ruby"]],
  [".ruby-version", ["ruby"]],
  ["mix.exs", ["elixir"]],
  ["mix.lock", ["elixir"]],
  ["rebar.config", ["erlang"]],
  ["rebar.lock", ["erlang"]],
  ["pubspec.yaml", ["dart"]],
  ["pubspec.lock", ["dart"]],
  ["build.sbt", ["scala"]],
  ["deps.edn", ["clojure"]],
  ["project.clj", ["clojure"]],
  ["cabal.project", ["haskell"]],
  ["stack.yaml", ["haskell"]],
  ["build.zig", ["zig"]],
  ["build.zig.zon", ["zig"]],
  ["pom.xml", ["maven"]],
  ["mvnw", ["maven"]],
  ["build.gradle", ["gradle"]],
  ["build.gradle.kts", ["gradle"]],
  ["settings.gradle", ["gradle"]],
  ["settings.gradle.kts", ["gradle"]],
  ["gradlew", ["gradle"]],
  ["CMakeLists.txt", ["cmake"]],
  ["CMakePresets.json", ["cmake"]],
  ["meson.build", ["meson"]],
  ["MODULE.bazel", ["bazel"]],
  ["WORKSPACE", ["bazel"]],
  ["WORKSPACE.bazel", ["bazel"]],
  ["BUILD.bazel", ["bazel"]],
  ["flake.nix", ["nix"]],
  ["shell.nix", ["nix"]],
  ["default.nix", ["nix"]],
];

const waveThreeExactCases: ReadonlyArray<readonly [string, string]> = [
  ["next.config.js", "nextjs"],
  ["next.config.mjs", "nextjs"],
  ["next.config.ts", "nextjs"],
  ["nuxt.config.js", "nuxt"],
  ["nuxt.config.mjs", "nuxt"],
  ["nuxt.config.ts", "nuxt"],
  ["vite.config.js", "vite"],
  ["vite.config.mjs", "vite"],
  ["vite.config.cjs", "vite"],
  ["vite.config.ts", "vite"],
  ["vite.config.mts", "vite"],
  ["vite.config.cts", "vite"],
  ["svelte.config.js", "svelte"],
  ["astro.config.js", "astro"],
  ["astro.config.mjs", "astro"],
  ["astro.config.ts", "astro"],
  ["angular.json", "angular"],
  ["vue.config.js", "vue"],
  ["remix.config.js", "remix"],
  ["gatsby-config.js", "gatsby"],
  ["gatsby-config.mjs", "gatsby"],
  ["gatsby-config.ts", "gatsby"],
  ["nest-cli.json", "nestjs"],
  ["nx.json", "nx"],
  ["turbo.json", "turborepo"],
  ["turbo.jsonc", "turborepo"],
  ["kustomization.yaml", "kubernetes"],
  ["kustomization.yml", "kubernetes"],
  ["Chart.yaml", "helm"],
  ["Pulumi.yaml", "pulumi"],
  ["Pulumi.yml", "pulumi"],
  ["ansible.cfg", "ansible"],
  [".devcontainer", "devcontainer"],
  ["devcontainer.json", "devcontainer"],
  ["Vagrantfile", "vagrant"],
  ["Tiltfile", "tilt"],
  ["serverless.yml", "serverless"],
  ["serverless.yaml", "serverless"],
  ["firebase.json", "firebase"],
  [".firebaserc", "firebase"],
  ["cdk.json", "aws-cdk"],
];

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

  it.each(waveTwoExactCases)("detects Wave 2 exact marker %s", (entryName, tags) => {
    expect(detectStackFromEntries([entryName])).toEqual(tags);
  });

  it.each(waveTwoExactCases)("rejects nearby Wave 2 exact-marker miss for %s", (entryName) => {
    expect(detectStackFromEntries([`${entryName}.backup`])).toEqual([]);
  });

  it.each([
    ["library.gemspec", "ruby"],
    ["App.sln", "dotnet"],
    ["App.slnx", "dotnet"],
    ["App.csproj", "dotnet"],
    ["App.fsproj", "dotnet"],
    ["App.vbproj", "dotnet"],
    ["library.cabal", "haskell"],
  ])("detects Wave 2 pattern marker %s as %s", (entryName, tag) => {
    expect(detectStackFromEntries([entryName])).toEqual([tag]);
  });

  it.each([
    "library.gemspec.backup",
    "App.sln.backup",
    "App.slnx.backup",
    "App.csproj.backup",
    "App.fsproj.backup",
    "App.vbproj.backup",
    "library.cabal.backup",
  ])("rejects nearby Wave 2 pattern miss %s", (entryName) => {
    expect(detectStackFromEntries([entryName])).toEqual([]);
  });

  it("requires both official Flutter project markers", () => {
    expect(detectStackFromEntries(["pubspec.yaml"])).toEqual(["dart"]);
    expect(detectStackFromEntries([".metadata"])).toEqual([]);
    expect(detectStackFromEntries(["pubspec.yaml", ".metadata"])).toEqual(["dart", "flutter"]);
  });

  it.each(waveThreeExactCases)("detects Wave 3 exact marker %s as %s", (entryName, tag) => {
    expect(detectStackFromEntries([entryName])).toEqual([tag]);
  });

  it.each(waveThreeExactCases)("rejects nearby Wave 3 exact-marker miss for %s", (entryName) => {
    expect(detectStackFromEntries([`${entryName}.backup`])).toEqual([]);
  });

  it("requires both Laravel or Symfony signals without confusing the frameworks", () => {
    expect(detectStackFromEntries(["artisan"])).toEqual([]);
    expect(detectStackFromEntries(["symfony.lock"])).toEqual([]);
    expect(detectStackFromEntries(["composer.json", "artisan"])).toEqual([
      "php",
      "composer",
      "laravel",
    ]);
    expect(detectStackFromEntries(["composer.json", "symfony.lock"])).toEqual([
      "php",
      "composer",
      "symfony",
    ]);
  });

  it("keeps deterministic registry order for a multi-stack repository", () => {
    const entries = [
      "cdk.json",
      "composer.json",
      "vite.config.ts",
      "artisan",
      "package.json",
      "Dockerfile",
      "tsconfig.json",
      "nx.json",
      "firebase.json",
    ];

    expect(detectStackFromEntries(entries)).toEqual([
      "docker",
      "nodejs",
      "typescript",
      "php",
      "composer",
      "vite",
      "nx",
      "laravel",
      "firebase",
      "aws-cdk",
    ]);
    expect(detectStackFromEntries(entries.reverse())).toEqual([
      "docker",
      "nodejs",
      "typescript",
      "php",
      "composer",
      "vite",
      "nx",
      "laravel",
      "firebase",
      "aws-cdk",
    ]);
  });

  it("caps complete-registry detection without reordering or duplicating tags", () => {
    const allEntries = [
      ...waveTwoExactCases.map(([entryName]) => entryName),
      ...waveThreeExactCases.map(([entryName]) => entryName),
      "Dockerfile",
      "Package.swift",
      "App.xcodeproj",
      "main.tf",
      "package.json",
      "tsconfig.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "deno.json",
      "pyproject.toml",
      "go.mod",
      "Cargo.toml",
      "wrangler.toml",
      "artisan",
      "symfony.lock",
      ".metadata",
      "App.csproj",
    ];
    const detected = detectStackFromEntries(allEntries);

    expect(detected.length).toBe(stackDetectionRules.length);
    expect(new Set(detected).size).toBe(detected.length);
    expect(mergeStack([], detected)).toEqual(detected.slice(0, 32));
    expect(mergeStack(["explicit"], detected)).toEqual(["explicit", ...detected.slice(0, 31)]);
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
