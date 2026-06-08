import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import Table from "cli-table3";
import { CliError } from "./errors.js";
import {
  getHookConfigStatus,
  HOOK_AGENT_DEFINITIONS,
  installHookConfig,
  type HookAgent,
} from "./hook-config.js";
import { getOpenClawHookStatus, installOpenClawHook } from "./openclaw-hook.js";
import { getOpencodeHookStatus, installOpencodeHook } from "./opencode-hook.js";
import { formatHomePath } from "./path-display.js";
import { getPiHookStatus, installPiHook } from "./pi-hook.js";
import type { CliRuntime } from "./runtime.js";

export type SetupAgent = HookAgent | "opencode" | "openclaw" | "pi";

export interface SetupOptions {
  readonly all?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly exclude?: string | undefined;
  readonly include?: string | undefined;
  readonly model?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly homeDirectory?: string | undefined;
  readonly pathEnv?: string | undefined;
  readonly codexConfig?: string | undefined;
  readonly claudeConfig?: string | undefined;
  readonly cursorConfig?: string | undefined;
  readonly hermesConfig?: string | undefined;
  readonly topchesterConfig?: string | undefined;
  readonly opencodePluginPath?: string | undefined;
  readonly openclawHookDir?: string | undefined;
  readonly piExtensionPath?: string | undefined;
}

export interface AgentDiscovery {
  readonly agent: SetupAgent;
  readonly detected: boolean;
  readonly signal?: string | undefined;
  readonly status?: string | undefined;
}

interface SetupAgentDefinition {
  readonly agent: SetupAgent;
  readonly displayName: string;
  readonly executable: string;
  readonly install: (options: ResolvedSetupOptions) => Promise<InstallOutcome>;
  readonly next?: string | undefined;
  readonly status: (options: ResolvedSetupOptions) => Promise<StatusOutcome>;
  readonly uninstallCommand: string;
}

interface ResolvedSetupOptions extends SetupOptions {
  readonly homeDirectory: string;
  readonly pathEnv: string;
}

interface StatusOutcome {
  readonly installed: boolean;
  readonly targetPath: string;
}

interface InstallOutcome {
  readonly changed: boolean;
  readonly targetPath: string;
}

interface SetupResult {
  readonly agent: SetupAgent;
  readonly detail: string;
  readonly next?: string | undefined;
  readonly status: "installed" | "already-installed" | "skipped" | "failed";
  readonly uninstallCommand?: string | undefined;
}

const CONFIG_AGENTS = ["codex", "claude", "cursor", "hermes", "topchester"] as const;

const SETUP_AGENTS: readonly SetupAgentDefinition[] = [
  ...CONFIG_AGENTS.map((agent) => configAgentDefinition(agent)),
  {
    agent: "opencode",
    displayName: "Opencode",
    executable: "opencode",
    uninstallCommand: "clankerlog integrations uninstall opencode",
    next: "restart Opencode so it loads the ClankerLog plugin",
    status: async (options) => {
      const status = await getOpencodeHookStatus({
        homeDirectory: options.homeDirectory,
        pluginPath: options.opencodePluginPath,
      });
      return { installed: status.installed, targetPath: status.pluginPath };
    },
    install: async (options) => {
      const plan = await installOpencodeHook({
        dryRun: options.dryRun,
        homeDirectory: options.homeDirectory,
        pluginPath: options.opencodePluginPath,
      });
      return { changed: plan.changed, targetPath: plan.pluginPath };
    },
  },
  {
    agent: "openclaw",
    displayName: "OpenClaw",
    executable: "openclaw",
    uninstallCommand: "clankerlog integrations uninstall openclaw",
    next: "run `openclaw hooks enable clankerlog` if OpenClaw has not enabled it yet",
    status: async (options) => {
      const status = await getOpenClawHookStatus({
        homeDirectory: options.homeDirectory,
        hookDir: options.openclawHookDir,
        inspectOpenClawCli: false,
      });
      return { installed: status.installed, targetPath: status.hookDir };
    },
    install: async (options) => {
      const plan = await installOpenClawHook({
        dryRun: options.dryRun,
        homeDirectory: options.homeDirectory,
        hookDir: options.openclawHookDir,
        inspectOpenClawCli: false,
      });
      return { changed: plan.changed, targetPath: plan.hookDir };
    },
  },
  {
    agent: "pi",
    displayName: "Pi",
    executable: "pi",
    uninstallCommand: "clankerlog integrations uninstall pi",
    next: "run `/reload` in Pi if an existing Pi session is already open",
    status: async (options) => {
      const status = await getPiHookStatus({
        homeDirectory: options.homeDirectory,
        extensionPath: options.piExtensionPath,
      });
      return { installed: status.installed, targetPath: status.extensionPath };
    },
    install: async (options) => {
      const plan = await installPiHook({
        dryRun: options.dryRun,
        homeDirectory: options.homeDirectory,
        extensionPath: options.piExtensionPath,
      });
      return { changed: plan.changed, targetPath: plan.extensionPath };
    },
  },
];

