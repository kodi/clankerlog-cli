import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const cursorStopInputSchema = z.looseObject({
  workspace_roots: z.array(z.string().trim().min(1)).min(1),
  conversation_id: z.string().trim().min(1),
  cursor_version: z.string().trim().min(1),
  generation_id: z.string().trim().min(1),
  hook_event_name: z.literal("stop").optional(),
  model: z.string().trim().min(1).max(120),
  transcript_path: z.string().nullable(),
  user_email: z.string().nullable(),
});

export function registerCursorHookCommand(hook: Command): void {
  const cursor = hook.command("cursor").description("Run Cursor hook integrations.");

  cursor
    .command("stop")
    .description("Handle a Cursor stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleCursorStopHook(createRuntime(command), options);
    });
}

export function registerCursorHooksCommands(groups: HooksCommandGroups): void {
  registerConfigAgentHooksCommands(groups, {
    agent: "cursor",
    installDescription: "Install the Cursor stop hook.",
    modelOptionDescription: "Optional Cursor model override; by default Cursor supplies it",
    statusDescription: "Inspect the Cursor stop hook.",
    uninstallDescription: "Remove the Cursor stop hook.",
  });
}

export async function handleCursorStopHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: cursorStopInputSchema,
    emptyPayloadError: "Cursor stop hook payload was empty.",
    invalidJsonError: "Cursor stop hook payload was not valid JSON.",
    invalidPayloadLabel: "Cursor stop hook payload was invalid",
    dryRunFallback: (runtime) => ({
      workspace_roots: [runtime.cwd],
      conversation_id: "dry-run-conversation",
      cursor_version: "dry-run-cursor",
      generation_id: "dry-run-generation",
      hook_event_name: "stop",
      model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
      transcript_path: null,
      user_email: null,
    }),
  });

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "cursor",
    cwd: input.workspace_roots[0] as string,
    model: input.model,
  });
}
