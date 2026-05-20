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
import {
  getOpenClawHookStatus,
  installOpenClawHook,
  type OpenClawHookOptions,
  uninstallOpenClawHook,
} from "../openclaw-hook.js";
import { formatHomePath } from "../path-display.js";
import { getPiHookStatus, installPiHook, type PiHookOptions, uninstallPiHook } from "../pi-hook.js";
import { createRuntime, type CliRuntime } from "../runtime.js";

interface InstallOptions {
  readonly dryRun?: boolean | undefined;
  readonly extensionPath?: string | undefined;
  readonly hookConfig?: string | undefined;
  readonly hookDir?: string | undefined;
  readonly model?: string | undefined;
}

export function registerHooksCommand(program: Command): void {
  const hooks = program.command("hooks").description("Install and inspect coding-agent hooks.");
  const install = hooks.command("install").description("Install a ClankerLog Stop hook.");
  const status = hooks.command("status").description("Inspect a ClankerLog Stop hook.");
  const uninstall = hooks.command("uninstall").description("Remove a ClankerLog Stop hook.");

  install
    .command("codex")
    .description("Install the Codex Stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallHook("codex", createRuntime(command), options);
    });

  install
    .command("claude")
    .description("Install the Claude Code Stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .option("--model <model>", "Claude model name, for example claude-sonnet-4.5")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallHook("claude", createRuntime(command), options);
    });

  install
    .command("cursor")
    .description("Install the Cursor stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .option("--model <model>", "Optional Cursor model override; by default Cursor supplies it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallHook("cursor", createRuntime(command), options);
    });

  install
    .command("hermes")
    .description("Install the Hermes post_llm_call shell hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallHook("hermes", createRuntime(command), options);
    });

  install
    .command("pi")
    .description("Install the Pi agent_end extension.")
    .option("--dry-run", "Show the extension file that would be written without writing it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallPiHook(createRuntime(command), options);
    });

  install
    .command("openclaw")
    .description("Install the global OpenClaw message:sent hook.")
    .option("--dry-run", "Show the hook files that would be written without writing them")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallOpenClawHook(createRuntime(command), options);
    });

  status
    .command("codex")
    .description("Inspect the Codex Stop hook.")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleHookStatus("codex", createRuntime(command), options);
    });

  status
    .command("claude")
    .description("Inspect the Claude Code Stop hook.")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleHookStatus("claude", createRuntime(command), options);
    });

  status
    .command("cursor")
    .description("Inspect the Cursor stop hook.")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleHookStatus("cursor", createRuntime(command), options);
    });

  status
    .command("hermes")
    .description("Inspect the Hermes post_llm_call shell hook.")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleHookStatus("hermes", createRuntime(command), options);
    });

  status
    .command("pi")
    .description("Inspect the Pi agent_end extension.")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handlePiHookStatus(createRuntime(command), options);
    });

  status
    .command("openclaw")
    .description("Inspect the global OpenClaw message:sent hook.")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleOpenClawHookStatus(createRuntime(command), options);
    });

  uninstall
    .command("codex")
    .description("Remove the Codex Stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallHook("codex", createRuntime(command), options);
    });

  uninstall
    .command("claude")
    .description("Remove the Claude Code Stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallHook("claude", createRuntime(command), options);
    });

  uninstall
    .command("cursor")
    .description("Remove the Cursor stop hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallHook("cursor", createRuntime(command), options);
    });

  uninstall
    .command("hermes")
    .description("Remove the Hermes post_llm_call shell hook.")
    .option("--dry-run", "Show the hook config change without writing it")
    .addOption(new Option("--hook-config <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallHook("hermes", createRuntime(command), options);
    });

  uninstall
    .command("pi")
    .description("Remove the Pi agent_end extension.")
    .option("--dry-run", "Show the extension file removal without deleting it")
    .addOption(new Option("--extension-path <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallPiHook(createRuntime(command), options);
    });

  uninstall
    .command("openclaw")
    .description("Remove the global OpenClaw message:sent hook.")
    .option("--dry-run", "Show the hook directory removal without deleting it")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallOpenClawHook(createRuntime(command), options);
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

