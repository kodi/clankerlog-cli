import { Readable, Writable } from "node:stream";
import type { CliRuntime } from "../src/runtime.js";

export interface MemoryRuntime extends CliRuntime {
  readonly stderrText: () => string;
  readonly stdoutText: () => string;
}

export function createMemoryRuntime(options: {
  configPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
  stdin?: string | undefined;
}): MemoryRuntime {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();

  return {
    configPath: options.configPath,
    cwd: options.cwd,
    env: options.env ?? {},
    stderr,
    stderrText: () => stderr.text(),
    stdin: Readable.from(options.stdin ? [options.stdin] : []),
    stdout,
    stdoutText: () => stdout.text(),
  };
}

class CaptureStream extends Writable {
  readonly #chunks: string[] = [];

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.#chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.#chunks.join("");
  }
}
