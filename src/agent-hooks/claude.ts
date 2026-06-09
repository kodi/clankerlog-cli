import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";
import { loadClaudeSessionModel, saveClaudeSessionModel } from "./claude-session-model.js";

const claudeSessionStartInputSchema = z.looseObject({
  cwd: z.string().trim().min(1),
  hook_event_name: z.literal("SessionStart"),
  model: z.string().trim().min(1).max(200),
  session_id: z.string().trim().min(1),
  source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
  transcript_path: z.string().nullable().optional(),
});

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
    .command("session-start")
    .description("Handle a Claude Code SessionStart hook payload from stdin.")
    .option("--dry-run", "Print the resolved session model cache entry without writing it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleClaudeSessionStartHook(createRuntime(command), options);
    });

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
    installDescription: "Install the Claude Code SessionStart and Stop hooks.",
    modelOptionDescription: "Fallback Claude model name, for example claude-sonnet-4.5",
    statusDescription: "Inspect the Claude Code SessionStart and Stop hooks.",
    uninstallDescription: "Remove the Claude Code SessionStart and Stop hooks.",
  });
}

export async function handleClaudeSessionStartHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: claudeSessionStartInputSchema,
    emptyPayloadError: "Claude Code SessionStart hook payload was empty.",
    invalidJsonError: "Claude Code SessionStart hook payload was not valid JSON.",
    invalidPayloadLabel: "Claude Code SessionStart hook payload was invalid",
    dryRunFallback: (runtime) => ({
      cwd: runtime.cwd,
      hook_event_name: "SessionStart",
      model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
      session_id: "dry-run-session",
      source: "startup",
      transcript_path: null,
    }),
  });

  if (options.dryRun) {
    runtime.stdout.write(
      `${JSON.stringify({ session_id: input.session_id, model: input.model }, null, 2)}\n`,
    );
    return;
  }

  await saveClaudeSessionModel(runtime, input.session_id, input.model);
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

  const model = await claudeStopModel(runtime, input.session_id);

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "claude",
    cwd: input.cwd,
    ...(model ? { model } : {}),
  });
}

async function claudeStopModel(
  runtime: CliRuntime,
  sessionId: string,
): Promise<string | undefined> {
  try {
    return await loadClaudeSessionModel(runtime, sessionId);
  } catch {
    return undefined;
  }
}
