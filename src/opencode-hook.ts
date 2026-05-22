import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

const OPENCODE_PLUGIN_MARKER = "clankerlog-opencode-plugin-v1";
const PLUGIN_FILE = "clankerlog.ts";

export interface OpencodeHookOptions {
  readonly dryRun?: boolean | undefined;
  readonly homeDirectory?: string | undefined;
  readonly pluginPath?: string | undefined;
}

export interface OpencodeHookPlan {
  readonly changed: boolean;
  readonly pluginPath: string;
  readonly summary: string;
}

export interface OpencodeHookStatus {
  readonly installed: boolean;
  readonly pluginMatchesExpected: boolean;
  readonly pluginPath: string;
}

export async function installOpencodeHook(
  options: OpencodeHookOptions = {},
): Promise<OpencodeHookPlan> {
  const pluginPath = resolveOpencodePluginPath(options);
  const plugin = buildOpencodePlugin();
  const status = await getOpencodeHookStatus(options);
  const changed = !status.pluginMatchesExpected;

  if (!options.dryRun && changed) {
    await mkdir(path.dirname(pluginPath), { recursive: true, mode: 0o700 });
    await writeFile(pluginPath, plugin, { mode: 0o600 });
  }

  return {
    changed,
    pluginPath,
    summary: changed
      ? "Install ClankerLog Opencode session.idle plugin."
      : "ClankerLog Opencode plugin is already installed.",
  };
}

export async function uninstallOpencodeHook(
  options: OpencodeHookOptions = {},
): Promise<OpencodeHookPlan> {
  const pluginPath = resolveOpencodePluginPath(options);

  if (!(await pathExists(pluginPath))) {
    return {
      changed: false,
      pluginPath,
      summary: "ClankerLog Opencode plugin is not installed.",
    };
  }

  const status = await getOpencodeHookStatus(options);
  if (!status.pluginMatchesExpected) {
    throw new CliError(
      `Refusing to remove ${pluginPath} because it does not match the ClankerLog Opencode plugin marker.`,
    );
  }

  if (!options.dryRun) {
    await rm(pluginPath);
  }

  return {
    changed: true,
    pluginPath,
    summary: "Remove ClankerLog Opencode plugin.",
  };
}

export async function getOpencodeHookStatus(
  options: OpencodeHookOptions = {},
): Promise<OpencodeHookStatus> {
  const pluginPath = resolveOpencodePluginPath(options);
  const plugin = await readTextIfExists(pluginPath);
  const pluginMatchesExpected = plugin === buildOpencodePlugin();

  return {
    installed: pluginMatchesExpected,
    pluginMatchesExpected,
    pluginPath,
  };
}

export function resolveOpencodePluginPath(options: OpencodeHookOptions = {}): string {
  return (
    options.pluginPath ??
    path.join(options.homeDirectory ?? homedir(), ".config", "opencode", "plugins", PLUGIN_FILE)
  );
}

export function buildOpencodePlugin(): string {
  return [
    `// ${OPENCODE_PLUGIN_MARKER}`,
    'import { spawn } from "node:child_process";',
    "",
    "type AssistantMessageInfo = {",
    "  id?: string;",
    "  role?: string;",
    "  sessionID?: string;",
    "  error?: unknown;",
    "  modelID?: string;",
    "  providerID?: string;",
    "  path?: { cwd?: string; root?: string };",
    "};",
    "",
    "type OpencodeEvent = {",
    "  type?: string;",
    "  properties?: {",
    "    sessionID?: string;",
    "    info?: AssistantMessageInfo;",
    "  };",
    "};",
    "",
    "type PluginContext = {",
    "  directory?: string;",
    "  worktree?: string;",
    "};",
    "",
    "type SessionMetadata = {",
    "  cwd: string;",
    "  messageID: string;",
    "  model: string;",
    "};",
    "",
    "export const ClankerLogPlugin = async ({ directory, worktree }: PluginContext) => {",
    "  const latestBySession = new Map<string, SessionMetadata>();",
    "  const sentKeys = new Set<string>();",
    "",
    "  return {",
    "    event: async ({ event }: { event: OpencodeEvent }) => {",
    '      if (event.type === "message.updated") {',
    "        const info = event.properties?.info;",
    '        if (info?.role === "assistant" && !info.error) {',
    "          const sessionID = stringFrom(info.sessionID);",
    "          const messageID = stringFrom(info.id);",
    "          const model = modelName(info) ?? stringFrom(process.env.CLANKERLOG_MODEL);",
    "          const cwd =",
    "            stringFrom(info.path?.cwd) ??",
    "            stringFrom(info.path?.root) ??",
    "            stringFrom(worktree) ??",
    "            stringFrom(directory) ??",
    "            process.cwd();",
    "",
    "          if (sessionID && messageID && model) {",
    "            latestBySession.set(sessionID, { cwd, messageID, model });",
    "          }",
    "        }",
    "      }",
    "",
    '      if (event.type !== "session.idle") {',
    "        return;",
    "      }",
    "",
    "      const sessionID = stringFrom(event.properties?.sessionID);",
    "      if (!sessionID) {",
    "        return;",
    "      }",
    "",
    "      const metadata = latestBySession.get(sessionID);",
    "      if (!metadata) {",
    "        return;",
    "      }",
    "",
    "      const sentKey = `${sessionID}:${metadata.messageID}`;",
    "      if (sentKeys.has(sentKey)) {",
    "        return;",
    "      }",
    "      sentKeys.add(sentKey);",
    "",
    "      await runClankerLog(metadata);",
    "    },",
    "  };",
    "};",
    "",
    "function runClankerLog(metadata: SessionMetadata): Promise<void> {",
    "  return new Promise((resolve) => {",
    '    const child = spawn("clankerlog", ["ping", "--agent", "opencode", "--model", metadata.model], {',
    "      cwd: metadata.cwd,",
    "      env: {",
    "        ...process.env,",
    '        CLANKERLOG_AGENT: process.env.CLANKERLOG_AGENT ?? "opencode",',
    "        CLANKERLOG_MODEL: process.env.CLANKERLOG_MODEL ?? metadata.model,",
    "      },",
    '      stdio: ["ignore", "ignore", "ignore"],',
    "    });",
    "",
    "    const timer = setTimeout(() => {",
    "      child.kill();",
    "      resolve();",
    "    }, 10_000);",
    "",
    '    child.on("error", () => {',
    "      clearTimeout(timer);",
    "      resolve();",
    "    });",
    "",
    '    child.on("close", () => {',
    "      clearTimeout(timer);",
    "      resolve();",
    "    });",
    "  });",
    "}",
    "",
    "function modelName(info: AssistantMessageInfo): string | undefined {",
    "  const providerID = stringFrom(info.providerID);",
    "  const modelID = stringFrom(info.modelID);",
    "",
    "  if (providerID && modelID) {",
    '    return modelID.includes("/") ? modelID : `${providerID}/${modelID}`;',
    "  }",
    "",
    "  return modelID;",
    "}",
    "",
    "function stringFrom(value: unknown): string | undefined {",
    '  return typeof value === "string" && value.trim() ? value : undefined;',
    "}",
    "",
  ].join("\n");
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw new CliError(`Could not read Opencode plugin at ${filePath}: ${formatCause(error)}.`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
