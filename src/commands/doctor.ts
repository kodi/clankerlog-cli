import type { Command } from "commander";
import {
  ConfigError,
  createDefaultGlobalConfig,
  loadGlobalConfig,
  loadProjectConfig,
  resolveGlobalConfigPath,
  resolveProjectConfigPath,
} from "../config.js";
import { writeLine } from "../output.js";
import { findAllowedProject, resolveProjectPath } from "../project.js";
import { redactApiKey } from "../redact.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { defaultIngestEndpoint, type GlobalConfig, type ProjectConfig } from "../schemas.js";

export interface DoctorOptions {
  readonly agent?: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Print local ClankerLog CLI setup status without sending data.")
    .option("--agent <name>", "Agent name to test resolution")
    .option("--model <name>", "Model name to test resolution")
    .option("--endpoint <url>", "Endpoint override to report")
    .option("--api-key <key>", "API key override to report redacted")
    .action(async (options: DoctorOptions, command: Command) => {
      await handleDoctor(options, createRuntime(command));
    });
}

export async function handleDoctor(options: DoctorOptions, runtime: CliRuntime): Promise<void> {
  const configPath = resolveGlobalConfigPath({ configPath: runtime.configPath, env: runtime.env });
  const { config, ok: configOk } = await readDoctorConfig(configPath, runtime);
  const projectPath = await resolveProjectPath(runtime.cwd);
  const projectConfig = await readDoctorProjectConfig(projectPath, runtime);
  const endpoint =
    options.endpoint ??
    runtime.env.CLANKERLOG_INGEST_URL ??
    config.endpoint ??
    defaultIngestEndpoint;
  const apiKey = options.apiKey ?? runtime.env.CLANKERLOG_API_KEY ?? config.apiKey;
  const agent = options.agent ?? runtime.env.CLANKERLOG_AGENT;
  const model = options.model ?? runtime.env.CLANKERLOG_MODEL;
  const allowedProject = configOk ? findAllowedProject(config, projectPath) : undefined;

  writeLine(runtime, `config: ${configOk ? "ok" : "error"} (${configPath})`);
  writeLine(runtime, `auth: ${apiKey ? `ok ${redactApiKey(apiKey)}` : "missing"}`);
  writeLine(runtime, `endpoint: ${endpoint}`);
  writeLine(runtime, `agent: ${agent ? `ok ${agent}` : "missing"}`);
  writeLine(runtime, `model: ${model ? `ok ${model}` : "missing"}`);
  writeLine(runtime);
  writeAllowedProjects(config, runtime);
  writeLine(
    runtime,
    `current project: ${allowedProject ? `allowed as ${allowedProject.displayName}` : "denied"}`,
  );
  writeProjectConfig(projectPath, projectConfig, runtime);
}

async function readDoctorConfig(
  configPath: string,
  runtime: CliRuntime,
): Promise<{ readonly config: GlobalConfig; readonly ok: boolean }> {
  try {
    return { config: await loadGlobalConfig(configPath), ok: true };
  } catch (error) {
    if (error instanceof ConfigError) {
      writeLine(runtime, `config error: ${error.message}`);
      return { config: createDefaultGlobalConfig(), ok: false };
    }

    throw error;
  }
}

async function readDoctorProjectConfig(
  projectPath: string,
  runtime: CliRuntime,
): Promise<ProjectConfig | undefined> {
  try {
    return await loadProjectConfig(projectPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      writeLine(runtime, `project config error: ${error.message}`);
      return undefined;
    }

    throw error;
  }
}

function writeAllowedProjects(config: GlobalConfig, runtime: CliRuntime): void {
  if (config.allowedProjects.length === 0) {
    writeLine(runtime, "allowed projects: none");
    return;
  }

  writeLine(runtime, "allowed projects:");
  for (const project of config.allowedProjects) {
    writeLine(runtime, `- ${project.path} -> ${project.displayName}`);
  }
}

function writeProjectConfig(
  projectPath: string,
  projectConfig: ProjectConfig | undefined,
  runtime: CliRuntime,
): void {
  if (!projectConfig) {
    writeLine(runtime, `project config: missing (${resolveProjectConfigPath(projectPath)})`);
    return;
  }

  const stack =
    projectConfig.stack && projectConfig.stack.length > 0
      ? ` stack=${projectConfig.stack.join(",")}`
      : "";
  writeLine(
    runtime,
    `project config: ok displayName=${projectConfig.displayName ?? "not set"}${stack}`,
  );
}