export async function handleInstallOpenClawHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await installOpenClawHook(toOpenClawHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.hookDir)}`);
  writeLine(runtime, `Files: ${HOOK_FILE_LIST}`);
  writeLine(runtime, "Command: clankerlog hook openclaw message-sent");

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would install ClankerLog OpenClaw message:sent hook."
        : "Action: ClankerLog OpenClaw hook is already installed.",
    );
    writeOpenClawNextStep(runtime);
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: installed ClankerLog OpenClaw message:sent hook."
      : "Action: ClankerLog OpenClaw hook is already installed.",
  );
  writeOpenClawNextStep(runtime);
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

export async function handleOpenClawHookStatus(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const status = await getOpenClawHookStatus(toOpenClawHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(status.hookDir)}`);
  writeLine(
    runtime,
    `Status: ${status.installed ? "ClankerLog OpenClaw hook is installed." : "ClankerLog OpenClaw hook is not installed."}`,
  );
  writeLine(runtime, `HOOK.md matches expected: ${status.hookMdMatchesExpected ? "yes" : "no"}`);
  writeLine(
    runtime,
    `handler.ts matches expected: ${status.handlerMatchesExpected ? "yes" : "no"}`,
  );

  if (status.openClawCliAvailable) {
    writeLine(runtime, `OpenClaw CLI sees hook: ${status.discoveredByOpenClaw ? "yes" : "no"}`);
    writeLine(runtime, `OpenClaw CLI reports enabled: ${status.enabledByOpenClaw ? "yes" : "no"}`);
  } else {
    writeLine(runtime, "OpenClaw CLI status: unavailable");
  }
}

export async function handleUninstallOpenClawHook(
  runtime: CliRuntime,
  options: InstallOptions = {},
): Promise<void> {
  const plan = await uninstallOpenClawHook(toOpenClawHookOptions(options));

  writeLine(runtime, `Target: ${formatHomePath(plan.hookDir)}`);

  if (options.dryRun) {
    writeLine(
      runtime,
      plan.changed
        ? "Action: would remove ClankerLog OpenClaw hook."
        : "Action: ClankerLog OpenClaw hook is not installed.",
    );
    return;
  }

  writeLine(
    runtime,
    plan.changed
      ? "Action: removed ClankerLog OpenClaw hook."
      : "Action: ClankerLog OpenClaw hook is not installed.",
  );
}

function toHookConfigFileOptions(options: InstallOptions): HookConfigFileOptions {
  return {
    configPath: options.hookConfig,
    dryRun: options.dryRun,
    model: options.model,
  };
}

function toOpenClawHookOptions(options: InstallOptions): OpenClawHookOptions {
  return {
    dryRun: options.dryRun,
    hookDir: options.hookDir,
    inspectOpenClawCli: options.hookDir ? false : undefined,
  };
}

function toPiHookOptions(options: InstallOptions): PiHookOptions {
  return {
    dryRun: options.dryRun,
    extensionPath: options.extensionPath,
  };
}

function writeNextStep(runtime: CliRuntime, agent: HookAgent): void {
  if (agent === "codex") {
    writeLine(runtime, "Next: run /hooks in Codex if command approval is required.");
  }
}

function writeOpenClawNextStep(runtime: CliRuntime): void {
  writeLine(
    runtime,
    "Next: run `openclaw hooks enable clankerlog` if OpenClaw has not enabled it yet.",
  );
}

function writePiNextStep(runtime: CliRuntime): void {
  writeLine(runtime, "Next: run `/reload` in Pi if an existing Pi session is already open.");
}

function writeLine(runtime: CliRuntime, line: string): void {
  runtime.stdout.write(`${line}\n`);
}

function agentName(agent: HookAgent): string {
  if (agent === "claude") {
    return "Claude Code";
  }

  if (agent === "cursor") {
    return "Cursor";
  }

  if (agent === "hermes") {
    return "Hermes";
  }

  return "Codex";
}

const HOOK_FILE_LIST = "HOOK.md, handler.ts";
const PI_FILE_LIST = "clankerlog.ts";
