import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const topchesterStopInputSchema = z.looseObject({
  cwd: z.string().trim().min(1),
  event: z.literal("Stop").optional(),
  finalMessage: z.string().optional(),
  hook_event_name: z.literal("Stop"),
  model: z
    .looseObject({
      modelId: z.string().trim().min(1).max(200).optional(),
      ref: z.string().trim().min(1).max(240).optional(),
    })
    .optional(),
  model_id: z.string().trim().min(1).max(200).optional(),
  model_ref: z.string().trim().min(1).max(240).optional(),
  session_id: z.string().trim().min(1).optional(),
  source: z.literal("topchester").optional(),
  status: z.enum(["completed", "failed"]),
  taskCompleteAlias: z.literal("TaskComplete").optional(),
  workspaceRoot: z.string().trim().min(1).optional(),
});

export function registerTopchesterHookCommand(hook: Command): void {
  const topchester = hook.command("topchester").description("Run Topchester hook integrations.");

  topchester
    .command("stop")
    .description("Handle a Topchester Stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleTopchesterStopHook(createRuntime(command), options);
    });
}

export function registerTopchesterHooksCommands(groups: HooksCommandGroups): void {
  registerConfigAgentHooksCommands(groups, {
    agent: "topchester",
    installDescription: "Install the Topchester Stop hook.",
    statusDescription: "Inspect the Topchester Stop hook.",
    uninstallDescription: "Remove the Topchester Stop hook.",
  });
}

export async function handleTopchesterStopHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: topchesterStopInputSchema,
    emptyPayloadError: "Topchester Stop hook payload was empty.",
    invalidJsonError: "Topchester Stop hook payload was not valid JSON.",
    invalidPayloadLabel: "Topchester Stop hook payload was invalid",
    dryRunFallback: (runtime) => ({
      cwd: runtime.cwd,
      event: "Stop",
      hook_event_name: "Stop",
      model_ref: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
      source: "topchester",
      status: "completed",
      workspaceRoot: runtime.cwd,
    }),
  });

  if (input.status !== "completed") {
    return;
  }

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "topchester",
    cwd: input.workspaceRoot ?? input.cwd,
    ...(topchesterModel(input) ? { model: topchesterModel(input) } : {}),
  });
}

function topchesterModel(input: TopchesterStopInput): string | undefined {
  return input.model_ref ?? input.model_id ?? input.model?.ref ?? input.model?.modelId;
}

type TopchesterStopInput = z.infer<typeof topchesterStopInputSchema>;
