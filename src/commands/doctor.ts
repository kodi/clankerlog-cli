import type { Command } from "commander";
import {
  ConfigError,
  createDefaultGlobalConfig,
  loadGlobalConfig,
  loadProjectConfig,
  resolveGlobalConfigPath,
  resolveProjectConfigPath,
} from "../config.js";
import { checkAuth } from "../ingest.js";
import { writeLine } from "../output.js";
import { formatHomePath } from "../path-display.js";
import { findAllowedProject, resolveProjectPath } from "../project.js";
import { redactApiKey } from "../redact.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { defaultIngestEndpoint, type GlobalConfig, type ProjectConfig } from "../schemas.js";

const color = {
  blue: (value: string) => `\x1b[34m${value}\x1b[0m`,
  dimGray: (value: string) => `\x1b[2;90m${value}\x1b[0m`,
  green: (value: string) => `\x1b[32m${value}\x1b[0m`,
  red: (value: string) => `\x1b[31m${value}\x1b[0m`,
  yellow: (value: string) => `\x1b[33m${value}\x1b[0m`,
};

const spinnerFrames = ["-", "\\", "|", "/"];

export interface DoctorOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Print local ClankerLog CLI setup status without sending data.")
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
  const allowedProject = configOk ? findAllowedProject(config, projectPath) : undefined;

  writeLine(
    runtime,
    `config: ${configOk ? color.green("ok") : color.red("error")} (${formatHomePath(configPath)})`,
  );
  writeLine(
    runtime,
    `auth: ${apiKey ? `${color.green("ok")} ${redactApiKey(apiKey)}` : color.yellow("missing")}`,
  );
  writeLine(runtime, `endpoint: ${color.dimGray(endpoint)}`);
  await writeApiCheck(apiKey, endpoint, runtime);
  writeLine(runtime);

  writeAllowedProjects(config, runtime);
  writeLine(runtime);

  writeLine(
    runtime,
    `current project: ${
      allowedProject
        ? `allowed as ${color.blue(allowedProject.displayName)}`
        : color.yellow("denied")
    }`,
  );
  writeProjectConfig(projectPath, projectConfig, runtime);
}

async function writeApiCheck(
  apiKey: string | undefined,
  endpoint: string,
  runtime: CliRuntime,
): Promise<void> {
  if (!apiKey) {
    writeLine(runtime, `api check: ${color.yellow("skipped")} (missing API key)`);
    return;
  }

  const spinner = startApiCheckSpinner(runtime);
  const result = await checkAuth({ apiKey, endpoint });
  spinner.stop();

  if (result.ok) {
    writeLine(runtime, `api check: ${color.green("ok")}`);
    return;
  }

  writeLine(runtime, `api check: ${color.red("failed")} ${result.message}`);
}

function startApiCheckSpinner(runtime: CliRuntime): { readonly stop: () => void } {
  const terminal = asTerminalStream(runtime.stdout);
  if (!terminal) {
    return { stop: () => undefined };
  }

  let index = 0;
  const render = (): void => {
    const frame = spinnerFrames[index % spinnerFrames.length] ?? "-";
    terminal.clearLine(0);
    terminal.cursorTo(0);
    terminal.write(`api check: ${color.yellow(frame)} checking remote`);
    index += 1;
  };

  render();
  const interval = setInterval(render, 80);

  return {
    stop: () => {
      clearInterval(interval);
      terminal.clearLine(0);
      terminal.cursorTo(0);
    },
  };
}

interface TerminalStream extends NodeJS.WritableStream {
  readonly isTTY: true;
  clearLine(dir: 0): boolean;
  cursorTo(x: 0): boolean;
}

function asTerminalStream(stream: NodeJS.WritableStream): TerminalStream | undefined {
  const candidate = stream as Partial<TerminalStream>;
  if (
    candidate.isTTY === true &&
    typeof candidate.clearLine === "function" &&
    typeof candidate.cursorTo === "function"
  ) {
    return candidate as TerminalStream;
  }

  return undefined;
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
    writeLine(runtime, `allowed projects: ${color.yellow("none")}`);
    return;
  }

  writeLine(runtime, "allowed projects:");
  for (const project of config.allowedProjects) {
    writeLine(
      runtime,
      `📂 ${color.dimGray(formatHomePath(project.path))} -> ${color.blue(project.displayName)}`,
    );
  }
}

function writeProjectConfig(
  projectPath: string,
  projectConfig: ProjectConfig | undefined,
  runtime: CliRuntime,
): void {
  if (!projectConfig) {
    writeLine(
      runtime,
      `project config: missing (${formatHomePath(resolveProjectConfigPath(projectPath))})`,
    );
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
