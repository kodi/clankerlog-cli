import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CliError } from "./errors.js";

const execFileAsync = promisify(execFile);

const HOOK_MARKER = "clankerlog-openclaw-hook-v1";
const HOOK_MD_FILE = "HOOK.md";
const HANDLER_FILE = "handler.ts";

export interface OpenClawHookOptions {
  readonly dryRun?: boolean | undefined;
  readonly hookDir?: string | undefined;
  readonly homeDirectory?: string | undefined;
  readonly inspectOpenClawCli?: boolean | undefined;
}

export interface OpenClawHookPlan {
  readonly changed: boolean;
  readonly hookDir: string;
  readonly hookMdPath: string;
  readonly handlerPath: string;
  readonly summary: string;
}

export interface OpenClawHookStatus {
  readonly discoveredByOpenClaw?: boolean | undefined;
  readonly enabledByOpenClaw?: boolean | undefined;
  readonly handlerMatchesExpected: boolean;
  readonly handlerPath: string;
  readonly hookDir: string;
  readonly hookMdMatchesExpected: boolean;
  readonly hookMdPath: string;
  readonly installed: boolean;
  readonly openClawCliAvailable: boolean;
}

export async function installOpenClawHook(
  options: OpenClawHookOptions = {},
): Promise<OpenClawHookPlan> {
  const hookDir = resolveOpenClawHookDir(options);
  const hookMdPath = path.join(hookDir, HOOK_MD_FILE);
  const handlerPath = path.join(hookDir, HANDLER_FILE);
  const hookMd = buildOpenClawHookMd();
  const handler = buildOpenClawHandler();
  const existing = await getOpenClawHookStatus({ ...options, inspectOpenClawCli: false });
  const changed = !(existing.hookMdMatchesExpected && existing.handlerMatchesExpected);

  if (!options.dryRun && changed) {
    await mkdir(hookDir, { recursive: true, mode: 0o700 });
    await writeFile(hookMdPath, hookMd, { mode: 0o600 });
    await writeFile(handlerPath, handler, { mode: 0o600 });
  }

  return {
    changed,
    handlerPath,
    hookDir,
    hookMdPath,
    summary: changed
      ? "Install ClankerLog OpenClaw message:sent hook."
      : "ClankerLog OpenClaw hook is already installed.",
  };
}

export async function uninstallOpenClawHook(
  options: OpenClawHookOptions = {},
): Promise<OpenClawHookPlan> {
  const hookDir = resolveOpenClawHookDir(options);
  const hookMdPath = path.join(hookDir, HOOK_MD_FILE);
  const handlerPath = path.join(hookDir, HANDLER_FILE);

  if (!(await pathExists(hookDir))) {
    return {
      changed: false,
      handlerPath,
      hookDir,
      hookMdPath,
      summary: "ClankerLog OpenClaw hook is not installed.",
    };
  }

  const status = await getOpenClawHookStatus({ ...options, inspectOpenClawCli: false });
  const directoryMatchesExpected = await openClawHookDirectoryMatchesExpected(hookDir);
  if (
    !directoryMatchesExpected ||
    !status.hookMdMatchesExpected ||
    !status.handlerMatchesExpected
  ) {
    throw new CliError(
      `Refusing to remove ${hookDir} because it does not match the ClankerLog OpenClaw hook markers.`,
    );
  }

  if (!options.dryRun) {
    await rm(hookDir, { recursive: true });
  }

  return {
    changed: true,
    handlerPath,
    hookDir,
    hookMdPath,
    summary: "Remove ClankerLog OpenClaw hook.",
  };
}

export async function getOpenClawHookStatus(
  options: OpenClawHookOptions = {},
): Promise<OpenClawHookStatus> {
  const hookDir = resolveOpenClawHookDir(options);
  const hookMdPath = path.join(hookDir, HOOK_MD_FILE);
  const handlerPath = path.join(hookDir, HANDLER_FILE);
  const [hookMd, handler] = await Promise.all([
    readTextIfExists(hookMdPath),
    readTextIfExists(handlerPath),
  ]);
  const openClawStatus =
    options.inspectOpenClawCli === false ? undefined : await inspectOpenClawCli();

  return {
    discoveredByOpenClaw: openClawStatus?.discovered,
    enabledByOpenClaw: openClawStatus?.enabled,
    handlerMatchesExpected: handler === buildOpenClawHandler(),
    handlerPath,
    hookDir,
    hookMdMatchesExpected: hookMd === buildOpenClawHookMd(),
    hookMdPath,
    installed: hookMd === buildOpenClawHookMd() && handler === buildOpenClawHandler(),
    openClawCliAvailable: openClawStatus !== undefined,
  };
}

