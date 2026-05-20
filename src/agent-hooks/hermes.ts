import type { Command } from "commander";
import { z } from "zod";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerConfigAgentHooksCommands, type HooksCommandGroups } from "./config-agent-hooks.js";
import { type HookRuntimeOptions, parseJsonHookInput, sendHookPing } from "./runtime-shared.js";

const hermesStopInputSchema = z.looseObject({
  cwd: z.string().trim().min(1),
  extra: z
    .looseObject({
      completed: z.boolean().optional(),
      interrupted: z.boolean().optional(),
      model: z.string().trim().min(1).max(200).optional(),
      platform: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
  hook_event_name: z.enum(["post_llm_call", "on_session_end"]),
  session_id: z.string().trim().min(1).nullable().optional(),
});

export function registerHermesHookCommand(hook: Command): void {
  const hermes = hook.command("hermes").description("Run Hermes hook integrations.");

  hermes
    .command("stop")
    .description("Handle a Hermes shell hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookRuntimeOptions, command: Command) => {
      await handleHermesStopHook(createRuntime(command), options);
    });
}

export function registerHermesHooksCommands(groups: HooksCommandGroups): void {
  registerConfigAgentHooksCommands(groups, {
    agent: "hermes",
    installDescription: "Install the Hermes post_llm_call shell hook.",
    statusDescription: "Inspect the Hermes post_llm_call shell hook.",
    uninstallDescription: "Remove the Hermes post_llm_call shell hook.",
  });
}

export async function handleHermesStopHook(
  runtime: CliRuntime,
  options: HookRuntimeOptions = {},
): Promise<void> {
  const input = await parseJsonHookInput(runtime, options, {
    schema: hermesStopInputSchema,
    emptyPayloadError: "Hermes hook payload was empty.",
    invalidJsonError: "Hermes hook payload was not valid JSON.",
    invalidPayloadLabel: "Hermes hook payload was invalid",
    dryRunFallback: (runtime) => ({
      cwd: runtime.cwd,
      extra: {
        model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
        platform: "cli",
      },
      hook_event_name: "post_llm_call",
      session_id: "dry-run-session",
    }),
  });

  if (shouldSkipHermesStopInput(input)) {
    return;
  }

  await sendHookPing(runtime, options, {
    agent: runtime.env.CLANKERLOG_AGENT ?? "hermes",
    cwd: input.cwd,
    ...(input.extra?.model ? { model: input.extra.model } : {}),
  });
}

function shouldSkipHermesStopInput(input: HermesStopInput): boolean {
  return (
    input.hook_event_name === "on_session_end" &&
    (input.extra?.completed === false || input.extra?.interrupted === true)
  );
}

type HermesStopInput = z.infer<typeof hermesStopInputSchema>;
