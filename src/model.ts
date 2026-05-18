const providerPrefixPattern = /^[a-z0-9][a-z0-9._-]*\//u;

const canonicalModelNames = [
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o4-mini",
  "o3",
  "o3-mini",
  "o1",
  "o1-mini",
  "claude-opus-4.7",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-sonnet-4",
  "claude-3.7-sonnet",
  "claude-3.5-sonnet",
  "claude-3.5-haiku",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "gemini-3.1-pro",
  "gemini-3-pro",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "deepseek-v3.2",
  "deepseek-v3.1",
  "deepseek-r1",
  "qwen3-coder",
  "qwen3-max",
  "qwen3-vl",
  "qwen3-235b-a22b",
  "grok-4",
  "grok-4-fast",
  "grok-3",
  "grok-3-mini",
  "mistral-large",
  "mistral-medium",
  "codestral",
  "magistral-medium",
  "llama-4-maverick",
  "llama-4-scout",
  "llama-3.3-70b-instruct",
  "llama-3.1-405b-instruct",
  "kimi-k2",
] as const;

const manualAliases = new Map<string, string>([
  ["opus4.7", "claude-opus-4.7"],
  ["opus-4-7", "claude-opus-4.7"],
  ["opus 4.7", "claude-opus-4.7"],
  ["claude opus 4.7", "claude-opus-4.7"],
  ["opus4.6", "claude-opus-4.6"],
  ["sonnet4.6", "claude-sonnet-4.6"],
  ["sonnet-4-6", "claude-sonnet-4.6"],
  ["claude sonnet 4.6", "claude-sonnet-4.6"],
  ["sonnet4.5", "claude-sonnet-4.5"],
  ["sonnet 4", "claude-sonnet-4"],
  ["haiku3.5", "claude-3.5-haiku"],
  ["claude haiku 3.5", "claude-3.5-haiku"],
  ["gemini pro 3.1", "gemini-3.1-pro"],
  ["gemini flash 2.5", "gemini-2.5-flash"],
  ["deepseek r1", "deepseek-r1"],
  ["deepseek v3.2", "deepseek-v3.2"],
  ["qwen coder 3", "qwen3-coder"],
  ["qwen3 coder", "qwen3-coder"],
  ["grok fast 4", "grok-4-fast"],
  ["mistral large", "mistral-large"],
  ["mistral medium", "mistral-medium"],
  ["llama 4 maverick", "llama-4-maverick"],
  ["llama 4 scout", "llama-4-scout"],
]);

const knownModelNames = new Map<string, string>();

for (const modelName of canonicalModelNames) {
  knownModelNames.set(modelKey(modelName), modelName);
}

for (const [alias, modelName] of manualAliases) {
  knownModelNames.set(modelKey(alias), modelName);
}

export function normalizeModelName(value: string): string {
  const trimmed = value.trim();
  const normalized = knownModelNames.get(modelKey(trimmed));

  return normalized ?? trimmed;
}

function modelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(providerPrefixPattern, "")
    .replace(/[^a-z0-9]+/gu, "");
}
