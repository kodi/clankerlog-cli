import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

const OMP_HOOK_MARKER = "clankerlog-omp-extension-v1";
const EXTENSION_FILE = "clankerlog.ts";

export interface OmpHookOptions {
  readonly dryRun?: boolean | undefined;
  readonly extensionPath?: string | undefined;
  readonly homeDirectory?: string | undefined;
}

export interface OmpHookPlan {
  readonly changed: boolean;
  readonly extensionPath: string;
  readonly summary: string;
}

export interface OmpHookStatus {
  readonly extensionMatchesExpected: boolean;
  readonly extensionPath: string;
  readonly installed: boolean;
}

export async function installOmpHook(options: OmpHookOptions = {}): Promise<OmpHookPlan> {
  const extensionPath = resolveOmpExtensionPath(options);
  const extension = buildOmpExtension();
  const status = await getOmpHookStatus(options);
  const changed = !status.extensionMatchesExpected;

  if (!options.dryRun && changed) {
    await mkdir(path.dirname(extensionPath), { recursive: true, mode: 0o700 });
    await writeFile(extensionPath, extension, { mode: 0o600 });
  }

  return {
    changed,
    extensionPath,
    summary: changed
      ? "Install ClankerLog omp agent_end extension."
      : "ClankerLog omp extension is already installed.",
  };
}

export async function uninstallOmpHook(options: OmpHookOptions = {}): Promise<OmpHookPlan> {
  const extensionPath = resolveOmpExtensionPath(options);

  if (!(await pathExists(extensionPath))) {
    return {
      changed: false,
      extensionPath,
      summary: "ClankerLog omp extension is not installed.",
    };
  }

  const status = await getOmpHookStatus(options);
  if (!status.extensionMatchesExpected) {
    throw new CliError(
      `Refusing to remove ${extensionPath} because it does not match the ClankerLog omp extension marker.`,
    );
  }

  if (!options.dryRun) {
    await rm(extensionPath);
  }

  return {
    changed: true,
    extensionPath,
    summary: "Remove ClankerLog omp extension.",
  };
}

export async function getOmpHookStatus(options: OmpHookOptions = {}): Promise<OmpHookStatus> {
  const extensionPath = resolveOmpExtensionPath(options);
  const extension = await readTextIfExists(extensionPath);
  const extensionMatchesExpected = extension === buildOmpExtension();

  return {
    extensionMatchesExpected,
    extensionPath,
    installed: extensionMatchesExpected,
  };
}

export function resolveOmpExtensionPath(options: OmpHookOptions = {}): string {
  return (
    options.extensionPath ??
    path.join(options.homeDirectory ?? homedir(), ".omp", "agent", "extensions", EXTENSION_FILE)
  );
}

export function buildOmpExtension(): string {
  return [
    `// ${OMP_HOOK_MARKER}`,
    'import { spawn } from "node:child_process";',
    'import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";',
    "",
    "export default function clankerlogOmpExtension(pi: ExtensionAPI): void {",
    '  pi.on("agent_end", async (_event, ctx) => {',
    "    await runClankerLog(ctx);",
    "  });",
    "}",
    "",
    "function runClankerLog(ctx: ExtensionContext): Promise<void> {",
    "  return new Promise((resolve) => {",
    "    const model = modelName(ctx.model) ?? process.env.CLANKERLOG_MODEL;",
    '    const args = ["ping", "--agent", "omp"];',
    "    if (model) {",
    '      args.push("--model", model);',
    "    }",
    "",
    '    const child = spawn("clankerlog", args, {',
    "      cwd: ctx.cwd || process.cwd(),",
    "      env: {",
    "        ...process.env,",
    '        CLANKERLOG_AGENT: process.env.CLANKERLOG_AGENT ?? "omp",',
    "        ...(model ? { CLANKERLOG_MODEL: model } : {}),",
    "      },",
    '      stdio: ["ignore", "ignore", "ignore"],',
    "    });",
    "",
    '    child.on("error", () => resolve());',
    '    child.on("close", () => resolve());',
    "  });",
    "}",
    "",
    'function modelName(model: ExtensionContext["model"]): string | undefined {',
    "  if (!model) {",
    "    return undefined;",
    "  }",
    "",
    '  if (typeof model.id === "string" && model.id.trim()) {',
    "    return model.id;",
    "  }",
    "",
    '  if (typeof model.name === "string" && model.name.trim()) {',
    "    return model.name;",
    "  }",
    "",
    "  return undefined;",
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

    throw new CliError(`Could not read omp extension at ${filePath}: ${formatCause(error)}.`);
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
