import { Option, type Command } from "commander";
import {
  getOpencodeHookStatus,
  installOpencodeHook,
  type OpencodeHookOptions,
  uninstallOpencodeHook,
} from "../opencode-hook.js";
import { formatHomePath } from "../path-display.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { type HooksCommandGroups, type InstallOptions, writeLine } from "./install-shared.js";

export function registerOpencodeHooksCommands(groups: HooksCommandGroups): void {
  groups.install
    .command("opencode")
    .description("Install the Opencode session.idle plugin.")
    .option("--dry-run", "Show the plugin file that would be written without writing it")
    .addOption(new Option("--plugin-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallOpencodeHook(createRuntime(command), options);
    });

  groups.status
    .command("opencode")
    .description("Inspect the Opencode session.idle plugin.")
    .addOption(new Option("--plugin-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleOpencodeHookStatus(createRuntime(command), options);
    });

  groups.uninstall
    .command("opencode")
    .description("Remove the Opencode session.idle plugin.")
    .option("--dry-run", "Show the plugin file removal without deleting it")
    .addOption(new Option("--plugin-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallOpencodeHook(createRuntime(command), options);
    });
}

export async function handleInstallOpencodeHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await installOpencodeHook(toOpencodeHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.pluginPath)}`);
  writeLine(runtime, "Files: clankerlog.ts");
  writeLine(runtime, "Command: clankerlog ping --agent opencode --model <active Opencode model>");

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would install ClankerLog Opencode session.idle plugin."
        : "Action: ClankerLog Opencode plugin is already installed.",
    );
    writeOpencodeNextStep(runtime);
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: installed ClankerLog Opencode session.idle plugin."
      : "Action: ClankerLog Opencode plugin is already installed.",
  );
  writeOpencodeNextStep(runtime);
}

export async function handleOpencodeHookStatus(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const status = await getOpencodeHookStatus(toOpencodeHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(status.pluginPath)}`);
  writeLine(
    runtime,
    `Status: ${status.installed ? "ClankerLog Opencode plugin is installed." : "ClankerLog Opencode plugin is not installed."}`,
  );
  writeLine(runtime, `Plugin matches expected: ${status.pluginMatchesExpected ? "yes" : "no"}`);
}

export async function handleUninstallOpencodeHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await uninstallOpencodeHook(toOpencodeHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.pluginPath)}`);

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would remove ClankerLog Opencode plugin."
        : "Action: ClankerLog Opencode plugin is not installed.",
    );
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: removed ClankerLog Opencode plugin."
      : "Action: ClankerLog Opencode plugin is not installed.",
  );
}

function toOpencodeHookOptions(options: InstallOptions): OpencodeHookOptions {
  return {
    dryRun: options.dryRun,
    pluginPath: options.pluginPath,
  };
}

function writeOpencodeNextStep(runtime: CliRuntime): void {
  writeLine(runtime, "Next: restart Opencode so it loads the ClankerLog plugin.");
}
