import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const claudeStopInputSchema = z.looseObject({
  cwd: z.string().trim().min(1),
  hook_event_name: z.literal("Stop"),
  last_assistant_message: z.string().nullable().optional(),
  permission_mode: z
    .enum(["default", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"])
    .optional(),
  session_id: z.string().trim().min(1),
  stop_hook_active: z.boolean(),
  transcript_path: z.string().nullable().optional(),
});

export function registerClaudeHookCommand(hook: Command): void {
  const claude = hook.command("claude").description("Run Claude Code hook integrations.");

  claude
    .command("stop")
    .description("Handle a Claude Code Stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleClaudeStopHook(createRuntime(command), options);
    });
}

export function registerClaudeHooksCommands(groups: HooksCommandGroups): void {
  registerConfigAgentHooksCommands(groups, {
    agent: "claude",
    installDescription: "Install the Claude Code Stop hook.",
    modelOptionDescription: "Claude model name, for example claude-sonnet-4.5",
    statusDescription: "Inspect the Claude Code Stop hook.",
    uninstallDescription: "Remove the Claude Code Stop hook.",
  });
}

export async function handleClaudeStopHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: claudeStopInputSchema,
    emptyPayloadError: "Claude Code Stop hook payload was empty.",
    invalidJsonError: "Claude Code Stop hook payload was not valid JSON.",
    invalidPayloadLabel: "Claude Code Stop hook payload was invalid",
    dryRunFallback: (runtime) => ({
      cwd: runtime.cwd,
      hook_event_name: "Stop",
      last_assistant_message: null,
      permission_mode: "default",
      session_id: "dry-run-session",
      stop_hook_active: false,
      transcript_path: null,
    }),
  });

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "claude",
    cwd: input.cwd,
  });
}
