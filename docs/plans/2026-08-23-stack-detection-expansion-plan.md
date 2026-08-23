# Stack Detection Expansion Plan

## Summary

Expand ClankerLog's project stack inference from seven hard-coded root filename
checks into a small, deterministic rule registry. The first behavior slice adds
the requested Docker, Swift, and Terraform coverage, while later slices add
high-confidence markers for common runtimes, package/build tools, frameworks,
and deployment tooling.

The detector must remain privacy-friendly: it may inspect filesystem entry
names in the selected project root, but it must not open project files, parse
manifests, scan source code, invoke ecosystem tools, or send match evidence.

## Decisions

- Keep stack detection filename-only and local. Do not read `package.json`,
  dependency manifests, source files, lockfile contents, or infrastructure
  configuration contents.
- Keep this expansion root-only. Support exact names plus simple prefix and
  suffix matching without recursive traversal.
- Prefer high-confidence evidence. A marker should identify the emitted tag on
  its own, or as part of a small `allOf` group of root markers.
- Treat stack as a mixed list of languages/runtimes, frameworks, build/package
  tools, and deployment platforms. This preserves the existing `pnpm` and
  `cloudflare` behavior.
- Use stable lowercase tags that already satisfy `stackTagSchema`. Do not add a
  second alias for the same component.
- Correct the existing `package.json -> typescript` false positive:
  `package.json` emits `nodejs`; `tsconfig.json` or `tsconfig.*.json` emits
  `typescript`.
- Keep `swift` and `xcode` separate. `Package.swift` and Swift-specific root
  markers emit `swift`; `*.xcodeproj` and `*.xcworkspace` emit `xcode` because
  Xcode projects can contain non-Swift code.
- Emit `terraform` only for Terraform configuration (`*.tf` or `*.tf.json`). Do
  not infer it from `.terraform/`, `*.tfstate`, or `*.tfvars` alone.
- Preserve current stack merge semantics: explicit flag/env/project tags come
  first and detected tags supplement them. Deduplicate by first occurrence.
- Automatic detection must never make an otherwise valid clank fail the
  32-tag payload limit. Preserve every explicit tag and append detected tags in
  registry order only while capacity remains.
- Do not expose detection reasons in the clank payload. The ordered rule
  registry and focused tests are the audit surface.
- Keep detection off the latency path beyond one root-directory read. The
  implementation must not perform one filesystem call per rule, recurse, open
  files, or invoke external commands.

The requested markers are supported by the technologies' own documentation:

- Docker documents `Dockerfile`, the common `<name>.Dockerfile` convention, and
  the Compose names `compose.yaml`, `compose.yml`, `docker-compose.yaml`, and
  `docker-compose.yml`:
  <https://docs.docker.com/build/concepts/dockerfile/>
  <https://docs.docker.com/compose/intro/compose-application-model/>
- Swift Package Manager requires `Package.swift` in the package's main
  directory:
  <https://docs.swift.org/swiftpm/documentation/packagedescription/>
- Terraform configuration uses `*.tf` and `*.tf.json` files:
  <https://developer.hashicorp.com/terraform/language/files>
- TypeScript documents `tsconfig.json` as the root marker of a TypeScript
  project:
  <https://www.typescriptlang.org/docs/handbook/tsconfig-json>

## Scope

In scope:

- a declarative, ordered stack-detection rule registry
- exact-name, prefix, suffix, and grouped root-marker matching
- direct unit tests for stack detection and merge behavior
- Docker, Swift, Xcode, and Terraform detection
- correcting Node.js versus TypeScript inference
- broader high-confidence language, runtime, package/build, framework, and
  infrastructure markers listed below
- deterministic deduplication and safe handling of the 32-tag limit
- README and integration-documentation updates
- a local dry-run/dogfood check through the source-backed
  `~/.local/bin/clankerlog-dev` shim

Out of scope:

- reading manifest or source-file contents to infer dependencies
- recursively walking project trees or inferring languages from source-file
  extensions
- detecting services with no distinctive root marker, such as PostgreSQL,
  Redis, React, Express, Hono, FastAPI, Flask, Rails, Spring, or Phoenix
- parsing generic YAML to distinguish Kubernetes, CI, or cloud-provider config
- detecting Terraform providers or Docker base images
- changing project-root selection, allow-list behavior, or hook behavior
- changing the ingestion payload schema, retroactively updating old clanks, or
  adding backend-specific stack metadata
- emitting confidence scores or marker filenames

Users can continue to add components outside this conservative catalog through
`--stack`, `CLANKERLOG_STACK`, or `.clankerlog.json`.

## Current State

`src/stack.ts` reads the selected project's root with `readdir(projectPath)`,
builds a set of entry names, and uses sequential conditionals to emit:

| Current marker                      | Current tag  |
| ----------------------------------- | ------------ |
| `package.json`                      | `typescript` |
| `pnpm-lock.yaml`                    | `pnpm`       |
| `go.mod`                            | `go`         |
| `Cargo.toml`                        | `rust`       |
| `pyproject.toml`                    | `python`     |
| `deno.json`                         | `deno`       |
| `wrangler.jsonc` or `wrangler.toml` | `cloudflare` |

The detector has no direct unit test. It is covered indirectly by
`tests/commands/ping.test.ts`, whose temp project contains `package.json` and
`pnpm-lock.yaml`.

`resolvePing()` always appends detected tags after the selected explicit source;
the flag, environment, and project config have precedence only over one another.
`uniqueStack()` then validates the complete array. As a result, enough detected
tags can currently exceed the API's 32-tag limit and fail the clank.

`README.md` and `docs/integrations.md` explicitly document the coarse
`package.json -> typescript` behavior, so the Node.js/TypeScript correction is a
documented behavior change rather than only an internal refactor.

Planning baseline verified on 2026-08-23:

```text
mise run test -- tests/commands/ping.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

The development shim is a regular executable that points at this checkout's
`src/cli.ts`; no shim change is needed. The instructed sibling checkout
`../clankerlog` was not present during planning, so backend/UI handling of new
arbitrary-but-valid stack tags was not re-verified from source.

## Behavior To Preserve

- Stack inference runs only after the project passes allow-list/auto-track
  resolution.
- Explicit stack tags and detected tags are combined; detection does not replace
  a user-selected stack.
- Explicit tags retain input order and win duplicate ordering.
- Detection is deterministic across platforms and filesystem enumeration order.
- Empty or unrecognized projects return an empty detected stack.
- Filesystem errors reading the selected project continue to surface rather
  than silently producing a misleading empty stack.
- Tags continue to pass `stackTagSchema` and the ingestion payload remains at
  most 32 tags.
- No marker filenames, file contents, source code, prompts, diffs, transcripts,
  terminal output, or secrets are sent.
- `~/.local/bin/clankerlog-dev` continues to run `src/cli.ts` from this checkout.

## Recommended Implementation Shape

Keep filesystem access thin and move matching into a pure function. A compact
shape is sufficient:

```ts
interface EntryMatcher {
  readonly exact?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

type StackDetectionRule =
  | { readonly tag: string; readonly anyOf: readonly EntryMatcher[] }
  | { readonly tag: string; readonly allOf: readonly EntryMatcher[] };
```

- `detectStackFromFilenames(projectPath)` reads root entry names once.
- `detectStackFromEntries(entryNames, rules)` evaluates the ordered registry and
  returns tags in registry order.
- Every populated field on one matcher must match the same entry name, allowing
  `{ prefix: "tsconfig.", suffix: ".json" }` without arbitrary glob support.
- A rule uses exactly one condition form: it matches when at least one `anyOf`
  matcher succeeds, or when every `allOf` matcher succeeds. Do not add a glob
  dependency.
- Validate the registry in tests: tags are unique, schema-valid, and every rule
  has a signal.
- A dedicated `mergeStack(explicit, detected, max = 32)` helper preserves first
  occurrence, explicit order, registry order, and caps only automatic tags.
- Keep rules data-oriented. Avoid a new class hierarchy or per-technology
  functions.

Put the rule types, pure matcher, and ordered catalog in
`src/stack-detection.ts`; leave stack-value parsing, filesystem orchestration,
and merging in `src/stack.ts`.

## Performance Contract

The catalog size should affect only in-memory string matching. Adding a rule
must not add a filesystem round trip.

- Perform exactly one `readdir(projectPath)` for a detection run and reuse the
  returned entry names for every rule.
- Do not call `stat`, `access`, `readFile`, a glob library, an ecosystem CLI, or
  `readdir` again from individual rules.
- Keep the pure matcher bounded by root-entry count and registry size. Compile
  exact-name signals into a lookup map if the straightforward implementation
  becomes measurably slow; prefix/suffix matching can remain a small ordered
  list.
- Add an I/O contract test with an injected or mocked directory reader that
  asserts one call regardless of rule count.
- Add a warmed-up synthetic regression test that runs the complete registry
  against 50,000 entry names and must finish in less than 1,000 ms. This is a
  deliberately generous CI ceiling intended to catch accidental multi-second
  work, not a claim that normal detection should take anywhere near one second.
- Do not put a strict wall-clock assertion around the real filesystem call;
  overloaded, remote, or pathological filesystems are outside the detector's
  control. Record an informational local timing for the source checkout during
  final dogfood instead.
- If the synthetic gate becomes flaky, first reduce nondeterminism, warm up the
  matcher, and inspect the algorithm. Do not simply raise the ceiling without a
  dated finding and measured evidence.

This contract prevents ClankerLog itself from introducing multi-second
detection. It cannot guarantee that a single operating-system directory read on
an unhealthy or remote filesystem will return promptly.

## Detection Catalog

### Wave 1: Requested Components And Existing-Ecosystem Repair

These are the first behavior changes after the matcher contract is tested.

| Tag          | Root signals                                                                                                                              | Notes                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docker`     | `Dockerfile`, `*.Dockerfile`, `Dockerfile.*`, `.dockerignore`, `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml` | One Docker tag; do not emit a separate Compose alias.                                    |
| `swift`      | `Package.swift`, `.swift-version`, `.swiftformat`, `.swiftlint.yml`, `.swiftlint.yaml`                                                    | High-confidence Swift tooling only.                                                      |
| `xcode`      | `*.xcodeproj`, `*.xcworkspace`                                                                                                            | Does not imply `swift`.                                                                  |
| `terraform`  | `*.tf`, `*.tf.json`                                                                                                                       | Exclude `*.tfvars`, `*.tfstate`, and `.terraform/`-only matches.                         |
| `nodejs`     | `package.json`                                                                                                                            | Replaces the current TypeScript guess.                                                   |
| `typescript` | `tsconfig.json`, `tsconfig.*.json`                                                                                                        | A TypeScript-specific marker.                                                            |
| `npm`        | `package-lock.json`, `npm-shrinkwrap.json`                                                                                                | Package manager tag, consistent with `pnpm`.                                             |
| `pnpm`       | `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                                                                                   | Preserve and broaden current behavior.                                                   |
| `yarn`       | `yarn.lock`, `.yarnrc`, `.yarnrc.yml`                                                                                                     | Package manager tag.                                                                     |
| `bun`        | `bun.lock`, `bun.lockb`, `bunfig.toml`                                                                                                    | Runtime/package manager tag.                                                             |
| `deno`       | `deno.json`, `deno.jsonc`                                                                                                                 | Preserve and broaden current behavior.                                                   |
| `python`     | `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `Pipfile`, `poetry.lock`, `uv.lock`                                        | Do not match every `requirements-*.txt` until a real false-positive corpus justifies it. |
| `cloudflare` | `wrangler.toml`, `wrangler.json`, `wrangler.jsonc`                                                                                        | Preserve and broaden current behavior.                                                   |

`go.mod -> go` and `Cargo.toml -> rust` remain unchanged in the ordered registry.

### Wave 2: Common Language And Build Ecosystems

Add these as a separate reviewable slice after Wave 1 behavior and tag ordering
are verified.

| Tag        | Root signals                                                                            | Boundary                                          |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `php`      | `composer.json`, `composer.lock`                                                        | Composer is PHP-specific.                         |
| `composer` | `composer.json`, `composer.lock`                                                        | Preserve package-manager visibility.              |
| `ruby`     | `Gemfile`, `Gemfile.lock`, `.ruby-version`, `*.gemspec`                                 | Do not infer Rails.                               |
| `dotnet`   | `*.sln`, `*.slnx`, `*.csproj`, `*.fsproj`, `*.vbproj`                                   | Do not guess C#, F#, or VB from a solution alone. |
| `elixir`   | `mix.exs`, `mix.lock`                                                                   | Do not infer Phoenix.                             |
| `erlang`   | `rebar.config`, `rebar.lock`                                                            | Erlang toolchain marker.                          |
| `dart`     | `pubspec.yaml`, `pubspec.lock`                                                          | Does not alone imply Flutter.                     |
| `flutter`  | both `pubspec.yaml` and `.metadata`                                                     | Composite high-confidence marker.                 |
| `scala`    | `build.sbt`                                                                             | Do not emit Java.                                 |
| `clojure`  | `deps.edn`, `project.clj`                                                               | Language ecosystem marker.                        |
| `haskell`  | `cabal.project`, `stack.yaml`, `*.cabal`                                                | Language/build ecosystem marker.                  |
| `zig`      | `build.zig`, `build.zig.zon`                                                            | Language build marker.                            |
| `maven`    | `pom.xml`, `mvnw`                                                                       | Do not infer Java versus Kotlin.                  |
| `gradle`   | `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `gradlew` | Do not infer Java, Kotlin, or Android.            |
| `cmake`    | `CMakeLists.txt`, `CMakePresets.json`                                                   | Do not infer C versus C++.                        |
| `meson`    | `meson.build`                                                                           | Build-system tag.                                 |
| `bazel`    | `MODULE.bazel`, `WORKSPACE`, `WORKSPACE.bazel`, `BUILD.bazel`                           | Build-system tag.                                 |
| `nix`      | `flake.nix`, `shell.nix`, `default.nix`                                                 | Development/build environment tag.                |

### Wave 3: Framework, Monorepo, And Infrastructure Markers

These markers are valuable and distinctive without opening manifests. Keep
them separate so product review can assess whether the resulting stack remains
useful rather than noisy.

| Tag            | Root signals                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `nextjs`       | `next.config.js`, `next.config.mjs`, `next.config.cjs`, `next.config.ts`                                       |
| `nuxt`         | `nuxt.config.js`, `nuxt.config.mjs`, `nuxt.config.ts`                                                          |
| `vite`         | `vite.config.js`, `vite.config.mjs`, `vite.config.cjs`, `vite.config.ts`, `vite.config.mts`, `vite.config.cts` |
| `svelte`       | `svelte.config.js`, `svelte.config.mjs`, `svelte.config.cjs`, `svelte.config.ts`                               |
| `astro`        | `astro.config.js`, `astro.config.mjs`, `astro.config.cjs`, `astro.config.ts`                                   |
| `angular`      | `angular.json`                                                                                                 |
| `vue`          | `vue.config.js`, `vue.config.cjs`, `vue.config.mjs`, `vue.config.ts`                                           |
| `remix`        | `remix.config.js`, `remix.config.mjs`, `remix.config.cjs`                                                      |
| `gatsby`       | `gatsby-config.js`, `gatsby-config.mjs`, `gatsby-config.ts`                                                    |
| `nestjs`       | `nest-cli.json`                                                                                                |
| `nx`           | `nx.json`                                                                                                      |
| `turborepo`    | `turbo.json`, `turbo.jsonc`                                                                                    |
| `laravel`      | both `composer.json` and `artisan`                                                                             |
| `symfony`      | both `composer.json` and `symfony.lock`                                                                        |
| `kubernetes`   | `kustomization.yaml`, `kustomization.yml`                                                                      |
| `helm`         | `Chart.yaml`                                                                                                   |
| `pulumi`       | `Pulumi.yaml`, `Pulumi.yml`                                                                                    |
| `ansible`      | `ansible.cfg`                                                                                                  |
| `devcontainer` | `.devcontainer`, `devcontainer.json`                                                                           |
| `vagrant`      | `Vagrantfile`                                                                                                  |
| `tilt`         | `Tiltfile`                                                                                                     |
| `serverless`   | `serverless.yml`, `serverless.yaml`                                                                            |
| `firebase`     | `firebase.json`, `.firebaserc`                                                                                 |
| `aws-cdk`      | `cdk.json`                                                                                                     |

Before implementing Wave 2 or Wave 3, cross-check each marker against current
official documentation and remove any rule that is ambiguous in practice. The
table is a bounded candidate catalog, not permission to add dependency-content
inspection as a fallback.

## Explicit-Only Components

Keep components without a distinctive root filename out of automatic detection.
Examples include:

- React, Preact, Solid, Hono, Express, Fastify, Nest package usage outside
  `nest-cli.json`, and most JavaScript libraries
- Django, Flask, FastAPI, Rails, Phoenix, Spring, ASP.NET variants, and database
  client frameworks
- PostgreSQL, MySQL, SQLite, Redis, NATS, Kafka, and cloud services referenced
  only inside code, manifests, Dockerfiles, or Terraform files
- CI providers represented only by generic YAML
- Terraform providers and Docker base images

These require manifest/config content inspection or source analysis, which is
outside the current privacy contract. Users should supply them explicitly.

## Cross-Slice Rules

- Use the `fff` MCP tools for every file search operation in this repository.
- Use only the documented `mise` tasks for tests, typecheck, formatting, and
  linting; never invoke the equivalent `pnpm` scripts directly.
- Keep the local development shim pointed at `src/cli.ts`.
- Keep detection to one root `readdir`; catalog growth must not create per-rule
  filesystem calls.
- Do not read project file contents in the detector, even when doing so would
  improve framework accuracy.
- Add a positive and a nearby negative test for every prefix/suffix rule.
- Keep registry order deliberate and stable; do not depend on `readdir` order.
- Preserve explicit tags before detected tags and cap only detected additions.
- Do not infer a language from a multi-language build tool when the marker does
  not distinguish it.
- Do not use generated/cache/state entries as sole evidence.
- Any new tag must pass `stackTagSchema` and must not have a second alias.
- Keep implementation slices focused; do not add Wave 2 or Wave 3
  opportunistically while implementing the requested Wave 1 changes.

## Testing Plan

Direct detector tests should be table-driven and cover:

- every exact marker and representative positive prefix/suffix markers
- near misses such as `NotDockerfile`, `main.tfvars`, `terraform.tfstate`, and
  `project.xcodeproj.backup`
- an Xcode project producing `xcode` without automatically producing `swift`
- `package.json` producing `nodejs`, with TypeScript added only by a tsconfig
- composite rules requiring all signals
- duplicate signals producing one tag
- stable registry ordering independent of input order
- empty and unknown entry sets
- every registry tag passing `stackTagSchema`
- 32 explicit tags accepting no detected additions
- explicit tags winning duplicate order and detected tags filling remaining
  capacity
- the filesystem wrapper reading a temporary root without opening marker files
- one directory-reader call with the smallest registry and the complete
  registry
- the warmed-up complete registry matching 50,000 synthetic entry names in
  less than 1,000 ms
- the existing ping path combining explicit and detected tags

Per-slice commands are listed below. Final verification:

```bash
mise run local-ci
mise run build
~/.local/bin/clankerlog-dev ping --dry-run --agent codex --model gpt-5.5
```

Run the dry-run from an allowed disposable fixture or from this checkout only
when its current user configuration already permits it. Inspect the payload for
deterministic, expected tags and confirm that no network request occurs.

When `../clankerlog` is available, also verify from backend source that valid
unknown stack tags are accepted and rendered generically. If the backend has a
closed vocabulary, add the backend vocabulary/UI work as a separate plan slice
before shipping new CLI tags.

## Files To Add

- `src/stack-detection.ts` for the matcher types, pure matcher, and ordered
  registry
- `tests/stack.test.ts`
- `docs/plans/2026-08-23-stack-detection-expansion-plan.md`

## Files To Change

- `src/stack.ts`
- `src/commands/ping.ts` only if stack merging moves behind a dedicated helper
- `tests/commands/ping.test.ts`
- `README.md`
- `docs/integrations.md`

Do not change `~/.local/bin/clankerlog-dev` or generated `topchester-kb` files as
part of this work.

## Slice 1: Detection Contract, Registry, And Limit Safety

Status: `[x]` Done

Goal: Replace sequential conditionals with a tested pure matcher and make
explicit/detected stack merging safe under the 32-tag payload limit without
changing the existing seven detections.

Why here: Later catalog work should be data additions against a stable contract,
and increasing the rule count before fixing the payload cap would introduce a
new runtime failure mode.

This slice should implement:

- characterize the current seven rules in `tests/stack.test.ts`
- add the ordered rule type/registry and pure entry-name matcher
- add exact, prefix, suffix, and `allOf` support
- keep `detectStackFromFilenames()` as the filesystem wrapper used by ping
- add a merge helper that preserves explicit tags and caps detected additions
- update `resolvePing()` to use the merge helper
- test order, deduplication, schema validity, empty results, filesystem errors,
  and the 32-tag boundary
- test that catalog size does not increase filesystem calls
- add the warmed-up 50,000-entry synthetic matcher gate with a 1,000 ms ceiling
- leave all existing marker-to-tag mappings unchanged in this slice

Expected output:

- The current stack output is unchanged for existing fixtures.
- New rules can be added as data with direct positive and negative tests.
- Automatic detection cannot overflow the payload tag limit.
- The detector performs one filesystem read, and the pure matcher has a
  regression guard against multi-second execution.

Verification:

```bash
mise run test -- tests/stack.test.ts tests/commands/ping.test.ts
mise run typecheck
```

Dependencies: none.

## Slice 2: Docker, Swift, Terraform, And JavaScript-Ecosystem Repair

Status: `[x]` Done

Goal: Add the explicitly requested technologies and correct the most misleading
existing inference.

Why here: These are the user-requested gaps, and the Node.js/TypeScript repair
belongs beside the first catalog behavior change rather than being hidden in the
registry refactor.

This slice should implement:

- all Wave 1 rules from the catalog
- unchanged `go` and `rust` rules
- `package.json -> nodejs` and tsconfig-based `typescript`
- positive/negative tests for Docker and Terraform pattern boundaries
- tests proving Xcode alone does not imply Swift
- updated ping fixture expectations for `nodejs`, `typescript`, and package
  manager tags
- no documentation update yet beyond dated findings in this plan

Expected output:

- Docker, Swift package/tooling, Xcode, and Terraform projects emit conservative
  tags from root entry names.
- JavaScript projects are no longer all mislabeled TypeScript.
- This repository still emits `typescript` because it has `tsconfig.json`, and
  it additionally emits `nodejs` and `pnpm`.

Verification:

```bash
mise run test -- tests/stack.test.ts tests/commands/ping.test.ts
mise run typecheck
```

Dependencies: Slice 1.

## Slice 3: Common Language And Build Ecosystems

Status: `[x]` Done

Goal: Add the Wave 2 catalog without adding content inspection or language
guesses from ambiguous build systems.

Why here: These rules broaden useful coverage after the requested components
and matching primitives have been proven.

This slice should implement:

- Wave 2 language/ecosystem rules
- composite Flutter detection
- build-tool tags that do not guess Java/Kotlin, C/C++, or a .NET language
- official-marker validation recorded under Working Notes before each rule is
  merged
- table-driven positives and nearby negatives for every new rule

Expected output:

- Common non-JavaScript project ecosystems gain useful tags while ambiguous
  languages remain explicit-only.
- Adding the full Wave 2 registry does not change payload validation or ordering
  guarantees.

Verification:

```bash
mise run test -- tests/stack.test.ts tests/commands/ping.test.ts
mise run typecheck
```

Dependencies: Slice 2.

## Slice 4: Framework And Infrastructure Markers

Status: `[x]` Done

Goal: Add Wave 3's distinctive framework, monorepo, and infrastructure config
markers after reviewing the resulting tag volume.

Why here: These tags are useful but are more likely than language/toolchain tags
to make polyglot monorepo payloads noisy, so they should be reviewed separately.

This slice should implement:

- validate the Wave 3 list against current official documentation
- add only markers that remain distinctive without file-content inspection
- add composite Laravel and Symfony rules
- add tests for multi-match repositories, deterministic order, duplicates, and
  the 32-tag cap with the complete registry
- re-run the 50,000-entry performance case against the complete Wave 3 registry
- record removed or deferred candidates in Working Notes rather than weakening
  the confidence rule

Expected output:

- Common config-named frameworks and infrastructure tools are detected.
- Generic manifests and dependency-only frameworks remain explicit-only.

Verification:

```bash
mise run test -- tests/stack.test.ts tests/commands/ping.test.ts
mise run typecheck
```

Dependencies: Slice 3.

## Slice 5: Documentation, Backend Compatibility Check, And Dogfood

Status: `[ ]` Not started

Goal: Publish the supported-marker contract and verify the production-shaped
source-backed path.

Why here: Documentation should describe the catalog that actually shipped, and
backend/UI compatibility should be checked against the final tag set rather than
the candidate list.

This slice should implement:

- update README privacy text and explain root-name-only inference
- replace the documented `package.json -> typescript` example with the final
  Node.js/TypeScript behavior
- document the supported automatic tags and the explicit-only escape hatch
- update `docs/integrations.md` with the current repository's actual detected
  stack
- inspect `../clankerlog` when available for ingestion validation and generic
  tag rendering; record exact evidence in Working Notes
- run a source-backed dry-run through `~/.local/bin/clankerlog-dev`
- record an informational local duration for stack detection in this checkout;
  do not turn the filesystem timing into a CI assertion
- leave the shim itself unchanged and confirm it still targets `src/cli.ts`

Expected output:

- Users can tell what ClankerLog detects, what it intentionally does not detect,
  and how to add explicit tags.
- The source-backed CLI emits the expected stack without reading file contents
  or sending a clank during dry-run.

Verification:

```bash
mise run local-ci
mise run build
~/.local/bin/clankerlog-dev ping --dry-run --agent codex --model gpt-5.5
```

Dependencies: Slice 4 and availability of an allowed dry-run fixture. Backend
source inspection is also required if the sibling checkout is restored; if it
remains unavailable, record that limitation and do not claim backend/UI proof.

## Open Questions

- Should a future privacy-reviewed phase perform a bounded filename-only shallow
  walk so Xcode-only Swift apps and nested monorepo packages can be detected?
  This plan intentionally does not.
- Should the product eventually distinguish `docker` from `docker-compose`, or
  is one user-facing Docker tag more useful? This plan recommends one tag.
- Should OpenTofu emit `terraform`, `opentofu`, or both? There is no reliable
  root filename distinction in the current filename-only approach, so this plan
  does not claim OpenTofu detection.
- Does the current backend/UI render arbitrary valid tags generically, or does
  it maintain an allow-list/display map that must be extended? The sibling
  checkout was unavailable during planning.
- After dogfooding the complete registry, are package/build tags helpful enough
  to keep alongside languages and frameworks, or should future payloads split
  stack into categories? Payload-schema changes are outside this plan.

## Working Notes

### 2026-08-23 Slice 1 implementation findings

- Added `src/stack-detection.ts` with the ordered seven-rule baseline registry,
  pure exact/prefix/suffix matcher support, and composite `allOf` matching.
- Kept `detectStackFromFilenames()` as the ping-path wrapper and injected its
  directory reader for contract testing. Both a one-rule catalog and the full
  baseline catalog perform exactly one directory-reader call.
- Added `mergeStack()` so explicit tags retain first-occurrence order and all
  available capacity; detected tags supplement them in registry order only
  until the 32-tag payload limit is reached.
- Added direct detector coverage for the existing mappings, matcher boundaries,
  stable order, deduplication, registry validity, empty/unknown roots,
  filesystem failure propagation, marker-name-only reads, and the 32-tag merge
  boundary.
- The warmed 50,000-entry complete-registry test passed under its 1,000 ms
  ceiling.
- Verification passed: `mise run test -- tests/stack.test.ts
tests/commands/ping.test.ts` (2 files, 25 tests) and `mise run typecheck`.

### 2026-08-23 Slice 2 implementation findings

- Added the complete Wave 1 catalog in deliberate registry order: Docker,
  Swift, Xcode, Terraform, Node.js, TypeScript, npm, pnpm, Yarn, Bun, Deno,
  Python, Go, Rust, and Cloudflare.
- Corrected `package.json` to emit `nodejs`; TypeScript now requires
  `tsconfig.json` or the bounded `tsconfig.*.json` pattern. The ping fixture now
  carries both markers and asserts `nodejs`, `typescript`, and `pnpm`.
- Added every exact Wave 1 marker plus representative pattern positives and
  nearby negatives for Dockerfile, Xcode, Terraform, and tsconfig boundaries.
  Xcode-only roots are explicitly verified not to imply Swift.
- Verification passed: `mise run test -- tests/stack.test.ts
tests/commands/ping.test.ts` (2 files, 73 tests), `mise run typecheck`, and
  `mise run format-check`.

### 2026-08-23 Slice 3 official-marker validation

- Retained PHP/Composer and Ruby markers after checking Composer's root
  `composer.json`/`composer.lock` workflow and Bundler's root `Gemfile`, default
  `Gemfile.lock`, `.ruby-version`, and gemspec guidance:
  <https://getcomposer.org/doc/01-basic-usage.md>
  <https://bundler.io/guides/gemfile.html>
- Retained .NET patterns after Microsoft documented `.sln`/`.slnx` as solution
  formats and `.csproj`, `.fsproj`, and `.vbproj` as language project formats:
  <https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-sln>
  <https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview>
  <https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-your-local-build>
- Retained Mix and Rebar markers from the current Mix project/dependency docs
  and Rebar3 root-configuration/lockfile docs:
  <https://hexdocs.pm/mix/Mix.Project.html>
  <https://hexdocs.pm/mix/Mix.Tasks.Deps.html>
  <https://rebar3.org/docs/configuration/configuration/>
  <https://rebar3.org/docs/configuration/dependencies/>
- Retained Dart's `pubspec.yaml`/`pubspec.lock` markers from the Dart package
  layout contract. Retained Flutter's composite only: current Flutter docs say
  every Flutter project has a root pubspec, and the official Flutter tool repo
  still ships version-controlled `.metadata` templates for generated projects:
  <https://dart.dev/tools/pub/package-layout>
  <https://docs.flutter.dev/tools/pubspec>
  <https://github.com/flutter/flutter/tree/master/packages/flutter_tools/templates>
- Retained Scala/sbt, Clojure, Haskell, and Zig markers from their current
  official build/project documentation:
  <https://www.scala-sbt.org/1.x/docs/Directories.html>
  <https://clojure.org/reference/deps_edn>
  <https://cabal.readthedocs.io/en/3.14/cabal-project-description-file.html>
  <https://docs.haskellstack.org/en/stable/tutorial/stack_configuration/>
  <https://ziglang.org/learn/build-system/>
- Retained Maven, Gradle, CMake, Meson, Bazel, and Nix markers from their
  official project/build-file documentation:
  <https://maven.apache.org/pom.html>
  <https://maven.apache.org/tools/wrapper/index.html>
  <https://docs.gradle.org/current/userguide/settings_file_basics.html>
  <https://docs.gradle.org/current/userguide/command_line_interface.html>
  <https://cmake.org/cmake/help/latest/manual/cmake.1.html>
  <https://mesonbuild.com/Tutorial.html>
  <https://bazel.build/external/migration>
  <https://releases.nixos.org/nix/nix-2.25.5/manual/command-ref/new-cli/nix3-flake.html>
- No Wave 2 candidate required removal. The ambiguous-language boundaries in
  the catalog remain: build tools do not infer Java/Kotlin, C/C++, or a .NET
  language.

### 2026-08-23 Slice 3 implementation findings

- Added all 18 retained Wave 2 rules after the official-marker validation.
  PHP and Composer intentionally co-emit from their shared distinctive files;
  Dart and Flutter remain separate, with Flutter requiring both root markers.
- Added every exact marker, a corresponding exact-name near miss, positive and
  negative suffix boundaries for Ruby, .NET, and Haskell, and the incomplete
  versus complete Flutter composite cases.
- The registry remains data-only and still runs through the single root-read
  wrapper and existing warmed synthetic performance gate.
- Verification passed: `mise run test -- tests/stack.test.ts
tests/commands/ping.test.ts` (2 files, 158 tests), `mise run typecheck`, and
  `mise run format-check`.

### 2026-08-23 Slice 4 official-marker validation

- Retained framework config tags only where the filename is itself distinctive.
  Current official configuration references support the retained Next.js,
  Nuxt, Vite, Svelte, Astro, Angular, Vue CLI, Remix Classic, Gatsby, and Nest
  names:
  <https://nextjs.org/docs/pages/api-reference/config>
  <https://nuxt.com/docs/4.x/getting-started/configuration>
  <https://vite.dev/config/>
  <https://svelte.dev/docs/kit/configuration>
  <https://docs.astro.build/en/guides/configuring-astro/>
  <https://angular.dev/reference/configs/workspace-config>
  <https://cli.vuejs.org/config/>
  <https://v2.remix.run/docs/file-conventions/remix-config/>
  <https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/>
  <https://docs.nestjs.com/cli/monorepo>
- Removed undocumented extension variants from the candidate signals:
  `next.config.cjs`; `svelte.config.mjs`, `.cjs`, and `.ts`;
  `astro.config.cjs`; `vue.config.cjs`, `.mjs`, and `.ts`; and
  `remix.config.mjs`/`.cjs`. The retained tags still cover each technology, and
  Vite-backed modern Remix remains visible as `vite` unless the user supplies
  an explicit `remix` tag.
- Retained `nx.json`, `turbo.json`/`turbo.jsonc`, and the Laravel/Symfony
  composites after checking their official workspace and project contracts:
  <https://nx.dev/docs/reference/nx-json>
  <https://turborepo.com/docs/reference/configuration>
  <https://laravel.com/docs/structure>
  <https://symfony.com/doc/current/setup/flex.html>
- Retained the infrastructure markers after checking current official project
  or configuration references for Kustomize, Helm, Pulumi, Ansible, Dev
  Containers, Vagrant, Tilt, Serverless Framework, Firebase, and AWS CDK:
  <https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/>
  <https://helm.sh/docs/topics/charts/>
  <https://www.pulumi.com/docs/iac/concepts/projects/>
  <https://docs.ansible.com/projects/ansible/latest/reference_appendices/config.html>
  <https://containers.dev/supporting.html>
  <https://developer.hashicorp.com/vagrant/docs/vagrantfile>
  <https://docs.tilt.dev/tutorial.html>
  <https://wb.serverless.com/framework/docs-getting-started>
  <https://firebase.google.com/docs/cli>
  <https://docs.aws.amazon.com/cdk/v2/guide/projects.html>
- No technology tag was removed; only unsupported filename variants were
  discarded. Generic YAML and dependency-only frameworks remain explicit-only.

### 2026-08-23 Slice 4 implementation findings

- Added all 24 retained Wave 3 technology tags using 22 exact-name rules and
  the two planned composites. The complete registry now contains 57 unique,
  schema-valid tags.
- Added positives and nearby negatives for every retained Wave 3 filename,
  incomplete and complete Laravel/Symfony composites, and a representative
  polyglot root whose output remains stable when its input order is reversed.
- Added a complete-registry fixture that triggers every rule, proves no
  duplicate tag emission, and verifies the 32-tag cap both with and without an
  explicit tag. The warmed 50,000-entry gate now exercises all 57 rules and
  remains below 1,000 ms.
- Verification passed: `mise run test -- tests/stack.test.ts
tests/commands/ping.test.ts` (2 files, 243 tests), `mise run typecheck`, and
  `mise run format-check`.

### 2026-08-23 planning findings

- Current detector evidence and call path were verified in `src/stack.ts` and
  `src/commands/ping.ts`.
- Current stack validation is an arbitrary lowercase-token schema with a
  32-item maximum in `src/schemas.ts`; the local CLI does not use a tag enum.
- `tests/commands/ping.test.ts` is the only direct call-path coverage for
  `detectStackFromFilenames()`; a focused detector suite is needed.
- `README.md` states that inference happens when `--stack` is absent, while the
  implementation supplements explicit tags too. Preserve implementation
  behavior and clarify the docs.
- Official documentation confirmed the requested Docker, Swift Package, and
  Terraform markers and the TypeScript tsconfig correction.
- `../clankerlog` did not exist in this checkout environment, so no current
  backend or rendered-UI claim was made.
- Baseline `mise run test -- tests/commands/ping.test.ts` passed: one file and
  six tests.
- No implementation, full CI, build, or runtime dry-run was performed during
  this planning slice.

### 2026-08-23 performance follow-up

- Catalog expansion must keep a single `readdir` architecture; one existence
  check per marker would make latency grow with the catalog and is explicitly
  rejected.
- Slice 1 now includes both a deterministic one-I/O-call contract test and a
  warmed-up 50,000-entry synthetic matcher gate below 1,000 ms.
- Real filesystem latency is recorded during dogfood but is not a stable CI
  assertion. The contract prevents self-inflicted multi-second work while being
  honest about pathological or remote filesystems.

## Next Slice

Implement Slice 5. Update `README.md` and `docs/integrations.md` with the final
root-name-only privacy contract, supported automatic tags, Node.js/TypeScript
correction, supplement semantics, 32-tag behavior, and explicit-only escape
hatch. Inspect the available `../clankerlog` checkout for arbitrary-tag
ingestion and generic rendering evidence. Confirm the development shim still
targets this checkout's `src/cli.ts`, measure an informational local detection
duration, and run the source-backed dry-run from an allowed project.
Verify with:

```bash
mise run local-ci
mise run build
~/.local/bin/clankerlog-dev ping --dry-run --agent codex --model gpt-5.5
```

Inspect the dry-run payload and verify that no network request occurs. Leave the
shim itself unchanged.
