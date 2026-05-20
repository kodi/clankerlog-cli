import { Option, type Command } from "commander";
import { z } from "zod";
import {
  getOpenClawHookStatus,
  installOpenClawHook,
  type OpenClawHookOptions,
  uninstallOpenClawHook,
} from "../openclaw-hook.js";
import { formatHomePath } from "../path-display.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { type HooksCommandGroups, type InstallOptions, writeLine } from "./install-shared.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const openClawMessageSentInputSchema = z.looseObject({
  model: z.string().trim().min(1).max(120).optional(),
  success: z.literal(true),
  workspaceDir: z.string().trim().min(1),
});

export function registerOpenClawHookCommand(hook: Command): void {
  const openclaw = hook.command("openclaw").description("Run OpenClaw hook integrations.");

  openclaw
    .command("message-sent")
    .description("Handle a successful OpenClaw message:sent hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleOpenClawMessageSentHook(createRuntime(command), options);
    });
}

export function registerOpenClawHooksCommands(groups: HooksCommandGroups): void {
  groups.install
    .command("openclaw")
    .description("Install the global OpenClaw message:sent hook.")
    .option("--dry-run", "Show the hook files that would be written without writing them")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleInstallOpenClawHook(createRuntime(command), options);
    });

  groups.status
    .command("openclaw")
    .description("Inspect the global OpenClaw message:sent hook.")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleOpenClawHookStatus(createRuntime(command), options);
    });

  groups.uninstall
    .command("openclaw")
    .description("Remove the global OpenClaw message:sent hook.")
    .option("--dry-run", "Show the hook directory removal without deleting it")
    .addOption(new Option("--hook-dir <path>").hideHelp())
    .action(async (options: InstallOptions, command: Command) => {
      await handleUninstallOpenClawHook(createRuntime(command), options);
    });
}

export async function handleOpenClawMessageSentHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: openClawMessageSentInputSchema,
    emptyPayloadError: "OpenClaw message:sent hook payload was empty.",
    invalidJsonError: "OpenClaw message:sent hook payload was not valid JSON.",
    invalidPayloadLabel: "OpenClaw message:sent hook payload was invalid",
    dryRunFallback: (runtime) => ({
      model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
      success: true,
      workspaceDir: runtime.env.CLANKERLOG_WORKSPACE_DIR ?? runtime.cwd,
    }),
  });

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "openclaw",
    cwd: input.workspaceDir,
    ...(input.model ? { model: input.model } : {}),
  });
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

function toOpenClawHookOptions(options: InstallOptions): OpenClawHookOptions {
  return {
    dryRun: options.dryRun,
    hookDir: options.hookDir,
    inspectOpenClawCli: options.hookDir ? false : undefined,
  };
}

function writeOpenClawNextStep(runtime: CliRuntime): void {
  writeLine(
    runtime,
    "Next: run `openclaw hooks enable clankerlog` if OpenClaw has not enabled it yet.",
  );
}

const HOOK_FILE_LIST = "HOOK.md, handler.ts";
