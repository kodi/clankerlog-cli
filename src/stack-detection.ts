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
  { tag: "typescript", anyOf: [{ exact: "package.json" }] },
  { tag: "pnpm", anyOf: [{ exact: "pnpm-lock.yaml" }] },
  { tag: "go", anyOf: [{ exact: "go.mod" }] },
  { tag: "rust", anyOf: [{ exact: "Cargo.toml" }] },
  { tag: "python", anyOf: [{ exact: "pyproject.toml" }] },
  { tag: "deno", anyOf: [{ exact: "deno.json" }] },
  {
    tag: "cloudflare",
    anyOf: [{ exact: "wrangler.jsonc" }, { exact: "wrangler.toml" }],
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
