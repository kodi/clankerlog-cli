import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveGlobalConfigPath } from "../config.js";
import type { CliRuntime } from "../runtime.js";

interface ClaudeSessionModelEntry {
  readonly model: string;
  readonly updatedAt: string;
}

interface ClaudeSessionModelStore {
  readonly version: 1;
  readonly sessions: Record<string, ClaudeSessionModelEntry>;
}

const MAX_SESSION_MODEL_ENTRIES = 500;

export async function saveClaudeSessionModel(
  runtime: CliRuntime,
  sessionId: string,
  model: string,
): Promise<void> {
  const normalizedModel = normalizeSessionModel(model);
  if (!normalizedModel) {
    return;
  }

  const filePath = resolveClaudeSessionModelsPath(runtime);
  const store = await loadClaudeSessionModelStore(filePath);
  const sessions = {
    ...store.sessions,
    [sessionId]: {
      model: normalizedModel,
      updatedAt: new Date().toISOString(),
    },
  };

  await writeClaudeSessionModelStore(filePath, {
    version: 1,
    sessions: pruneSessionModelEntries(sessions),
  });
}

export async function loadClaudeSessionModel(
  runtime: CliRuntime,
  sessionId: string,
): Promise<string | undefined> {
  const store = await loadClaudeSessionModelStore(resolveClaudeSessionModelsPath(runtime));
  return store.sessions[sessionId]?.model;
}

export function resolveClaudeSessionModelsPath(runtime: CliRuntime): string {
  const configPath = resolveGlobalConfigPath({
    configPath: runtime.configPath,
    env: runtime.env,
  });
  return path.join(path.dirname(configPath), "claude-sessions.json");
}

async function loadClaudeSessionModelStore(filePath: string): Promise<ClaudeSessionModelStore> {
  if (!(await fileExists(filePath))) {
    return { version: 1, sessions: {} };
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { version: 1, sessions: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ClaudeSessionModelStore>;
    if (parsed.version !== 1 || !isPlainObject(parsed.sessions)) {
      return { version: 1, sessions: {} };
    }

    const sessions: Record<string, ClaudeSessionModelEntry> = {};
    for (const [sessionId, entry] of Object.entries(parsed.sessions)) {
      if (!isPlainObject(entry)) {
        continue;
      }
      const model = normalizeSessionModel(entry.model);
      if (!model) {
        continue;
      }
      sessions[sessionId] = {
        model,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      };
    }

    return { version: 1, sessions };
  } catch {
    return { version: 1, sessions: {} };
  }
}

async function writeClaudeSessionModelStore(
  filePath: string,
  store: ClaudeSessionModelStore,
): Promise<void> {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function pruneSessionModelEntries(
  sessions: Record<string, ClaudeSessionModelEntry>,
): Record<string, ClaudeSessionModelEntry> {
  const entries = Object.entries(sessions).sort(
    ([, left], [, right]) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt),
  );
  return Object.fromEntries(entries.slice(0, MAX_SESSION_MODEL_ENTRIES));
}

function normalizeSessionModel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
