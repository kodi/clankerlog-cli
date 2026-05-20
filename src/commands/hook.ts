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

export function registerHookCommand(program: Command): void {
  const hook = program.command("hook").description("Run coding-agent hook integrations.");

  const codex = hook.command("codex").description("Run Codex hook integrations.");
  const claude = hook.command("claude").description("Run Claude Code hook integrations.");
  const cursor = hook.command("cursor").description("Run Cursor hook integrations.");
  const hermes = hook.command("hermes").description("Run Hermes hook integrations.");

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

  cursor
    .command("stop")
    .description("Handle a Cursor stop hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookStopOptions, command: Command) => {
      await handleCursorStopHook(createRuntime(command), options);
    });

  hermes
    .command("stop")
    .description("Handle a Hermes shell hook payload from stdin.")
    .option("--dry-run", "Print the resolved clank payload without sending it")
    .action(async (options: HookStopOptions, command: Command) => {
      await handleHermesStopHook(createRuntime(command), options);
    });
}

export async function handleCodexStopHook(
  runtime: CliRuntime,
  options: HookStopOptions = {},
): Promise<void> {
  const input = await parseCodexStopInput(runtime, options);
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
  const input = await parseClaudeStopInput(runtime, options);
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

export async function handleCursorStopHook(
  runtime: CliRuntime,
  options: HookStopOptions = {},
): Promise<void> {
  const input = await parseCursorStopInput(runtime, options);
  const hookRuntime = createHookRuntime(runtime, input.workspace_roots[0] as string, {
    quiet: !options.dryRun,
  });

  try {
    await handlePing(
      {
        agent: runtime.env.CLANKERLOG_AGENT ?? "cursor",
        dryRun: options.dryRun ?? false,
        model: input.model,
      },
      hookRuntime,
    );
  } catch (error) {
    if (options.dryRun) {
      throw error;
    }

    // Hooks must never interrupt Cursor. Normal CLI diagnostics remain
    // available through `clankerlog doctor` and manual `clankerlog ping --dry-run`.
  }
}

export async function handleHermesStopHook(
  runtime: CliRuntime,
  options: HookStopOptions = {},
): Promise<void> {
  const input = await parseHermesStopInput(runtime, options);
  if (shouldSkipHermesStopInput(input)) {
    return;
  }

  const hookRuntime = createHookRuntime(runtime, input.cwd, { quiet: !options.dryRun });

  try {
    await handlePing(
      {
        agent: runtime.env.CLANKERLOG_AGENT ?? "hermes",
        dryRun: options.dryRun ?? false,
        ...(input.extra?.model ? { model: input.extra.model } : {}),
      },
      hookRuntime,
    );
  } catch (error) {
    if (options.dryRun) {
      throw error;
    }

    // Hooks must never interrupt Hermes. Normal CLI diagnostics remain
    // available through `clankerlog doctor` and manual `clankerlog ping --dry-run`.
  }
}

async function parseCodexStopInput(
  runtime: CliRuntime,
  options: HookStopOptions,
): Promise<CodexStopInput> {
  const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });

  if (!raw.trim()) {
    if (options.dryRun) {
      return codexStopInputSchema.parse({
        cwd: runtime.cwd,
        hook_event_name: "Stop",
        last_assistant_message: null,
        model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
        permission_mode: "default",
        session_id: "dry-run-session",
        stop_hook_active: false,
        transcript_path: null,
        turn_id: "dry-run-turn",
      });
    }

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

async function parseClaudeStopInput(
  runtime: CliRuntime,
  options: HookStopOptions,
): Promise<ClaudeStopInput> {
  const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });

  if (!raw.trim()) {
    if (options.dryRun) {
      return claudeStopInputSchema.parse({
        cwd: runtime.cwd,
        hook_event_name: "Stop",
        last_assistant_message: null,
        permission_mode: "default",
        session_id: "dry-run-session",
        stop_hook_active: false,
        transcript_path: null,
      });
    }

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

async function parseCursorStopInput(
  runtime: CliRuntime,
  options: HookStopOptions,
): Promise<CursorStopInput> {
  const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });

  if (!raw.trim()) {
    if (options.dryRun) {
      return cursorStopInputSchema.parse({
        workspace_roots: [runtime.cwd],
        conversation_id: "dry-run-conversation",
        cursor_version: "dry-run-cursor",
        generation_id: "dry-run-generation",
        hook_event_name: "stop",
        model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
        transcript_path: null,
        user_email: null,
      });
    }

    throw new CliError("Cursor stop hook payload was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("Cursor stop hook payload was not valid JSON.");
  }

  const result = cursorStopInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      `Cursor stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }

  return result.data;
}

async function parseHermesStopInput(
  runtime: CliRuntime,
  options: HookStopOptions,
): Promise<HermesStopInput> {
  const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });

  if (!raw.trim()) {
    if (options.dryRun) {
      return hermesStopInputSchema.parse({
        cwd: runtime.cwd,
        extra: {
          model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
          platform: "cli",
        },
        hook_event_name: "post_llm_call",
        session_id: "dry-run-session",
      });
    }

    throw new CliError("Hermes hook payload was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("Hermes hook payload was not valid JSON.");
  }

  const result = hermesStopInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      `Hermes hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }

  return result.data;
}

function shouldSkipHermesStopInput(input: HermesStopInput): boolean {
  return (
    input.hook_event_name === "on_session_end" &&
    (input.extra?.completed === false || input.extra?.interrupted === true)
  );
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

function readStdin(
  stream: NodeJS.ReadableStream,
  options: { allowDryRunFallback: boolean },
): Promise<string> {
  if (options.allowDryRunFallback && stdinIsTty(stream)) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let fallbackTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const finish = (value: string) => {
      cleanup();
      resolve(value);
    };

    const onData = (chunk: string | Buffer) => {
      chunks.push(chunk.toString());
    };

    const onEnd = () => {
      finish(chunks.join(""));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    stream.setEncoding("utf8");
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);

    if (options.allowDryRunFallback) {
      fallbackTimer = setTimeout(() => {
        finish(chunks.join(""));
      }, 50);
    }
  });
}

function stdinIsTty(stream: NodeJS.ReadableStream): boolean {
  return Boolean((stream as NodeJS.ReadStream).isTTY);
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
type CursorStopInput = z.infer<typeof cursorStopInputSchema>;
type HermesStopInput = z.infer<typeof hermesStopInputSchema>;

interface HookStopOptions {
  readonly dryRun?: boolean;
}
