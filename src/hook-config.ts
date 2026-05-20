import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CliError } from "./errors.js";

export type HookAgent = "codex" | "claude" | "cursor" | "hermes";

export interface HookAgentDefinition {
  readonly agent: HookAgent;
  readonly configPath: (homeDirectory: string) => string;
  readonly defaultTimeoutSeconds: number;
  readonly statusMessage: string;
}

export interface InstallHookOptions {
  readonly model?: string | undefined;
}

export interface HookConfigFileOptions extends InstallHookOptions {
  readonly configPath?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly homeDirectory?: string | undefined;
}

export interface HookTransformPlan {
  readonly action: "install" | "already-installed" | "uninstall" | "not-installed";
  readonly agent: HookAgent;
  readonly changed: boolean;
  readonly command?: string | undefined;
  readonly config: HookConfigObject;
  readonly summary: string;
}

export interface HookConfigFilePlan extends HookTransformPlan {
  readonly dryRun: boolean;
  readonly targetPath: string;
  readonly willWrite: boolean;
}

export interface HookStatus {
  readonly agent: HookAgent;
  readonly command?: string | undefined;
  readonly installed: boolean;
  readonly commandMatchesExpected: boolean;
}

export type HookConfigObject = Record<string, unknown>;

interface StopHookLocation {
  readonly format: "grouped" | "direct" | "hermes";
  readonly groupIndex: number;
  readonly hookIndex: number;
  readonly hook: HookConfigObject;
}

export const HOOK_AGENT_DEFINITIONS: Record<HookAgent, HookAgentDefinition> = {
  claude: {
    agent: "claude",
    configPath: (homeDirectory: string) => path.join(homeDirectory, ".claude", "settings.json"),
    defaultTimeoutSeconds: 10,
    statusMessage: "Sending ClankerLog clank",
  },
  codex: {
    agent: "codex",
    configPath: (homeDirectory: string) => path.join(homeDirectory, ".codex", "hooks.json"),
    defaultTimeoutSeconds: 10,
    statusMessage: "Sending ClankerLog clank",
  },
  cursor: {
    agent: "cursor",
    configPath: (homeDirectory: string) => path.join(homeDirectory, ".cursor", "hooks.json"),
    defaultTimeoutSeconds: 10,
    statusMessage: "Sending ClankerLog clank",
  },
  hermes: {
    agent: "hermes",
    configPath: (homeDirectory: string) => path.join(homeDirectory, ".hermes", "config.yaml"),
    defaultTimeoutSeconds: 10,
    statusMessage: "Sending ClankerLog clank",
  },
};

export function planInstallHook(
  config: unknown,
  agent: HookAgent,
  options: InstallHookOptions = {},
): HookTransformPlan {
  const source = validateHookConfig(config);
  const command = buildHookCommand(agent, options);
  const status = getHookStatus(source, agent);

  if (status.installed) {
    return {
      action: "already-installed",
      agent,
      changed: false,
      command: status.command ?? command,
      config: source,
      summary: `ClankerLog ${agent} Stop hook is already installed.`,
    };
  }

  const nextConfig = cloneHookConfig(source);
  const hooks = ensureObjectProperty(nextConfig, "hooks");

  if (agent === "cursor" || agent === "hermes") {
    const stop = ensureDirectStopHooks(hooks, directStopKey(agent));
    stop.push(buildHookObject(agent, command));

    return {
      action: "install",
      agent,
      changed: true,
      command,
      config: nextConfig,
      summary: `Install ClankerLog ${agent} Stop hook.`,
    };
  }

  const stop = ensureStopGroups(hooks);
  const group = stop[0] ?? { hooks: [] };
  const groupHooks = getGroupHooks(group);

  if (!stop[0]) {
    stop.push(group);
  }

  groupHooks.push(buildHookObject(agent, command));

  return {
    action: "install",
    agent,
    changed: true,
    command,
    config: nextConfig,
    summary: `Install ClankerLog ${agent} Stop hook.`,
  };
}

export async function installHookConfig(
  agent: HookAgent,
  options: HookConfigFileOptions = {},
): Promise<HookConfigFilePlan> {
  const targetPath = resolveHookConfigPath(agent, options);
  const config = await loadHookConfigFile(targetPath, agent);
  const plan = planInstallHook(config, agent, options);
  return applyHookConfigFilePlan(targetPath, plan, options.dryRun ?? false);
}

