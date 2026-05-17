import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
  saveGlobalConfig,
  saveProjectConfig,
} from "../config.js";
import { writeLine } from "../output.js";
import { defaultDisplayName, resolveProjectPath, upsertAllowedProject } from "../project.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { parseStackValues } from "../stack.js";

export interface InitOptions {
  readonly name?: string;
  readonly stack?: string[];
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize ClankerLog for the current project.")
    .option("--name <name>", "Public display name for this project")
    .option("--stack <tags>", "Comma-separated stack tags", collectStack, [] as string[])
    .action(async (options: InitOptions, command: Command) => {
      await handleInit(options, createRuntime(command));
    });
}

function collectStack(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export async function handleInit(options: InitOptions, runtime: CliRuntime): Promise<void> {
  const projectPath = await resolveProjectPath(runtime.cwd);
  const displayName =
    options.name?.trim() || (await promptDisplayName(runtime, defaultDisplayName(projectPath)));
  const stack = parseStackValues(options.stack);
  const configPath = resolveGlobalConfigPath({ configPath: runtime.configPath, env: runtime.env });
  const config = await loadGlobalConfig(configPath);
  const nextConfig = upsertAllowedProject(config, { displayName, path: projectPath });

  await saveGlobalConfig(configPath, nextConfig);
  await saveProjectConfig(projectPath, stack.length > 0 ? { displayName, stack } : { displayName });

  writeLine(runtime, `Allowed ${projectPath} as ${displayName}.`);
  writeLine(runtime, "Wrote .clankerlog.json.");
}

async function promptDisplayName(runtime: CliRuntime, fallback: string): Promise<string> {
  const readline = createInterface({
    input: runtime.stdin,
    output: runtime.stdout,
  });

  try {
    const answer = (await readline.question(`Project display name (${fallback}): `)).trim();
    return answer || fallback;
  } finally {
    readline.close();
  }
}
