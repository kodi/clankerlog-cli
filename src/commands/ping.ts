import type { Command } from "commander";
import { loadGlobalConfig, loadProjectConfig, resolveGlobalConfigPath } from "../config.js";
import { CliError } from "../errors.js";
import { sendClank } from "../ingest.js";
import { writeLine } from "../output.js";
import { resolveProjectPath, resolveTrackedProject } from "../project.js";
import { redactApiKey } from "../redact.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { clankPayloadSchema, defaultIngestEndpoint, type ClankPayload } from "../schemas.js";
import { detectStackFromFilenames, parseStackValues, uniqueStack } from "../stack.js";

export interface PingOptions {
  readonly agent?: string;
  readonly apiKey?: string;
  readonly dryRun?: boolean;
  readonly endpoint?: string;
  readonly model?: string;
  readonly project?: string;
  readonly stack?: string[];
  readonly timestamp?: string;
}

export interface ResolvedPing {
  readonly apiKey?: string | undefined;
  readonly endpoint: string;
  readonly payload: ClankPayload;
  readonly projectPath: string;
}

export function registerPingCommand(program: Command): void {
  program
    .command("ping")
    .description("Send one manual clank from an allowed project.")
    .option("--agent <name>", "Coding-agent name")
    .option("--model <name>", "Model name")
    .option("--project <name>", "One-off project display name for this ping")
    .option(
      "--stack <tags>",
      "Comma-separated stack tags; repeatable",
      collectStack,
      [] as string[],
    )
    .option("--timestamp <iso>", "ISO timestamp for the clank")
    .option("--endpoint <url>", "Ingestion endpoint override")
    .option("--api-key <key>", "API key override")
    .option("--dry-run", "Print the payload without sending it")
    .action(async (options: PingOptions, command: Command) => {
      await handlePing(options, createRuntime(command));
    });
}

function collectStack(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export async function handlePing(options: PingOptions, runtime: CliRuntime): Promise<void> {
  const resolved = await resolvePing(options, runtime);

  if (options.dryRun) {
    writeLine(runtime, `endpoint: ${resolved.endpoint}`);
    writeLine(runtime, `api key: ${redactApiKey(resolved.apiKey)}`);
    writeLine(runtime, "payload:");
    writeLine(runtime, JSON.stringify(resolved.payload, null, 2));
    return;
  }

  if (!resolved.apiKey) {
    throw new CliError(
      "No ClankerLog API key configured. Run `clankerlog login` or pass `--api-key`.",
    );
  }

  const result = await sendClank({
    apiKey: resolved.apiKey,
    endpoint: resolved.endpoint,
    payload: resolved.payload,
  });

  if (!result.ok) {
    throw new CliError(result.message);
  }

  writeLine(runtime, `Clank accepted: ${result.response.id}`);
}

export async function resolvePing(
  options: PingOptions,
  runtime: CliRuntime,
): Promise<ResolvedPing> {
  const projectPath = await resolveProjectPath(runtime.cwd);
  const configPath = resolveGlobalConfigPath({ configPath: runtime.configPath, env: runtime.env });
  const globalConfig = await loadGlobalConfig(configPath);
  const projectConfig = await loadProjectConfig(projectPath);
  const trackedProject = resolveTrackedProject(globalConfig, projectPath, projectConfig);

  if (!trackedProject) {
    throw new CliError(
      "This project is not allowed to clank yet.\nRun `clankerlog init` here to allow it.",
    );
  }

  const endpoint =
    options.endpoint ??
    runtime.env.CLANKERLOG_INGEST_URL ??
    globalConfig.endpoint ??
    defaultIngestEndpoint;
  const apiKey = options.apiKey ?? runtime.env.CLANKERLOG_API_KEY ?? globalConfig.apiKey;
  const agent = options.agent ?? runtime.env.CLANKERLOG_AGENT;
  const model = options.model ?? runtime.env.CLANKERLOG_MODEL;

  if (!agent) {
    throw new CliError("No agent configured. Pass `--agent` or set CLANKERLOG_AGENT.");
  }

  if (!model) {
    throw new CliError("No model configured. Pass `--model` or set CLANKERLOG_MODEL.");
  }

  const explicitStack = stackFromPrecedence(
    options.stack,
    runtime.env.CLANKERLOG_STACK,
    projectConfig?.stack,
  );
  const detectedStack = await detectStackFromFilenames(projectPath);
  const payload = clankPayloadSchema.parse({
    agent,
    model,
    project: {
      display_name: options.project ?? projectConfig?.displayName ?? trackedProject.displayName,
    },
    stack: uniqueStack([...explicitStack, ...detectedStack]),
    timestamp: options.timestamp ?? new Date().toISOString(),
    type: "clank",
  });

  return {
    apiKey,
    endpoint,
    payload,
    projectPath,
  };
}

function stackFromPrecedence(
  flagStack: readonly string[] | undefined,
  envStack: string | undefined,
  projectStack: readonly string[] | undefined,
): string[] {
  if (flagStack && flagStack.length > 0) {
    return parseStackValues(flagStack);
  }

  if (envStack) {
    return parseStackValues([envStack]);
  }

  return uniqueStack(projectStack ?? []);
}