export function planUninstallHook(config: unknown, agent: HookAgent): HookTransformPlan {
  const source = validateHookConfig(config);
  const locations = findClankerLogHooks(source, agent);

  if (locations.length === 0) {
    return {
      action: "not-installed",
      agent,
      changed: false,
      config: source,
      summary: `ClankerLog ${agent} Stop hook is not installed.`,
    };
  }

  const nextConfig = cloneHookConfig(source);
  const hooks = nextConfig.hooks as HookConfigObject;

  for (const location of locations.toReversed()) {
    if (location.format === "direct" || location.format === "hermes") {
      const stop = hooks[directStopKey(agent)] as HookConfigObject[];
      stop.splice(location.hookIndex, 1);
    } else {
      const stop = hooks.Stop as HookConfigObject[];
      const group = stop[location.groupIndex] as HookConfigObject;
      const groupHooks = group.hooks as HookConfigObject[];
      groupHooks.splice(location.hookIndex, 1);
    }
  }

  return {
    action: "uninstall",
    agent,
    changed: true,
    command: getHookCommand(locations[0]?.hook),
    config: nextConfig,
    summary: `Remove ClankerLog ${agent} Stop hook.`,
  };
}

export async function uninstallHookConfig(
  agent: HookAgent,
  options: HookConfigFileOptions = {},
): Promise<HookConfigFilePlan> {
  const targetPath = resolveHookConfigPath(agent, options);
  const config = await loadHookConfigFile(targetPath, agent);
  const plan = planUninstallHook(config, agent);
  return applyHookConfigFilePlan(targetPath, plan, options.dryRun ?? false);
}

export function getHookStatus(config: unknown, agent: HookAgent): HookStatus {
  const source = validateHookConfig(config);
  const hook = findClankerLogHooks(source, agent)[0]?.hook;
  const command = getHookCommand(hook);

  return {
    agent,
    command,
    commandMatchesExpected: hook ? isExpectedClankerLogHook(hook, agent) : false,
    installed: Boolean(hook),
  };
}

export async function getHookConfigStatus(
  agent: HookAgent,
  options: HookConfigFileOptions = {},
): Promise<HookStatus & { readonly targetPath: string }> {
  const targetPath = resolveHookConfigPath(agent, options);
  const config = await loadHookConfigFile(targetPath, agent);

  return {
    ...getHookStatus(config, agent),
    targetPath,
  };
}

export function resolveHookConfigPath(
  agent: HookAgent,
  options: Pick<HookConfigFileOptions, "configPath" | "homeDirectory"> = {},
): string {
  if (options.configPath) {
    return path.resolve(options.configPath);
  }

  return HOOK_AGENT_DEFINITIONS[agent].configPath(options.homeDirectory ?? homedir());
}

export async function loadHookConfigFile(
  configPath: string,
  agent: HookAgent = "codex",
): Promise<HookConfigObject> {
  if (!(await fileExists(configPath))) {
    return {};
  }

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new CliError(`Could not read hook config at ${configPath}: ${formatCause(error)}.`);
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() ? parseHookConfigContent(raw, agent) : {};
  } catch {
    throw new CliError(`Hook config at ${configPath} is not valid ${configFormat(agent)}.`);
  }

  try {
    return validateHookConfig(parsed);
  } catch (error) {
    throw new CliError(`Hook config at ${configPath} is unsupported: ${formatCause(error)}.`);
  }
}

export async function writeHookConfigFileAtomic(
  configPath: string,
  config: HookConfigObject,
  agent: HookAgent = "codex",
): Promise<void> {
  await mkdir(path.dirname(configPath), { mode: 0o700, recursive: true });

  const tempPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, serializeHookConfigContent(config, agent), { mode: 0o600 });
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new CliError(`Could not write hook config at ${configPath}: ${formatCause(error)}.`);
  }
}