export async function handleSetup(options: SetupOptions, runtime: CliRuntime): Promise<void> {
  let resolved = resolveSetupOptions(options);
  const include = parseAgentSet("include", options.include);
  const exclude = parseAgentSet("exclude", options.exclude) ?? new Set<SetupAgent>();
  const discoveries = await discoverSetupAgents(resolved);
  const selected = selectedAgents(discoveries, resolved, include, exclude);
  const results: SetupResult[] = [];

  writeLine(runtime, "ClankerLog setup");
  writeLine(runtime, "");
  writeDiscovery(runtime, discoveries, selected, resolved.homeDirectory);

  if (selected.length === 0) {
    writeLine(runtime, "No supported coding agents detected.");
    writeLine(runtime, "Use `clankerlog setup --all` or `--include <agents>` to install anyway.");
    writeLine(runtime, "");
    writeLine(runtime, "Next: run clankerlog doctor to confirm ClankerLog is operational.");
    return;
  }

  const prompts = streamsAreTty(runtime) ? new PromptSession(runtime) : undefined;
  try {
    if (
      selected.some((definition) => definition.agent === "claude") &&
      !resolved.model?.trim() &&
      prompts
    ) {
      const model = await promptClaudeModel(prompts);
      if (model) {
        resolved = { ...resolved, model };
      }
    }

    if (prompts && shouldConfirm(resolved)) {
      const confirmed = await confirmSetup(prompts);
      if (!confirmed) {
        writeLine(runtime, "Setup aborted.");
        return;
      }
    }
  } finally {
    prompts?.close();
  }

  for (const definition of selected) {
    if (definition.agent === "claude" && !resolved.model?.trim()) {
      results.push({
        agent: definition.agent,
        detail: "Claude Code requires --model.",
        status: "skipped",
      });
      continue;
    }

    try {
      const plan = await definition.install(resolved);
      results.push({
        agent: definition.agent,
        detail: `${plan.changed ? (resolved.dryRun ? "would install" : "installed") : "already installed"} at ${formatSetupPath(plan.targetPath, resolved.homeDirectory)}`,
        next: definition.next,
        status: plan.changed ? "installed" : "already-installed",
        uninstallCommand: definition.uninstallCommand,
      });
    } catch (error) {
      results.push({
        agent: definition.agent,
        detail: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    }
  }

  writeSummary(runtime, results);
  writeLine(runtime, "");
  writeLine(runtime, "Next: run clankerlog doctor to confirm ClankerLog is operational.");

  if (results.some((result) => result.status === "failed")) {
    throw new CliError("Setup failed for one or more integrations.");
  }
}

export async function discoverSetupAgents(options: SetupOptions = {}): Promise<AgentDiscovery[]> {
  const resolved = resolveSetupOptions(options);
  const pathMatches = await executableSignals(resolved.pathEnv);

  return Promise.all(
    SETUP_AGENTS.map(async (definition) => {
      const executable = pathMatches.get(definition.executable);
      if (executable) {
        return {
          agent: definition.agent,
          detected: true,
          signal: "PATH executable",
          status: await integrationStatus(definition, resolved),
        };
      }

      const configDir = discoveryDirectory(definition.agent, resolved);
      if (await pathExists(configDir)) {
        return {
          agent: definition.agent,
          detected: true,
          signal: "config directory",
          status: await integrationStatus(definition, resolved),
        };
      }

      const status = await safeStatus(definition, resolved);
      if (status.outcome?.installed) {
        return {
          agent: definition.agent,
          detected: true,
          signal: "existing ClankerLog hook",
          status: "hook installed",
        };
      }

      return { agent: definition.agent, detected: false };
    }),
  );
}

function configAgentDefinition(agent: HookAgent): SetupAgentDefinition {
  return {
    agent,
    displayName: agent === "claude" ? "Claude Code" : titleCase(agent),
    executable: agent,
    uninstallCommand: `clankerlog integrations uninstall ${agent}`,
    next: agent === "codex" ? "run /hooks in Codex if command approval is required" : undefined,
    status: async (options) => {
      const status = await getHookConfigStatus(agent, {
        configPath: configAgentPathOverride(agent, options),
        homeDirectory: options.homeDirectory,
        model: options.model,
      });
      return { installed: status.installed, targetPath: status.targetPath };
    },
    install: async (options) => {
      const plan = await installHookConfig(agent, {
        configPath: configAgentPathOverride(agent, options),
        dryRun: options.dryRun,
        homeDirectory: options.homeDirectory,
        model: options.model,
      });
      return { changed: plan.changed, targetPath: plan.targetPath };
    },
  };
}

function writeDiscovery(
  runtime: CliRuntime,
  discoveries: readonly AgentDiscovery[],
  selected: readonly SetupAgentDefinition[],
  homeDirectory: string,
): void {
  const selectedAgents = new Set(selected.map((entry) => entry.agent));
  const style = setupStyle(runtime);
  const detected = discoveries.filter((entry) => entry.detected);
  writeLine(runtime, style.heading("Detected integrations"));
  if (detected.length > 0) {
    writeDetectedTable(runtime, detected, style);
  } else {
    writeLine(runtime, `  ${style.skippedIcon} none`);
  }

  writeLine(runtime, "");
  writeLine(runtime, style.heading("Skipped integrations"));
  for (const discovery of discoveries.filter((entry) => !selectedAgents.has(entry.agent))) {
    const reason = discovery.detected ? "excluded" : "not detected";
    writeLine(runtime, `  ${style.skippedIcon} ${padAgent(discovery.agent)} ${reason}`);
  }

  if (discoveries.every((entry) => selectedAgents.has(entry.agent))) {
    writeLine(runtime, `  ${style.skippedIcon} none`);
  }

  writeLine(runtime, "");
  writeLine(runtime, `${style.homeIcon} Home: ${formatSetupPath(homeDirectory, homeDirectory)}`);
  writeLine(runtime, "");
}

function writeSummary(runtime: CliRuntime, results: readonly SetupResult[]): void {
  const style = setupStyle(runtime);
  writeLine(runtime, style.heading("Installed integrations"));
  writeResultGroup(runtime, results, ["installed", "already-installed"]);
  writeLine(runtime, "");
  writeLine(runtime, style.heading("Skipped integrations"));
  writeResultGroup(runtime, results, ["skipped"]);
  writeLine(runtime, "");
  writeLine(runtime, style.heading("Failed integrations"));
  writeResultGroup(runtime, results, ["failed"]);
}

function writeDetectedTable(
  runtime: CliRuntime,
  discoveries: readonly AgentDiscovery[],
  style: ReturnType<typeof setupStyle>,
): void {
  const rows = discoveries.map((discovery) => {
    const status = discovery.status ?? "detected";
    return [
      `${style.statusIcon(status)} ${discovery.agent}`,
      hookStatusLabel(status),
      discovery.signal ?? "detected",
    ] as const;
  });
  const table = new Table({
    head: ["Agent", "ClankerLog hook", "Detected by"],
    style: {
      border: [],
      head: [],
    },
  });
  for (const row of rows) {
    table.push([...row]);
  }

  for (const line of table.toString().split("\n")) {
    writeLine(runtime, `  ${line}`);
  }
}

function writeResultGroup(
  runtime: CliRuntime,
  results: readonly SetupResult[],
  statuses: readonly SetupResult["status"][],
): void {
  const style = setupStyle(runtime);
  const group = results.filter((result) => statuses.includes(result.status));
  if (group.length === 0) {
    writeLine(runtime, `  ${style.skippedIcon} none`);
    return;
  }

  for (const result of group) {
    writeLine(
      runtime,
      `  ${style.resultIcon(result.status)} ${padAgent(result.agent)} ${result.detail}`,
    );
    if (result.uninstallCommand) {
      writeLine(runtime, `      🧹 remove: ${result.uninstallCommand}`);
    }
    if (result.next) {
      writeLine(runtime, `      ➜ next: ${result.next}`);
    }
  }
}

function selectedAgents(
  discoveries: readonly AgentDiscovery[],
  options: ResolvedSetupOptions,
  include: ReadonlySet<SetupAgent> | undefined,
  exclude: ReadonlySet<SetupAgent>,
): SetupAgentDefinition[] {
  return SETUP_AGENTS.filter((definition) => {
    if (exclude.has(definition.agent)) {
      return false;
    }

    if (include) {
      return include.has(definition.agent);
    }

    if (options.all) {
      return true;
    }

    return discoveries.some((entry) => entry.agent === definition.agent && entry.detected);
  });
}

async function integrationStatus(
  definition: SetupAgentDefinition,
  options: ResolvedSetupOptions,
): Promise<string> {
  const status = await safeStatus(definition, options);
  if (status.error) {
    return `unavailable (${status.error})`;
  }
  return status.outcome?.installed ? "hook installed" : "hook not installed";
}

async function safeStatus(
  definition: SetupAgentDefinition,
  options: ResolvedSetupOptions,
): Promise<
  | { readonly outcome: StatusOutcome; readonly error?: undefined }
  | { readonly outcome?: undefined; readonly error: string }
> {
  try {
    return { outcome: await definition.status(options) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function setupStyle(runtime: CliRuntime): {
  readonly detectedIcon: string;
  readonly heading: (value: string) => string;
  readonly homeIcon: string;
  readonly resultIcon: (status: SetupResult["status"]) => string;
  readonly skippedIcon: string;
  readonly statusIcon: (status: string) => string;
} {
  const color = terminalColor(runtime.stdout);
  return {
    detectedIcon: color.green("✅"),
    heading: (value) => color.bold(value),
    homeIcon: color.blue("⌂"),
    resultIcon: (status) => {
      if (status === "failed") {
        return color.red("✖");
      }
      if (status === "skipped") {
        return color.yellow("○");
      }
      if (status === "already-installed") {
        return color.green("✓");
      }
      return color.green("✅");
    },
    skippedIcon: color.dim("○"),
    statusIcon: (status) => {
      if (status === "hook installed") {
        return color.green("✓");
      }
      if (status.startsWith("unavailable")) {
        return color.yellow("!");
      }
      return color.dim("○");
    },
  };
}

function terminalColor(stream: NodeJS.WritableStream): {
  readonly blue: (value: string) => string;
  readonly bold: (value: string) => string;
  readonly dim: (value: string) => string;
  readonly green: (value: string) => string;
  readonly red: (value: string) => string;
  readonly yellow: (value: string) => string;
} {
  const enabled = streamIsTty(stream);
  const wrap = (open: string, close = "\x1b[0m") =>
    enabled ? (value: string) => `${open}${value}${close}` : (value: string) => value;

  return {
    blue: wrap("\x1b[34m"),
    bold: wrap("\x1b[1m"),
    dim: wrap("\x1b[2;90m"),
    green: wrap("\x1b[32m"),
    red: wrap("\x1b[31m"),
    yellow: wrap("\x1b[33m"),
  };
}

function shouldConfirm(options: ResolvedSetupOptions): boolean {
  return !options.yes && !options.dryRun;
}

async function confirmSetup(prompts: PromptSession): Promise<boolean> {
  const answer = (await prompts.question("Install selected integrations? [y/N] "))
    .trim()
    .toLowerCase();
  return answer === "y" || answer === "yes";
}

async function promptClaudeModel(prompts: PromptSession): Promise<string | undefined> {
  const answer = (
    await prompts.question("Claude Code model, for example claude-opus-4.6: ")
  ).trim();
  return answer || undefined;
}

class PromptSession {
  private buffer = "";
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string) => void)[] = [];

  constructor(private readonly runtime: CliRuntime) {
    runtime.stdin.setEncoding("utf8");
    runtime.stdin.on("data", this.onData);
    runtime.stdin.on("end", this.onEnd);
  }

  question(prompt: string): Promise<string> {
    this.runtime.stdout.write(prompt);
    const line = this.lines.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.runtime.stdin.off("data", this.onData);
    this.runtime.stdin.off("end", this.onEnd);
  }

  private readonly onData = (chunk: string | Buffer): void => {
    this.buffer += chunk.toString();
    let lineEnd = this.buffer.search(/\r?\n/);
    while (lineEnd !== -1) {
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(
        this.buffer[lineEnd] === "\r" && this.buffer[lineEnd + 1] === "\n"
          ? lineEnd + 2
          : lineEnd + 1,
      );
      this.pushLine(line);
      lineEnd = this.buffer.search(/\r?\n/);
    }
  };

  private readonly onEnd = (): void => {
    if (this.buffer) {
      this.pushLine(this.buffer);
      this.buffer = "";
    }
    while (this.waiters.length > 0) {
      this.waiters.shift()?.("");
    }
  };

  private pushLine(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }
}

function parseAgentSet(
  label: "include" | "exclude",
  value: string | undefined,
): ReadonlySet<SetupAgent> | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = new Set<SetupAgent>();
  for (const raw of value.split(",")) {
    const agent = raw.trim();
    if (!agent) {
      continue;
    }
    if (!isSetupAgent(agent)) {
      throw new CliError(`Unknown ${label} integration: ${agent}.`);
    }
    parsed.add(agent);
  }
  return parsed;
}

function resolveSetupOptions(options: SetupOptions): ResolvedSetupOptions {
  return {
    ...options,
    homeDirectory: path.resolve(options.homeDirectory ?? homedir()),
    pathEnv: options.pathEnv ?? process.env.PATH ?? "",
  };
}

async function executableSignals(pathEnv: string): Promise<Map<string, string>> {
  const signals = new Map<string, string>();
  const executableNames = new Set(SETUP_AGENTS.map((definition) => definition.executable));
  for (const directory of pathEnv.split(path.delimiter).filter(Boolean)) {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }

    for (const executable of executableNames) {
      if (!entries.includes(executable) || signals.has(executable)) {
        continue;
      }
      const candidate = path.join(directory, executable);
      if (await isExecutable(candidate)) {
        signals.set(executable, candidate);
      }
    }
  }
  return signals;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultTargetPath(agent: SetupAgent, options: ResolvedSetupOptions): string {
  if (isConfigAgent(agent)) {
    return (
      configAgentPathOverride(agent, options) ??
      HOOK_AGENT_DEFINITIONS[agent].configPath(options.homeDirectory)
    );
  }

  if (agent === "opencode") {
    return (
      options.opencodePluginPath ??
      path.join(options.homeDirectory, ".config", "opencode", "plugins", "clankerlog.ts")
    );
  }

  if (agent === "openclaw") {
    return (
      options.openclawHookDir ??
      path.join(options.homeDirectory, ".openclaw", "hooks", "clankerlog")
    );
  }

  return (
    options.piExtensionPath ??
    path.join(options.homeDirectory, ".pi", "agent", "extensions", "clankerlog.ts")
  );
}

function discoveryDirectory(agent: SetupAgent, options: ResolvedSetupOptions): string {
  if (isConfigAgent(agent)) {
    return path.dirname(defaultTargetPath(agent, options));
  }

  if (agent === "opencode") {
    return path.join(options.homeDirectory, ".config", "opencode");
  }

  if (agent === "openclaw") {
    return path.join(options.homeDirectory, ".openclaw");
  }

  return path.join(options.homeDirectory, ".pi", "agent");
}

function configAgentPathOverride(agent: HookAgent, options: SetupOptions): string | undefined {
  if (agent === "codex") {
    return options.codexConfig;
  }
  if (agent === "claude") {
    return options.claudeConfig;
  }
  if (agent === "cursor") {
    return options.cursorConfig;
  }
  if (agent === "hermes") {
    return options.hermesConfig;
  }
  return options.topchesterConfig;
}

function isSetupAgent(value: string): value is SetupAgent {
  return SETUP_AGENTS.some((definition) => definition.agent === value);
}

function isConfigAgent(agent: SetupAgent): agent is HookAgent {
  return CONFIG_AGENTS.includes(agent as HookAgent);
}

function streamIsTty(stream: NodeJS.ReadableStream | NodeJS.WritableStream): boolean {
  return Boolean((stream as NodeJS.ReadStream | NodeJS.WriteStream).isTTY);
}

function streamsAreTty(runtime: CliRuntime): boolean {
  return streamIsTty(runtime.stdin) && streamIsTty(runtime.stdout);
}

function padAgent(agent: SetupAgent): string {
  return agent.padEnd(11, " ");
}

function hookStatusLabel(status: string): string {
  if (status === "hook installed") {
    return "installed";
  }
  if (status === "hook not installed") {
    return "not installed";
  }
  if (status.startsWith("unavailable")) {
    return "unavailable";
  }
  return status;
}

function formatSetupPath(filePath: string, setupHomeDirectory: string): string {
  const currentHomePath = formatHomePath(filePath);
  return currentHomePath.startsWith("~")
    ? currentHomePath
    : formatHomePath(filePath, setupHomeDirectory);
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function writeLine(runtime: CliRuntime, line = ""): void {
  runtime.stdout.write(`${line}\n`);
}
