import path from "node:path";
import type { Command } from "commander";

export interface CliRuntime {
  readonly configPath?: string | undefined;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stderr: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}

export function createRuntime(command: Command): CliRuntime {
  const opts = command.optsWithGlobals<{ workspace?: string }>();
  const cwd = opts.workspace ? path.resolve(opts.workspace) : process.cwd();

  return {
    cwd,
    env: process.env,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  };
}
