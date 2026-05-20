import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

const PI_HOOK_MARKER = "clankerlog-pi-extension-v1";
const EXTENSION_FILE = "clankerlog.ts";

export interface PiHookOptions {
  readonly dryRun?: boolean | undefined;
  readonly extensionPath?: string | undefined;
  readonly homeDirectory?: string | undefined;
}

export interface PiHookPlan {
  readonly changed: boolean;
  readonly extensionPath: string;
  readonly summary: string;
}

export interface PiHookStatus {
  readonly extensionMatchesExpected: boolean;
  readonly extensionPath: string;
  readonly installed: boolean;
}

export async function installPiHook(options: PiHookOptions = {}): Promise<PiHookPlan> {
  const extensionPath = resolvePiExtensionPath(options);
  const extension = buildPiExtension();
  const status = await getPiHookStatus(options);
  const changed = !status.extensionMatchesExpected;

  if (!options.dryRun && changed) {
    await mkdir(path.dirname(extensionPath), { recursive: true, mode: 0o700 });
    await writeFile(extensionPath, extension, { mode: 0o600 });
  }

  return {
    changed,
    extensionPath,
    summary: changed
      ? "Install ClankerLog Pi agent_end extension."
      : "ClankerLog Pi extension is already installed.",
  };
}

export async function uninstallPiHook(options: PiHookOptions = {}): Promise<PiHookPlan> {
  const extensionPath = resolvePiExtensionPath(options);

  if (!(await pathExists(extensionPath))) {
    return {
      changed: false,
      extensionPath,
      summary: "ClankerLog Pi extension is not installed.",
    };
  }

  const status = await getPiHookStatus(options);
  if (!status.extensionMatchesExpected) {
    throw new CliError(
      `Refusing to remove ${extensionPath} because it does not match the ClankerLog Pi extension marker.`,
    );
  }

  if (!options.dryRun) {
    await rm(extensionPath);
  }

  return {
    changed: true,
    extensionPath,
    summary: "Remove ClankerLog Pi extension.",
  };
}

export async function getPiHookStatus(options: PiHookOptions = {}): Promise<PiHookStatus> {
  const extensionPath = resolvePiExtensionPath(options);
  const extension = await readTextIfExists(extensionPath);
  const extensionMatchesExpected = extension === buildPiExtension();

  return {
    extensionMatchesExpected,
    extensionPath,
    installed: extensionMatchesExpected,
  };
}

export function resolvePiExtensionPath(options: PiHookOptions = {}): string {
  return (
    options.extensionPath ??
    path.join(options.homeDirectory ?? homedir(), ".pi", "agent", "extensions", EXTENSION_FILE)
  );
}

export function buildPiExtension(): string {
  return [
    `// ${PI_HOOK_MARKER}`,
    'import { spawn } from "node:child_process";',
    'import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";',
    "",
    "export default function clankerlogPiExtension(pi: ExtensionAPI): void {",
    '  pi.on("agent_end", async (_event, ctx) => {',
    "    await runClankerLog(ctx);",
    "  });",
    "}",
    "",
    "function runClankerLog(ctx: ExtensionContext): Promise<void> {",
    "  return new Promise((resolve) => {",
    "    const model = modelName(ctx.model) ?? process.env.CLANKERLOG_MODEL;",
    '    const args = ["ping", "--agent", "pi"];',
    "    if (model) {",
    '      args.push("--model", model);',
    "    }",
    "",
    '    const child = spawn("clankerlog", args, {',
    "      cwd: ctx.cwd || process.cwd(),",
    "      env: {",
    "        ...process.env,",
    '        CLANKERLOG_AGENT: process.env.CLANKERLOG_AGENT ?? "pi",',
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
    '  if (typeof model.name === "string" && model.name.trim()) {',
    "    return model.name;",
    "  }",
    "",
    '  if (typeof model.id === "string" && model.id.trim()) {',
    "    return model.id;",
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

    throw new CliError(`Could not read Pi extension at ${filePath}: ${formatCause(error)}.`);
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
