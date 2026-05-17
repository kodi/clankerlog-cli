import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { loadGlobalConfig, resolveGlobalConfigPath, saveGlobalConfig } from "../config.js";
import { writeLine } from "../output.js";
import { redactApiKey } from "../redact.js";
import { createRuntime, type CliRuntime } from "../runtime.js";

export interface LoginOptions {
  readonly apiKey?: string;
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Save a ClankerLog API key in the local global config.")
    .option("--api-key <key>", "API key to save without prompting")
    .action(async (options: LoginOptions, command: Command) => {
      await handleLogin(options, createRuntime(command));
    });
}

export async function handleLogin(options: LoginOptions, runtime: CliRuntime): Promise<void> {
  const apiKey = options.apiKey ?? (await promptApiKey(runtime));
  const configPath = resolveGlobalConfigPath({ configPath: runtime.configPath, env: runtime.env });
  const config = await loadGlobalConfig(configPath);

  await saveGlobalConfig(configPath, { ...config, apiKey });
  writeLine(runtime, `Saved API key ${redactApiKey(apiKey)} to ${configPath}.`);
}

async function promptApiKey(runtime: CliRuntime): Promise<string> {
  const readline = createInterface({
    input: runtime.stdin,
    output: runtime.stdout,
  });

  try {
    return (await readline.question("Paste your ClankerLog API key: ")).trim();
  } finally {
    readline.close();
  }
}
