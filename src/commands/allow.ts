import type { Command } from "commander";
import {
  loadGlobalConfig,
  loadProjectConfig,
  resolveGlobalConfigPath,
  saveGlobalConfig,
} from "../config.js";
import { writeLine } from "../output.js";
import {
  defaultDisplayName,
  findAllowedProject,
  resolveProjectPath,
  upsertAllowedProject,
} from "../project.js";
import { createRuntime, type CliRuntime } from "../runtime.js";

export interface AllowOptions {
  readonly all?: boolean;
  readonly name?: string;
}

export function registerAllowCommand(program: Command): void {
  program
    .command("allow")
    .description("Allow the current project to send clanks.")
    .option("-a, --all", "Automatically track every project")
    .option("--name <name>", "Public display name for this project")
    .action(async (options: AllowOptions, command: Command) => {
      await handleAllow(options, createRuntime(command));
    });
}

export async function handleAllow(options: AllowOptions, runtime: CliRuntime): Promise<void> {
  const projectPath = await resolveProjectPath(runtime.cwd);
  const configPath = resolveGlobalConfigPath({ configPath: runtime.configPath, env: runtime.env });
  const config = await loadGlobalConfig(configPath);

  if (options.all) {
    if (config.autoTrackProjects) {
      writeLine(runtime, "Automatic project tracking is already enabled.");
      return;
    }

    await saveGlobalConfig(configPath, { ...config, autoTrackProjects: true });
    writeLine(runtime, "Automatic project tracking enabled.");
    return;
  }

  const existing = findAllowedProject(config, projectPath);

  if (existing) {
    writeLine(runtime, `Project already allowed: ${existing.path} -> ${existing.displayName}.`);
    return;
  }

  const projectConfig = await loadProjectConfig(projectPath);
  const displayName =
    options.name?.trim() || projectConfig?.displayName || defaultDisplayName(projectPath);

  await saveGlobalConfig(
    configPath,
    upsertAllowedProject(config, { displayName, path: projectPath }),
  );
  writeLine(runtime, `Allowed ${projectPath} -> ${displayName}.`);
}
