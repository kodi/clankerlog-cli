import { stackSchema } from "./schemas.js";

export function parseStackValues(values: readonly string[] | undefined): string[] {
  const stack = values
    ?.flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return stackSchema.parse(stack ?? []);
}
