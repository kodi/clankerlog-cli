import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Option, type Command } from "commander";
import { CliError } from "../errors.js";
import { writeLine } from "../output.js";
import { createRuntime, type CliRuntime } from "../runtime.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as {
  name: string;
  version: string;
};

const defaultRegistryUrl = "https://registry.npmjs.org";
const packageManagers = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManager = (typeof packageManagers)[number];

export interface UpdateOptions {
  readonly check?: boolean;
  readonly dryRun?: boolean;
  readonly manager?: PackageManager;
  readonly registry?: string;
}

export interface UpdateDependencies {
  readonly fetchLatestVersion?: typeof fetchLatestVersion;
  readonly runPackageCommand?: typeof runPackageCommand;
}

interface UpdateStatus {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for and install the latest ClankerLog CLI.")
    .option("--check", "Only check whether a newer version is available")
    .option("--dry-run", "Print the package-manager command without running it")
    .addOption(
      new Option("--manager <manager>", "Package manager to use for the global install")
        .choices([...packageManagers])
        .default(undefined),
    )
    .option("--registry <url>", "NPM registry URL")
    .action(async (options: UpdateOptions, command: Command) => {
      await handleUpdate(options, createRuntime(command));
    });
}

export async function handleUpdate(
  options: UpdateOptions,
  runtime: CliRuntime,
  dependencies: UpdateDependencies = {},
): Promise<void> {
  const fetchVersion = dependencies.fetchLatestVersion ?? fetchLatestVersion;
  const runCommand = dependencies.runPackageCommand ?? runPackageCommand;
  const registryUrl = options.registry ?? runtime.env.npm_config_registry ?? defaultRegistryUrl;
  const latestVersion = await fetchVersion(packageJson.name, registryUrl);
  const status = getUpdateStatus(packageJson.version, latestVersion);

  if (!status.updateAvailable) {
    writeLine(runtime, `clankerlog is up to date (${status.currentVersion}).`);
    return;
  }

  writeLine(
    runtime,
    `Update available: ${packageJson.name} ${status.currentVersion} -> ${status.latestVersion}`,
  );

  if (options.check) {
    writeLine(runtime, "Run `clankerlog update` to install it.");
    return;
  }

  const manager = options.manager ?? detectPackageManager(runtime.env);
  const updateCommand = getUpdateCommand(manager, packageJson.name);
  const commandText = shellCommandText(updateCommand.command, updateCommand.args);

  if (options.dryRun) {
    writeLine(runtime, `Would run: ${commandText}`);
    return;
  }

  writeLine(runtime, `Running: ${commandText}`);
  await runCommand(updateCommand.command, updateCommand.args, runtime);
  writeLine(runtime, `Updated ${packageJson.name} to ${status.latestVersion}.`);
}

export async function fetchLatestVersion(
  packageName: string,
  registryUrl = defaultRegistryUrl,
): Promise<string> {
  const url = `${registryUrl.replace(/\/+$/, "")}/${encodePackageName(packageName)}/latest`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
  });

  if (!response.ok) {
    throw new CliError(`Could not check npm for ${packageName}: HTTP ${response.status}`);
  }

  const json = (await response.json()) as { version?: unknown };
  if (typeof json.version !== "string" || json.version.length === 0) {
    throw new CliError(`Could not read the latest ${packageName} version from npm.`);
  }

  return json.version;
}

export function getUpdateStatus(currentVersion: string, latestVersion: string): UpdateStatus {
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
  };
}

export function detectPackageManager(env: NodeJS.ProcessEnv): PackageManager {
  const userAgent = env.npm_config_user_agent;

  if (userAgent) {
    for (const manager of packageManagers) {
      if (userAgent.startsWith(`${manager}/`)) {
        return manager;
      }
    }
  }

  return "npm";
}

export function getUpdateCommand(
  manager: PackageManager,
  packageName: string,
): { readonly command: string; readonly args: readonly string[] } {
  const packageSpec = `${packageName}@latest`;

  switch (manager) {
    case "bun":
      return { command: "bun", args: ["add", "-g", packageSpec] };
    case "pnpm":
      return { command: "pnpm", args: ["add", "-g", packageSpec] };
    case "yarn":
      return { command: "yarn", args: ["global", "add", packageSpec] };
    case "npm":
      return { command: "npm", args: ["install", "-g", packageSpec] };
  }
}

async function runPackageCommand(
  command: string,
  args: readonly string[],
  runtime: CliRuntime,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: runtime.cwd,
      env: runtime.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      runtime.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      runtime.stderr.write(chunk);
    });
    child.on("error", (error) => {
      reject(new CliError(`Could not run ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new CliError(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function encodePackageName(packageName: string): string {
  return packageName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("%2F");
}

function shellCommandText(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  if (!parsedA || !parsedB) {
    return a.localeCompare(b);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const diff = parsedA[key] - parsedB[key];
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  if (parsedA.prerelease.length === 0 && parsedB.prerelease.length > 0) {
    return 1;
  }
  if (parsedA.prerelease.length > 0 && parsedB.prerelease.length === 0) {
    return -1;
  }

  const segmentCount = Math.max(parsedA.prerelease.length, parsedB.prerelease.length);
  for (let index = 0; index < segmentCount; index += 1) {
    const segmentA = parsedA.prerelease[index];
    const segmentB = parsedB.prerelease[index];

    if (segmentA === undefined) {
      return -1;
    }
    if (segmentB === undefined) {
      return 1;
    }
    if (segmentA === segmentB) {
      continue;
    }

    const numberA = numberSegment(segmentA);
    const numberB = numberSegment(segmentB);
    if (numberA !== undefined && numberB !== undefined) {
      return numberA > numberB ? 1 : -1;
    }
    if (numberA !== undefined) {
      return -1;
    }
    if (numberB !== undefined) {
      return 1;
    }

    return segmentA > segmentB ? 1 : -1;
  }

  return 0;
}

function parseSemver(version: string):
  | {
      readonly major: number;
      readonly minor: number;
      readonly patch: number;
      readonly prerelease: readonly string[];
    }
  | undefined {
  const [withoutBuild] = version.replace(/^v/, "").split("+");
  if (!withoutBuild) {
    return undefined;
  }

  const [core, prerelease = ""] = withoutBuild.split("-");
  const parts = core?.split(".").map((part) => Number.parseInt(part, 10));
  if (!parts || parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }

  const [major, minor, patch] = parts as [number, number, number];
  return {
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.split(".") : [],
  };
}

function numberSegment(segment: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    return undefined;
  }

  return Number.parseInt(segment, 10);
}
