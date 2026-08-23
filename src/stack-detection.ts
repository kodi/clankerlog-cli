export interface EntryMatcher {
  readonly exact?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export type StackDetectionRule =
  | {
      readonly tag: string;
      readonly anyOf: readonly EntryMatcher[];
      readonly allOf?: never;
    }
  | {
      readonly tag: string;
      readonly allOf: readonly EntryMatcher[];
      readonly anyOf?: never;
    };

export const stackDetectionRules: readonly StackDetectionRule[] = [
  {
    tag: "docker",
    anyOf: [
      { exact: "Dockerfile" },
      { suffix: ".Dockerfile" },
      { prefix: "Dockerfile." },
      { exact: ".dockerignore" },
      { exact: "compose.yaml" },
      { exact: "compose.yml" },
      { exact: "docker-compose.yaml" },
      { exact: "docker-compose.yml" },
    ],
  },
  {
    tag: "swift",
    anyOf: [
      { exact: "Package.swift" },
      { exact: ".swift-version" },
      { exact: ".swiftformat" },
      { exact: ".swiftlint.yml" },
      { exact: ".swiftlint.yaml" },
    ],
  },
  { tag: "xcode", anyOf: [{ suffix: ".xcodeproj" }, { suffix: ".xcworkspace" }] },
  { tag: "terraform", anyOf: [{ suffix: ".tf" }, { suffix: ".tf.json" }] },
  { tag: "nodejs", anyOf: [{ exact: "package.json" }] },
  {
    tag: "typescript",
    anyOf: [{ exact: "tsconfig.json" }, { prefix: "tsconfig.", suffix: ".json" }],
  },
  {
    tag: "npm",
    anyOf: [{ exact: "package-lock.json" }, { exact: "npm-shrinkwrap.json" }],
  },
  {
    tag: "pnpm",
    anyOf: [{ exact: "pnpm-lock.yaml" }, { exact: "pnpm-workspace.yaml" }],
  },
  {
    tag: "yarn",
    anyOf: [{ exact: "yarn.lock" }, { exact: ".yarnrc" }, { exact: ".yarnrc.yml" }],
  },
  {
    tag: "bun",
    anyOf: [{ exact: "bun.lock" }, { exact: "bun.lockb" }, { exact: "bunfig.toml" }],
  },
  { tag: "deno", anyOf: [{ exact: "deno.json" }, { exact: "deno.jsonc" }] },
  {
    tag: "python",
    anyOf: [
      { exact: "pyproject.toml" },
      { exact: "requirements.txt" },
      { exact: "setup.py" },
      { exact: "setup.cfg" },
      { exact: "Pipfile" },
      { exact: "poetry.lock" },
      { exact: "uv.lock" },
    ],
  },
  { tag: "go", anyOf: [{ exact: "go.mod" }] },
  { tag: "rust", anyOf: [{ exact: "Cargo.toml" }] },
  {
    tag: "cloudflare",
    anyOf: [{ exact: "wrangler.toml" }, { exact: "wrangler.json" }, { exact: "wrangler.jsonc" }],
  },
  {
    tag: "php",
    anyOf: [{ exact: "composer.json" }, { exact: "composer.lock" }],
  },
  {
    tag: "composer",
    anyOf: [{ exact: "composer.json" }, { exact: "composer.lock" }],
  },
  {
    tag: "ruby",
    anyOf: [
      { exact: "Gemfile" },
      { exact: "Gemfile.lock" },
      { exact: ".ruby-version" },
      { suffix: ".gemspec" },
    ],
  },
  {
    tag: "dotnet",
    anyOf: [
      { suffix: ".sln" },
      { suffix: ".slnx" },
      { suffix: ".csproj" },
      { suffix: ".fsproj" },
      { suffix: ".vbproj" },
    ],
  },
  { tag: "elixir", anyOf: [{ exact: "mix.exs" }, { exact: "mix.lock" }] },
  { tag: "erlang", anyOf: [{ exact: "rebar.config" }, { exact: "rebar.lock" }] },
  { tag: "dart", anyOf: [{ exact: "pubspec.yaml" }, { exact: "pubspec.lock" }] },
  { tag: "flutter", allOf: [{ exact: "pubspec.yaml" }, { exact: ".metadata" }] },
  { tag: "scala", anyOf: [{ exact: "build.sbt" }] },
  { tag: "clojure", anyOf: [{ exact: "deps.edn" }, { exact: "project.clj" }] },
  {
    tag: "haskell",
    anyOf: [{ exact: "cabal.project" }, { exact: "stack.yaml" }, { suffix: ".cabal" }],
  },
  { tag: "zig", anyOf: [{ exact: "build.zig" }, { exact: "build.zig.zon" }] },
  { tag: "maven", anyOf: [{ exact: "pom.xml" }, { exact: "mvnw" }] },
  {
    tag: "gradle",
    anyOf: [
      { exact: "build.gradle" },
      { exact: "build.gradle.kts" },
      { exact: "settings.gradle" },
      { exact: "settings.gradle.kts" },
      { exact: "gradlew" },
    ],
  },
  { tag: "cmake", anyOf: [{ exact: "CMakeLists.txt" }, { exact: "CMakePresets.json" }] },
  { tag: "meson", anyOf: [{ exact: "meson.build" }] },
  {
    tag: "bazel",
    anyOf: [
      { exact: "MODULE.bazel" },
      { exact: "WORKSPACE" },
      { exact: "WORKSPACE.bazel" },
      { exact: "BUILD.bazel" },
    ],
  },
  {
    tag: "nix",
    anyOf: [{ exact: "flake.nix" }, { exact: "shell.nix" }, { exact: "default.nix" }],
  },
];

export function detectStackFromEntries(
  entryNames: readonly string[],
  rules: readonly StackDetectionRule[] = stackDetectionRules,
): string[] {
  return rules.filter((rule) => matchesRule(entryNames, rule)).map((rule) => rule.tag);
}

function matchesRule(entryNames: readonly string[], rule: StackDetectionRule): boolean {
  if (rule.anyOf) {
    return rule.anyOf.some((matcher) => entryNames.some((name) => matchesEntry(name, matcher)));
  }

  return rule.allOf.every((matcher) => entryNames.some((name) => matchesEntry(name, matcher)));
}

function matchesEntry(entryName: string, matcher: EntryMatcher): boolean {
  return (
    (matcher.exact === undefined || entryName === matcher.exact) &&
    (matcher.prefix === undefined || entryName.startsWith(matcher.prefix)) &&
    (matcher.suffix === undefined || entryName.endsWith(matcher.suffix))
  );
}