export function resolveOpenClawHookDir(options: OpenClawHookOptions = {}): string {
  return (
    options.hookDir ??
    path.join(options.homeDirectory ?? homedir(), ".openclaw", "hooks", "clankerlog")
  );
}

export function buildOpenClawHookMd(): string {
  return [
    "---",
    "name: clankerlog",
    'description: "Send a ClankerLog clank after successful OpenClaw outbound messages"',
    "metadata:",
    "  openclaw:",
    '    events: ["message:sent"]',
    "    requires:",
    '      bins: ["clankerlog"]',
    "---",
    "",
    `<!-- ${HOOK_MARKER} -->`,
    "",
    "Runs after successful OpenClaw outbound messages and sends one privacy-preserving ClankerLog clank.",
    "The handler does not read or forward message content, transcripts, prompts, source code, diffs, terminal output, or secrets.",
    "",
  ].join("\n");
}

export function buildOpenClawHandler(): string {
  return [
    `// ${HOOK_MARKER}`,
    'import { spawn } from "node:child_process";',
    "",
    "export default async function handler(event: OpenClawHookEvent): Promise<void> {",
    '  if (event.type !== "message" || event.action !== "sent") {',
    "    return;",
    "  }",
    "",
    "  if (event.context?.success !== true) {",
    "    return;",
    "  }",
    "",
    "  const payload = {",
    "    model: stringFrom(process.env.CLANKERLOG_MODEL),",
    "    success: true,",
    "    workspaceDir:",
    "      stringFrom(event.context.workspaceDir) ??",
    "      stringFrom(process.env.CLANKERLOG_WORKSPACE_DIR) ??",
    "      process.cwd(),",
    "  };",
    "",
    "  await runClankerLog(payload);",
    "}",
    "",
    "function runClankerLog(payload: OpenClawMessageSentPayload): Promise<void> {",
    "  return new Promise((resolve) => {",
    '    const child = spawn("clankerlog", ["hook", "openclaw", "message-sent"], {',
    "      env: process.env,",
    '      stdio: ["pipe", "ignore", "ignore"],',
    "    });",
    "",
    '    child.on("error", () => resolve());',
    '    child.on("close", () => resolve());',
    '    child.stdin.on("error", () => resolve());',
    "",
    "    try {",
    "      child.stdin.end(`${JSON.stringify(payload)}\\n`);",
    "    } catch {",
    "      resolve();",
    "    }",
    "  });",
    "}",
    "",
    "function stringFrom(value: unknown): string | undefined {",
    '  return typeof value === "string" && value.trim() ? value : undefined;',
    "}",
    "",
    "interface OpenClawHookEvent {",
    "  readonly action?: string;",
    "  readonly context?: {",
    "    readonly success?: boolean;",
    "    readonly workspaceDir?: unknown;",
    "  };",
    "  readonly type?: string;",
    "}",
    "",
    "interface OpenClawMessageSentPayload {",
    "  readonly model?: string;",
    "  readonly success: true;",
    "  readonly workspaceDir: string;",
    "}",
    "",
  ].join("\n");
}

async function inspectOpenClawCli(): Promise<
  { readonly discovered: boolean; readonly enabled: boolean } | undefined
> {
  try {
    const { stdout } = await execFileAsync("openclaw", ["hooks", "list"], { timeout: 7000 });
    const text = stdout.toString();
    return {
      discovered: /\bclankerlog\b/.test(text),
      enabled: /\bclankerlog\b.*\b(enabled|active|on)\b/i.test(text),
    };
  } catch {
    return undefined;
  }
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw new CliError(`Could not read OpenClaw hook file at ${filePath}: ${formatCause(error)}.`);
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

async function openClawHookDirectoryMatchesExpected(hookDir: string): Promise<boolean> {
  try {
    const entries = await readdir(hookDir);
    return entries.length === 2 && entries.includes(HOOK_MD_FILE) && entries.includes(HANDLER_FILE);
  } catch (error) {
    throw new CliError(
      `Could not inspect OpenClaw hook directory at ${hookDir}: ${formatCause(error)}.`,
    );
  }
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
