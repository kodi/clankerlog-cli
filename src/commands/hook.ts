import { Writable } from "node:stream";
import type { Command } from "commander";
import { z } from "zod";
import { CliError } from "../errors.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { handlePing } from "./ping.js";

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

export function registerHookCommand(program: Command): void {
  const hook = program.command("hook").description("Run coding-agent hook integrations.");

  const codex = hook.command("codex").description("Run Codex hook integrations.");
  const claude = hook.command("claude").description("Run Claude Code hook integrations.");

  codex
    .command("stop")
    .description("Handle a Codex Stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookStopOptions, command: Command) => {
      await handleCodexStopHook(createRuntime(command), options);
    });

  claude
    .command("stop")
    .description("Handle a Claude Code Stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookStopOptions, command: Command) => {
      await handleClaudeStopHook(createRuntime(command), options);
    });
}

export async function handleCodexStopHook(
  runtime: CliRuntime,
  options: HookStopOptions = {},
): Promise<void> {
  const input = await parseCodexStopInput(runtime);
  const hookRuntime = createHookRuntime(runtime, input.cwd, { quiet: !options.dryRun });

  try {
    await handlePing(
      {
        agent: runtime.env.CLANKERLOG_AGENT ?? "codex",
        dryRun: options.dryRun ?? false,
        model: input.model,
      },
      hookRuntime,
    );
  } catch (error) {
    if (options.dryRun) {
      throw error;
    }

    // Hooks must never interrupt Codex. Normal CLI diagnostics remain available
    // through `clankerlog doctor` and manual `clankerlog ping --dry-run`.
  }
}

export async function handleClaudeStopHook(
  runtime: CliRuntime,
  options: HookStopOptions = {},
): Promise<void> {
  const input = await parseClaudeStopInput(runtime);
  const hookRuntime = createHookRuntime(runtime, input.cwd, { quiet: !options.dryRun });

  try {
    await handlePing(
      {
        agent: runtime.env.CLANKERLOG_AGENT ?? "claude",
        dryRun: options.dryRun ?? false,
      },
      hookRuntime,
    );
  } catch (error) {
    if (options.dryRun) {
      throw error;
    }

    // Hooks must never interrupt Claude Code. Normal CLI diagnostics remain
    // available through `clankerlog doctor` and manual `clankerlog ping --dry-run`.
  }
}

async function parseCodexStopInput(runtime: CliRuntime): Promise<CodexStopInput> {
  const raw = await readStdin(runtime.stdin);

  if (!raw.trim()) {
    throw new CliError("Codex Stop hook payload was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("Codex Stop hook payload was not valid JSON.");
  }

  const result = codexStopInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      `Codex Stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }

  return result.data;
}

async function parseClaudeStopInput(runtime: CliRuntime): Promise<ClaudeStopInput> {
  const raw = await readStdin(runtime.stdin);

  if (!raw.trim()) {
    throw new CliError("Claude Code Stop hook payload was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("Claude Code Stop hook payload was not valid JSON.");
  }

  const result = claudeStopInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      `Claude Code Stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }

  return result.data;
}

function createHookRuntime(
  runtime: CliRuntime,
  cwd: string,
  options: { quiet: boolean },
): CliRuntime {
  return {
    configPath: runtime.configPath,
    cwd,
    env: runtime.env,
    stderr: runtime.stderr,
    stdin: runtime.stdin,
    stdout: options.quiet ? new NullWritable() : runtime.stdout,
  };
}

function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string | Buffer) => {
      chunks.push(chunk.toString());
    });
    stream.on("end", () => {
      resolve(chunks.join(""));
    });
    stream.on("error", reject);
  });
}

class NullWritable extends Writable {
  _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
  }
}

type CodexStopInput = z.infer<typeof codexStopInputSchema>;
type ClaudeStopInput = z.infer<typeof claudeStopInputSchema>;

interface HookStopOptions {
  readonly dryRun?: boolean;
}
