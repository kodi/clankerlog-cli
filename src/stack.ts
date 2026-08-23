import { readdir } from "node:fs/promises";
import { stackSchema } from "./schemas.js";
import {
  detectStackFromEntries,
  stackDetectionRules,
  type StackDetectionRule,
} from "./stack-detection.js";

const maximumStackTags = 32;

export type DirectoryReader = (projectPath: string) => Promise<readonly string[]>;

export function parseStackValues(values: readonly string[] | undefined): string[] {
  const stack = values
    ?.flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return stackSchema.parse(stack ?? []);
}

export async function detectStackFromFilenames(
  projectPath: string,
  readDirectory: DirectoryReader = readdir,
  rules: readonly StackDetectionRule[] = stackDetectionRules,
): Promise<string[]> {
  return detectStackFromEntries(await readDirectory(projectPath), rules);
}

export function uniqueStack(values: readonly string[]): string[] {
  return stackSchema.parse([...new Set(values)]);
}

export function mergeStack(
  explicit: readonly string[],
  detected: readonly string[],
  max = maximumStackTags,
): string[] {
  const merged = uniqueStack(explicit);
  const seen = new Set(merged);

  for (const tag of detected) {
    if (merged.length >= max) {
      break;
    }

    if (!seen.has(tag)) {
      merged.push(tag);
      seen.add(tag);
    }
  }

  return stackSchema.parse(merged);
}
