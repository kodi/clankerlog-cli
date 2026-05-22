import type { Command } from "commander";
import type { HookAgent } from "../hook-config.js";
import type { CliRuntime } from "../runtime.js";

export interface HooksCommandGroups {
  readonly install: Command;
  readonly status: Command;
  readonly uninstall: Command;
}

export interface InstallOptions {
  readonly dryRun?: boolean | undefined;
  readonly extensionPath?: string | undefined;
  readonly hookConfig?: string | undefined;
  readonly hookDir?: string | undefined;
  readonly model?: string | undefined;
  readonly pluginPath?: string | undefined;
}

export function writeLine(runtime: CliRuntime, line: string): void {
  runtime.stdout.write(`${line}\n`);
}

export function agentName(agent: HookAgent): string {
  if (agent === "claude") {
    return "Claude Code";
  }

  if (agent === "cursor") {
    return "Cursor";
  }

  if (agent === "hermes") {
    return "Hermes";
  }

  if (agent === "topchester") {
    return "Topchester";
  }

  return "Codex";
}
