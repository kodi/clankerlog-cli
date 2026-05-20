import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const codexStopInputSchema = z.looseObject({
  cwd: z.string().trim().min(1),
  hook_event_name: z.literal("Stop"),
  last_assistant_message: z.string().nullable(),
  model: z.string().trim().min(1).max(120),
  permission_mode: z.enum(["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]),
  session_id: z.string().trim().min(1),
  stop_hook_active: z.boolean(),
  transcript_path: z.string().nullable(),
  turn_id: z.string().trim().min(1),
});

export function registerCodexHookCommand(hook: Command): void {
  const codex = hook.command("codex").description("Run Codex hook integrations.");

  codex
    .command("stop")
    .description("Handle a Codex Stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleCodexStopHook(createRuntime(command), options);
    });
}

export function registerCodexHooksCommands(groups: HooksCommandGroups): void {
  registerConfigAgentHooksCommands(groups, {
    agent: "codex",
    installDescription: "Install the Codex Stop hook.",
    statusDescription: "Inspect the Codex Stop hook.",
    uninstallDescription: "Remove the Codex Stop hook.",
  });
}

export async function handleCodexStopHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: codexStopInputSchema,
    emptyPayloadError: "Codex Stop hook payload was empty.",
    invalidJsonError: "Codex Stop hook payload was not valid JSON.",
    invalidPayloadLabel: "Codex Stop hook payload was invalid",
    dryRunFallback: (runtime) => ({
      cwd: runtime.cwd,
      hook_event_name: "Stop",
      last_assistant_message: null,
      model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
      permission_mode: "default",
      session_id: "dry-run-session",
      stop_hook_active: false,
      transcript_path: null,
      turn_id: "dry-run-turn",
    }),
  });

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "codex",
    cwd: input.cwd,
    model: input.model,
  });
}