export function buildHookCommand(agent: HookAgent, options: InstallHookOptions = {}): string {
  if (agent === "codex") {
    return "clankerlog hook codex stop";
  }

  if (agent === "cursor") {
    const modelPrefix = options.model?.trim()
      ? `CLANKERLOG_MODEL=${shellQuote(options.model.trim())} `
      : "";
    return `${modelPrefix}clankerlog hook cursor stop`;
  }

  if (agent === "hermes") {
    return "clankerlog hook hermes stop";
  }

  const model = options.model?.trim();
  if (!model) {
    throw new CliError(
      "Claude Code hook install requires --model, for example `--model claude-sonnet-4.5`.",
    );
  }

  return `CLANKERLOG_MODEL=${shellQuote(model)} clankerlog hook claude stop`;
}

async function applyHookConfigFilePlan(
  targetPath: string,
  plan: HookTransformPlan,
  dryRun: boolean,
): Promise<HookConfigFilePlan> {
  if (plan.changed && !dryRun) {
    await writeHookConfigFileAtomic(targetPath, plan.config, plan.agent);
  }

  return {
    ...plan,
    dryRun,
    targetPath,
    willWrite: plan.changed,
  };
}

export function validateHookConfig(config: unknown): HookConfigObject {
  if (!isPlainObject(config)) {
    throw new CliError("Hook config must be a JSON object.");
  }

  const hooks = config.hooks;
  if (hooks === undefined) {
    return config;
  }

  if (!isPlainObject(hooks)) {
    throw new CliError("Hook config `hooks` must be a JSON object.");
  }

  const stop = hooks.Stop;
  if (stop !== undefined) {
    if (!Array.isArray(stop)) {
      throw new CliError("Hook config `hooks.Stop` must be an array.");
    }

    for (const [groupIndex, group] of stop.entries()) {
      if (!isPlainObject(group)) {
        throw new CliError(`Hook config \`hooks.Stop[${groupIndex}]\` must be an object.`);
      }

      if (!Array.isArray(group.hooks)) {
        throw new CliError(`Hook config \`hooks.Stop[${groupIndex}].hooks\` must be an array.`);
      }

      for (const [hookIndex, hook] of group.hooks.entries()) {
        if (!isPlainObject(hook)) {
          throw new CliError(
            `Hook config \`hooks.Stop[${groupIndex}].hooks[${hookIndex}]\` must be an object.`,
          );
        }
      }
    }
  }

  for (const key of ["stop", "post_llm_call"]) {
    const directStop = hooks[key];
    if (directStop === undefined) {
      continue;
    }

    if (!Array.isArray(directStop)) {
      throw new CliError(`Hook config \`hooks.${key}\` must be an array.`);
    }

    for (const [hookIndex, hook] of directStop.entries()) {
      if (!isPlainObject(hook)) {
        throw new CliError(`Hook config \`hooks.${key}[${hookIndex}]\` must be an object.`);
      }
    }
  }

  return config;
}

function buildHookObject(agent: HookAgent, command: string): HookConfigObject {
  if (agent === "cursor") {
    return {
      command,
    };
  }

  if (agent === "hermes") {
    return {
      command,
      timeout: HOOK_AGENT_DEFINITIONS.hermes.defaultTimeoutSeconds,
    };
  }

  const definition = HOOK_AGENT_DEFINITIONS[agent];

  return {
    type: "command",
    command,
    timeout: definition.defaultTimeoutSeconds,
    statusMessage: definition.statusMessage,
  };
}

function ensureObjectProperty(target: HookConfigObject, key: string): HookConfigObject {
  const value = target[key];
  if (isPlainObject(value)) {
    return value;
  }

  const next: HookConfigObject = {};
  target[key] = next;
  return next;
}

function ensureStopGroups(hooks: HookConfigObject): HookConfigObject[] {
  const stop = hooks.Stop;
  if (Array.isArray(stop)) {
    return stop;
  }

  const next: HookConfigObject[] = [];
  hooks.Stop = next;
  return next;
}

function ensureDirectStopHooks(hooks: HookConfigObject, key: string): HookConfigObject[] {
  const stop = hooks[key];
  if (Array.isArray(stop)) {
    return stop;
  }

  const next: HookConfigObject[] = [];
  hooks[key] = next;
  return next;
}

function getGroupHooks(group: HookConfigObject): HookConfigObject[] {
  if (Array.isArray(group.hooks)) {
    return group.hooks as HookConfigObject[];
  }

  const hooks: HookConfigObject[] = [];
  group.hooks = hooks;
  return hooks;
}

