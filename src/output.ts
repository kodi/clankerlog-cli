import type { CliRuntime } from "./runtime.js";

export function writeLine(runtime: CliRuntime, message = ""): void {
  runtime.stdout.write(`${message}\n`);
}

export function writeErrorLine(runtime: CliRuntime, message: string): void {
  runtime.stderr.write(`${message}\n`);
}
