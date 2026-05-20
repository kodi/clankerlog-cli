import { Option, type Command } from "commander";
import { CliError } from "../errors.js";
import {
  getHookConfigStatus,
  type HookAgent,
  type HookConfigFileOptions,
  loadHookConfigFile,
  planInstallHook,
  resolveHookConfigPath,
  uninstallHookConfig,
  writeHookConfigFileAtomic,
} from "../hook-config.js";
import { formatHomePath } from "../path-display.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import {
  agentName,
  type HooksCommandGroups,
  type InstallOptions,
  writeLine,
} from "./install-shared.js";

export type { HooksCommandGroups } from "./install-shared.js";

interface ConfigAgentHooksCommand {
  readonly agent: HookAgent;
  readonly installDescription: string;
  readonly modelOptionDescription?: string | undefined;
  readonly statusDescription: string;
  readonly uninstallDescription: string;
}

export function registerConfigAgentHooksCommands(
  groups: HooksCommandGroups,
  config: ConfigAgentHooksCommand,
): void {
  const install = groups.install
    .command(config.agent)
    .description(config.installDescription)
    .option("--dry-run", "Show the hook config change without writing it");

  if (config.modelOptionDescription) {
    install.option("--model <model>", config.modelOptionDescription);
  }

  install
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallHook(config.agent, createRuntime(command), options);
    });

  groups.status
    .command(config.agent)
    .description(config.statusDescription)
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleHookStatus(config.agent, createRuntime(command), options);
    });

  groups.uninstall
    .command(config.agent)
    .description(config.uninstallDescription)
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallHook(config.agent, createRuntime(command), options);
    });
}

export async function handleInstallHook(
  agent: HookAgent,
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  if (agent === "claude" && !options.model?.trim()) {
    throw new CliError(
      "Claude Code hook install requires --model, for example `--model claude-sonnet-4.5` or `--model claude-opus-4.5`.",
    );
  }

  const fileOptions = toHookConfigFileOptions(options);
  const targetPath = resolveHookConfigPath(agent, fileOptions);
  const config = await loadHookConfigFile(targetPath, agent);
  const plan = planInstallHook(config, agent, fileOptions);

  writeLine(runtime, `Target: ${formatHomePath(targetPath)}`);
  if (plan.command) {
    writeLine(runtime, `Command: ${plan.command}`);
  }

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? `Action: would install ClankerLog ${agentName(agent)} Stop hook.`
        : `Action: ClankerLog ${agentName(agent)} Stop hook is already installed.`,
    );
    writeNextStep(runtime, agent);
    return;
  }

  if (plan.changed) {
    await writeHookConfigFileAtomic(targetPath, plan.config, agent);
    writeLine(runtime, `Action: installed ClankerLog ${agentName(agent)} Stop hook.`);
  } else {
    writeLine(runtime, `Action: ClankerLog ${agentName(agent)} Stop hook is already installed.`);
  }

  writeNextStep(runtime, agent);
}

export async function handleHookStatus(
  agent: HookAgent,
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const status = await getHookConfigStatus(agent, toHookConfigFileOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(status.targetPath)}`);
  writeLine(
    runtime,
    `Status: ${status.installed ? `ClankerLog ${agentName(agent)} Stop hook is installed.` : `ClankerLog ${agentName(agent)} Stop hook is not installed.`}`,
  );

  if (status.command) {
    writeLine(runtime, `Command: ${status.command}`);
    writeLine(runtime, `Command matches expected: ${status.commandMatchesExpected ? "yes" : "no"}`);
  }
}

export async function handleUninstallHook(
  agent: HookAgent,
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await uninstallHookConfig(agent, toHookConfigFileOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.targetPath)}`);
  if (plan.command) {
    writeLine(runtime, `Command: ${plan.command}`);
  }

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? `Action: would remove ClankerLog ${agentName(agent)} Stop hook.`
        : `Action: ClankerLog ${agentName(agent)} Stop hook is not installed.`,
    );
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? `Action: removed ClankerLog ${agentName(agent)} Stop hook.`
      : `Action: ClankerLog ${agentName(agent)} Stop hook is not installed.`,
  );
}

function toHookConfigFileOptions(options: InstallOptions): HookConfigFileOptions {
  return {
    configPath: options.hookConfig,
    dryRun: options.dryRun,
    model: options.model,
  };
}

function writeNextStep(runtime: CliRuntime, agent: HookAgent): void {
  if (agent === "codex") {
    writeLine(runtime, "Next: run /hooks in Codex if command approval is required.");
  }
}