function findClankerLogHooks(config: HookConfigObject, agent: HookAgent): StopHookLocation[] {
  const hooks = config.hooks;
  if (!isPlainObject(hooks)) {
    return [];
  }

  const locations: StopHookLocation[] = [];

  if ((agent === "cursor" || agent === "hermes") && Array.isArray(hooks[directStopKey(agent)])) {
    for (const [hookIndex, hook] of (hooks[directStopKey(agent)] as HookConfigObject[]).entries()) {
      if (isPlainObject(hook) && isClankerLogHook(hook, agent)) {
        locations.push({
          format: agent === "hermes" ? "hermes" : "direct",
          groupIndex: -1,
          hookIndex,
          hook,
        });
      }
    }

    return locations;
  }

  if (!Array.isArray(hooks.Stop)) {
    return [];
  }

  for (const [groupIndex, group] of hooks.Stop.entries()) {
    const groupHooks = (group as HookConfigObject).hooks;
    if (!Array.isArray(groupHooks)) {
      continue;
    }

    for (const [hookIndex, hook] of groupHooks.entries()) {
      if (isPlainObject(hook) && isClankerLogHook(hook, agent)) {
        locations.push({ format: "grouped", groupIndex, hookIndex, hook });
      }
    }
  }

  return locations;
}

function isClankerLogHook(hook: HookConfigObject, agent: HookAgent): boolean {
  const marker = hook.clankerlog;
  if (isPlainObject(marker) && marker.agent === agent && marker.version === 1) {
    return true;
  }

  return isExpectedClankerLogHook(hook, agent) || isLegacyClankerLogHook(hook, agent);
}

function isExpectedClankerLogHook(hook: HookConfigObject, agent: HookAgent): boolean {
  if (agent !== "cursor" && agent !== "hermes" && hook.type !== "command") {
    return false;
  }

  if (
    agent !== "cursor" &&
    agent !== "hermes" &&
    hook.statusMessage !== HOOK_AGENT_DEFINITIONS[agent].statusMessage
  ) {
    return false;
  }

  const command = getHookCommand(hook);
  if (!command) {
    return false;
  }

  if (agent === "codex") {
    return command === buildHookCommand("codex");
  }

  if (agent === "cursor") {
    return (
      command === buildHookCommand("cursor") ||
      /^CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook cursor stop$/.test(command)
    );
  }

  if (agent === "hermes") {
    return command === buildHookCommand("hermes");
  }

  return /^CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook claude stop$/.test(command);
}

function isLegacyClankerLogHook(hook: HookConfigObject, agent: HookAgent): boolean {
  const command = getHookCommand(hook);
  if (!command) {
    return false;
  }

  if (agent === "codex") {
    return command === "CLANKERLOG_AGENT=codex clankerlog hook codex stop";
  }

  if (agent === "cursor") {
    return (
      command === "CLANKERLOG_AGENT=cursor clankerlog hook cursor stop" ||
      /^CLANKERLOG_AGENT=cursor CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook cursor stop$/.test(
        command,
      )
    );
  }

  if (agent === "claude") {
    return /^CLANKERLOG_AGENT=claude CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook claude stop$/.test(
      command,
    );
  }

  if (agent === "hermes") {
    return /^CLANKERLOG_AGENT=hermes(?: CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+))? (?:\/Users\/kodi\/\.local\/bin\/clankerlog-dev|clankerlog) hook hermes stop$/.test(
      command,
    );
  }

  return false;
}

function getHookCommand(hook: HookConfigObject | undefined): string | undefined {
  return typeof hook?.command === "string" ? hook.command : undefined;
}

function cloneHookConfig(config: HookConfigObject): HookConfigObject {
  return structuredClone(config) as HookConfigObject;
}

function isPlainObject(value: unknown): value is HookConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function directStopKey(agent: HookAgent): "stop" | "post_llm_call" {
  return agent === "hermes" ? "post_llm_call" : "stop";
}

function parseHookConfigContent(raw: string, agent: HookAgent): unknown {
  return agent === "hermes" ? parseYaml(raw) : JSON.parse(raw);
}

function serializeHookConfigContent(config: HookConfigObject, agent: HookAgent): string {
  if (agent === "hermes") {
    return stringifyYaml(config, { lineWidth: 0 });
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

function configFormat(agent: HookAgent): "JSON" | "YAML" {
  return agent === "hermes" ? "YAML" : "JSON";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
