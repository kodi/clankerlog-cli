import { Option, type Command } from "commander";
import { formatHomePath } from "../path-display.js";
import {
  getOmpHookStatus,
  installOmpHook,
  type OmpHookOptions,
  uninstallOmpHook,
} from "../omp-hook.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { type HooksCommandGroups, type InstallOptions, writeLine } from "./install-shared.js";

export function registerOmpHooksCommands(groups: HooksCommandGroups): void {
  groups.install
    .command("omp")
    .description("Install the omp agent_end extension.")
    .option("--dry-run", "Show the extension file that would be written without writing it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallOmpHook(createRuntime(command), options);
    });

  groups.status
    .command("omp")
    .description("Inspect the omp agent_end extension.")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleOmpHookStatus(createRuntime(command), options);
    });

  groups.uninstall
    .command("omp")
    .description("Remove the omp agent_end extension.")
    .option("--dry-run", "Show the extension file removal without deleting it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallOmpHook(createRuntime(command), options);
    });
}

export async function handleInstallOmpHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await installOmpHook(toOmpHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.extensionPath)}`);
  writeLine(runtime, `Files: ${OMP_FILE_LIST}`);
  writeLine(runtime, "Command: clankerlog ping --agent omp --model <active omp model>");

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would install ClankerLog omp agent_end extension."
        : "Action: ClankerLog omp extension is already installed.",
    );
    writeOmpNextStep(runtime);
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: installed ClankerLog omp agent_end extension."
      : "Action: ClankerLog omp extension is already installed.",
  );
  writeOmpNextStep(runtime);
}

export async function handleOmpHookStatus(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const status = await getOmpHookStatus(toOmpHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(status.extensionPath)}`);
  writeLine(
    runtime,
    `Status: ${status.installed ? "ClankerLog omp extension is installed." : "ClankerLog omp extension is not installed."}`,
  );
  writeLine(
    runtime,
    `Extension matches expected: ${status.extensionMatchesExpected ? "yes" : "no"}`,
  );
}

export async function handleUninstallOmpHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await uninstallOmpHook(toOmpHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.extensionPath)}`);

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would remove ClankerLog omp extension."
        : "Action: ClankerLog omp extension is not installed.",
    );
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: removed ClankerLog omp extension."
      : "Action: ClankerLog omp extension is not installed.",
  );
}

function toOmpHookOptions(options: InstallOptions): OmpHookOptions {
  return {
    dryRun: options.dryRun,
    extensionPath: options.extensionPath,
  };
}

function writeOmpNextStep(runtime: CliRuntime): void {
  writeLine(runtime, "Next: restart omp if an existing omp session is already open.");
}

const OMP_FILE_LIST = "clankerlog.ts";
