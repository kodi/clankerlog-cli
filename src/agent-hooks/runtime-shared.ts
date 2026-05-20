import { Writable } from "node:stream";
import type { z } from "zod";
import { CliError } from "../errors.js";
import { type PingOptions, handlePing } from "../commands/ping.js";
import type { CliRuntime } from "../runtime.js";

export interface HookRuntimeOptions {
  readonly dryRun?: boolean;
}

export async function parseJsonHookInput<T>(
  runtime: CliRuntime,
  options: HookRuntimeOptions,
  config: {
    readonly schema: z.ZodType<T>;
    readonly emptyPayloadError: string;
    readonly invalidJsonError: string;
    readonly invalidPayloadLabel: string;
    readonly dryRunFallback?: (runtime: CliRuntime) => unknown;
  },
): Promise<T> {
  const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });

  if (!raw.trim()) {
    if (options.dryRun && config.dryRunFallback) {
      return config.schema.parse(config.dryRunFallback(runtime));
    }

    throw new CliError(config.emptyPayloadError);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(config.invalidJsonError);
  }

  const result = config.schema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      `${config.invalidPayloadLabel}: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
    );
  }

  return result.data;
}

export async function sendHookPing(
  runtime: CliRuntime,
  options: HookRuntimeOptions,
  config: {
    readonly agent: string;
    readonly cwd: string;
    readonly model?: string | undefined;
  },
): Promise<void> {
  const hookRuntime = createHookRuntime(runtime, config.cwd, { quiet: !options.dryRun });
  const pingOptions: PingOptions = {
    agent: config.agent,
    dryRun: options.dryRun ?? false,
    ...(config.model ? { model: config.model } : {}),
  };

  try {
    await handlePing(pingOptions, hookRuntime);
  } catch (error) {
    if (options.dryRun) {
      throw error;
    }
  }
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
