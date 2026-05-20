import { Option, type Command } from "commander";
import { formatHomePath } from "../path-display.js";
import { getPiHookStatus, installPiHook, type PiHookOptions, uninstallPiHook } from "../pi-hook.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { type HooksCommandGroups, type InstallOptions, writeLine } from "./install-shared.js";

export function registerPiHooksCommands(groups: HooksCommandGroups): void {
  groups.install
    .command("pi")
    .description("Install the Pi agent_end extension.")
    .option("--dry-run", "Show the extension file that would be written without writing it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallPiHook(createRuntime(command), options);
    });

  groups.status
    .command("pi")
    .description("Inspect the Pi agent_end extension.")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handlePiHookStatus(createRuntime(command), options);
    });

  groups.uninstall
    .command("pi")
    .description("Remove the Pi agent_end extension.")
    .option("--dry-run", "Show the extension file removal without deleting it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallPiHook(createRuntime(command), options);
    });
}

export async function handleInstallPiHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await installPiHook(toPiHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.extensionPath)}`);
  writeLine(runtime, `Files: ${PI_FILE_LIST}`);
  writeLine(runtime, "Command: clankerlog ping --agent pi --model <active Pi model>");

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would install ClankerLog Pi agent_end extension."
        : "Action: ClankerLog Pi extension is already installed.",
    );
    writePiNextStep(runtime);
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: installed ClankerLog Pi agent_end extension."
      : "Action: ClankerLog Pi extension is already installed.",
  );
  writePiNextStep(runtime);
}

export async function handlePiHookStatus(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const status = await getPiHookStatus(toPiHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(status.extensionPath)}`);
  writeLine(
    runtime,
    `Status: ${status.installed ? "ClankerLog Pi extension is installed." : "ClankerLog Pi extension is not installed."}`,
  );
  writeLine(
    runtime,
    `Extension matches expected: ${status.extensionMatchesExpected ? "yes" : "no"}`,
  );
}

export async function handleUninstallPiHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await uninstallPiHook(toPiHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.extensionPath)}`);

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would remove ClankerLog Pi extension."
        : "Action: ClankerLog Pi extension is not installed.",
    );
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: removed ClankerLog Pi extension."
      : "Action: ClankerLog Pi extension is not installed.",
  );
}

function toPiHookOptions(options: InstallOptions): PiHookOptions {
  return {
    dryRun: options.dryRun,
    extensionPath: options.extensionPath,
  };
}

function writePiNextStep(runtime: CliRuntime): void {
  writeLine(runtime, "Next: run `/reload` in Pi if an existing Pi session is already open.");
}

const PI_FILE_LIST = "clankerlog.ts";
