import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import {
  globalConfigSchema,
  projectConfigSchema,
  type GlobalConfig,
  type GlobalConfigInput,
  type ProjectConfig,
} from "./schemas.js";

export class ConfigError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    this.cause = cause;
  }
}

export interface ConfigPathsOptions {
  readonly configPath?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly home?: string | undefined;
}

export function createDefaultGlobalConfig(): GlobalConfig {
  return { allowedProjects: [], autoTrackProjects: false };
}

export function resolveGlobalConfigPath(options: ConfigPathsOptions = {}): string {
  if (options.configPath) {
    return options.configPath;
  }

  const env = options.env ?? process.env;
  const configHome = env.XDG_CONFIG_HOME || path.join(options.home ?? homedir(), ".config");
  return path.join(configHome, "clankerlog", "config.json");
}

export async function loadGlobalConfig(configPath: string): Promise<GlobalConfig> {
  if (!(await fileExists(configPath))) {
    return createDefaultGlobalConfig();
  }

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(`Could not read config at ${configPath}`, error);
  }

  return parseJsonConfig(raw, configPath, globalConfigSchema);
}

export async function saveGlobalConfig(
  configPath: string,
  config: GlobalConfigInput,
): Promise<void> {
  const parsed = globalConfigSchema.parse(config);
  const dir = path.dirname(configPath);

  try {
    await mkdir(dir, { mode: 0o700, recursive: true });
    await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
  } catch (error) {
    throw new ConfigError(`Could not write config at ${configPath}`, error);
  }
}

export function resolveProjectConfigPath(projectPath: string): string {
  return path.join(projectPath, ".clankerlog.json");
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | undefined> {
  const configPath = resolveProjectConfigPath(projectPath);

  if (!(await fileExists(configPath))) {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(`Could not read project config at ${configPath}`, error);
  }

  return parseJsonConfig(raw, configPath, projectConfigSchema);
}

export async function saveProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  const configPath = resolveProjectConfigPath(projectPath);
  const parsed = projectConfigSchema.parse(config);

  try {
    await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    throw new ConfigError(`Could not write project config at ${configPath}`, error);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseJsonConfig<T>(
  raw: string,
  filePath: string,
  schema: { parse: (value: unknown) => T },
): T {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Config at ${filePath} is not valid JSON`, error);
  }

  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigError(
        `Config at ${filePath} is invalid: ${error.issues[0]?.message ?? "schema validation failed"}`,
        error,
      );
    }

    throw error;
  }
}
