#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError, z } from "zod";
import { HttpError, NetworkError, ParseError, ValidationError, getJson, postJson } from "fetch-safe";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
//#region src/model.ts
const providerPrefixPattern = /^[a-z0-9][a-z0-9._-]*\//u;
const canonicalModelNames = [
	"gpt-5.5",
	"gpt-5.5-pro",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5",
	"gpt-5-mini",
	"gpt-5-nano",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano",
	"gpt-4o",
	"gpt-4o-mini",
	"o4-mini",
	"o3",
	"o3-mini",
	"o1",
	"o1-mini",
	"claude-opus-4.7",
	"claude-opus-4.6",
	"claude-opus-4.5",
	"claude-sonnet-4.6",
	"claude-sonnet-4.5",
	"claude-sonnet-4",
	"claude-3.7-sonnet",
	"claude-3.5-sonnet",
	"claude-3.5-haiku",
	"claude-3-opus",
	"claude-3-sonnet",
	"claude-3-haiku",
	"gemini-3.1-pro",
	"gemini-3-pro",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-2.0-flash",
	"deepseek-v3.2",
	"deepseek-v3.1",
	"deepseek-r1",
	"qwen3-coder",
	"qwen3-max",
	"qwen3-vl",
	"qwen3-235b-a22b",
	"grok-4",
	"grok-4-fast",
	"grok-3",
	"grok-3-mini",
	"mistral-large",
	"mistral-medium",
	"codestral",
	"magistral-medium",
	"llama-4-maverick",
	"llama-4-scout",
	"llama-3.3-70b-instruct",
	"llama-3.1-405b-instruct",
	"kimi-k2"
];
const manualAliases = new Map([
	["opus4.7", "claude-opus-4.7"],
	["opus-4-7", "claude-opus-4.7"],
	["opus 4.7", "claude-opus-4.7"],
	["claude opus 4.7", "claude-opus-4.7"],
	["opus4.6", "claude-opus-4.6"],
	["sonnet4.6", "claude-sonnet-4.6"],
	["sonnet-4-6", "claude-sonnet-4.6"],
	["claude sonnet 4.6", "claude-sonnet-4.6"],
	["sonnet4.5", "claude-sonnet-4.5"],
	["sonnet 4", "claude-sonnet-4"],
	["haiku3.5", "claude-3.5-haiku"],
	["claude haiku 3.5", "claude-3.5-haiku"],
	["gemini pro 3.1", "gemini-3.1-pro"],
	["gemini flash 2.5", "gemini-2.5-flash"],
	["deepseek r1", "deepseek-r1"],
	["deepseek v3.2", "deepseek-v3.2"],
	["qwen coder 3", "qwen3-coder"],
	["qwen3 coder", "qwen3-coder"],
	["grok fast 4", "grok-4-fast"],
	["mistral large", "mistral-large"],
	["mistral medium", "mistral-medium"],
	["llama 4 maverick", "llama-4-maverick"],
	["llama 4 scout", "llama-4-scout"]
]);
const knownModelNames = /* @__PURE__ */ new Map();
for (const modelName of canonicalModelNames) knownModelNames.set(modelKey(modelName), modelName);
for (const [alias, modelName] of manualAliases) knownModelNames.set(modelKey(alias), modelName);
function normalizeModelName(value) {
	const trimmed = value.trim();
	return knownModelNames.get(modelKey(trimmed)) ?? trimmed;
}
function modelKey(value) {
	return value.trim().toLowerCase().replace(providerPrefixPattern, "").replace(/[^a-z0-9]+/gu, "");
}
const isoDateTimeWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const stackTagSchema = z.string().trim().min(1, "Stack tag cannot be empty").max(64, "Stack tag must be 64 characters or less").regex(/^[a-z0-9][a-z0-9.+-]*$/u, "Stack tag must use lowercase letters, numbers, dots, pluses, or hyphens");
const stackSchema = z.array(stackTagSchema).max(32, "Stack can include at most 32 tags").default([]);
const displayNameSchema = z.string().trim().min(1, "Project display name is required").max(120, "Project display name must be 120 characters or less");
const allowedProjectSchema = z.object({
	displayName: displayNameSchema,
	path: z.string().trim().min(1, "Project path is required")
}).strict();
const globalConfigSchema = z.object({
	allowedProjects: z.array(allowedProjectSchema).default([]),
	apiKey: z.string().trim().min(1).optional(),
	endpoint: z.url().optional()
}).strict().default({ allowedProjects: [] });
const projectConfigSchema = z.object({
	displayName: displayNameSchema.optional(),
	stack: stackSchema.optional()
}).strict();
const clankPayloadSchema = z.object({
	agent: z.string().trim().min(1).max(80),
	model: z.string().trim().min(1).max(120).transform(normalizeModelName),
	project: z.object({ display_name: displayNameSchema }).strict(),
	stack: stackSchema,
	timestamp: z.string().refine(isIsoDateTimeWithOffsetValue, { message: "Timestamp must be an ISO datetime with an offset" }),
	type: z.literal("clank")
}).strict();
const ingestionSuccessSchema = z.looseObject({
	id: z.string().min(1),
	ok: z.literal(true)
});
const authCheckSuccessSchema = z.looseObject({
	authenticated: z.literal(true),
	keyId: z.string().min(1),
	ok: z.literal(true)
});
function isIsoDateTimeWithOffsetValue(value) {
	return isoDateTimeWithOffset.test(value) && !Number.isNaN(Date.parse(value));
}
//#endregion
//#region src/config.ts
var ConfigError = class extends Error {
	cause;
	constructor(message, cause) {
		super(message);
		this.name = "ConfigError";
		this.cause = cause;
	}
};
function createDefaultGlobalConfig() {
	return { allowedProjects: [] };
}
function resolveGlobalConfigPath(options = {}) {
	if (options.configPath) return options.configPath;
	const configHome = (options.env ?? process.env).XDG_CONFIG_HOME || path.join(options.home ?? homedir(), ".config");
	return path.join(configHome, "clankerlog", "config.json");
}
async function loadGlobalConfig(configPath) {
	if (!await fileExists(configPath)) return createDefaultGlobalConfig();
	let raw;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (error) {
		throw new ConfigError(`Could not read config at ${configPath}`, error);
	}
	return parseJsonConfig(raw, configPath, globalConfigSchema);
}
async function saveGlobalConfig(configPath, config) {
	const parsed = globalConfigSchema.parse(config);
	const dir = path.dirname(configPath);
	try {
		await mkdir(dir, {
			mode: 448,
			recursive: true
		});
		await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 384 });
		await chmod(configPath, 384);
	} catch (error) {
		throw new ConfigError(`Could not write config at ${configPath}`, error);
	}
}
function resolveProjectConfigPath(projectPath) {
	return path.join(projectPath, ".clankerlog.json");
}
async function loadProjectConfig(projectPath) {
	const configPath = resolveProjectConfigPath(projectPath);
	if (!await fileExists(configPath)) return;
	let raw;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (error) {
		throw new ConfigError(`Could not read project config at ${configPath}`, error);
	}
	return parseJsonConfig(raw, configPath, projectConfigSchema);
}
async function saveProjectConfig(projectPath, config) {
	const configPath = resolveProjectConfigPath(projectPath);
	const parsed = projectConfigSchema.parse(config);
	try {
		await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 384 });
	} catch (error) {
		throw new ConfigError(`Could not write project config at ${configPath}`, error);
	}
}
async function fileExists(filePath) {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
function parseJsonConfig(raw, filePath, schema) {
	let value;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new ConfigError(`Config at ${filePath} is not valid JSON`, error);
	}
	try {
		return schema.parse(value);
	} catch (error) {
		if (error instanceof ZodError) throw new ConfigError(`Config at ${filePath} is invalid: ${error.issues[0]?.message ?? "schema validation failed"}`, error);
		throw error;
	}
}
//#endregion
//#region src/output.ts
function writeLine(runtime, message = "") {
	runtime.stdout.write(`${message}\n`);
}
//#endregion
//#region src/project.ts
async function resolveProjectPath(cwd) {
	return realpath(cwd);
}
function findAllowedProject(config, projectPath) {
	return config.allowedProjects.find((project) => project.path === projectPath);
}
function defaultDisplayName(projectPath) {
	return path.basename(projectPath) || "project";
}
function upsertAllowedProject(config, project) {
	const nextProjects = config.allowedProjects.filter((allowedProject) => allowedProject.path !== project.path);
	return {
		...config,
		allowedProjects: [...nextProjects, project]
	};
}
//#endregion
//#region src/runtime.ts
function createRuntime(command) {
	const opts = command.optsWithGlobals();
	return {
		cwd: opts.workspace ? path.resolve(opts.workspace) : process.cwd(),
		env: process.env,
		stderr: process.stderr,
		stdin: process.stdin,
		stdout: process.stdout
	};
}
//#endregion
//#region src/commands/allow.ts
function registerAllowCommand(program) {
	program.command("allow").description("Allow the current project to send clanks.").option("--name <name>", "Public display name for this project").action(async (options, command) => {
		await handleAllow(options, createRuntime(command));
	});
}
async function handleAllow(options, runtime) {
	const projectPath = await resolveProjectPath(runtime.cwd);
	const configPath = resolveGlobalConfigPath({
		configPath: runtime.configPath,
		env: runtime.env
	});
	const config = await loadGlobalConfig(configPath);
	const existing = findAllowedProject(config, projectPath);
	if (existing) {
		writeLine(runtime, `Project already allowed: ${existing.path} -> ${existing.displayName}.`);
		return;
	}
	const projectConfig = await loadProjectConfig(projectPath);
	const displayName = options.name?.trim() || projectConfig?.displayName || defaultDisplayName(projectPath);
	await saveGlobalConfig(configPath, upsertAllowedProject(config, {
		displayName,
		path: projectPath
	}));
	writeLine(runtime, `Allowed ${projectPath} -> ${displayName}.`);
}
//#endregion
//#region src/ingest.ts
async function checkAuth(options) {
	const url = authCheckEndpointFromIngestEndpoint(options.endpoint);
	const result = await getJson(url, {
		headers: { Authorization: `Bearer ${options.apiKey}` },
		schema: authCheckSuccessSchema
	});
	if (!result.ok) {
		const error = result.error ?? new NetworkError("Unknown network error");
		return {
			error,
			message: formatAuthCheckError(error),
			ok: false,
			url
		};
	}
	return {
		ok: true,
		response: result.value,
		url
	};
}
async function sendClank(options) {
	const result = await postJson(options.endpoint, options.payload, {
		headers: { Authorization: `Bearer ${options.apiKey}` },
		schema: ingestionSuccessSchema
	});
	if (!result.ok) {
		const error = result.error ?? new NetworkError("Unknown network error");
		return {
			error,
			message: formatIngestError(error),
			ok: false
		};
	}
	return {
		ok: true,
		response: result.value
	};
}
function authCheckEndpointFromIngestEndpoint(endpoint) {
	const url = new URL(endpoint);
	url.pathname = url.pathname.replace(/\/v1\/clanks(?:\/batch)?\/?$/u, "/v1/auth/check");
	url.search = "";
	url.hash = "";
	return url.toString();
}
function formatAuthCheckError(error) {
	if (error instanceof HttpError) {
		if (error.status === 401) return "Authentication failed (401). Check your ClankerLog API key.";
		return `Auth check returned HTTP ${error.status} ${error.statusText}.${formatErrorBody(error.body)}`;
	}
	if (error instanceof NetworkError) return `Network error while contacting ClankerLog: ${error.message}`;
	if (error instanceof ParseError) return "Auth check returned invalid JSON.";
	if (error instanceof ValidationError) return "Auth check response did not match the expected schema.";
	return "Unknown auth check error.";
}
function formatIngestError(error) {
	if (error instanceof HttpError) return formatHttpError(error);
	if (error instanceof NetworkError) return `Network error while contacting ClankerLog: ${error.message}`;
	if (error instanceof ParseError) return "Ingestion API returned invalid JSON.";
	if (error instanceof ValidationError) return "Ingestion API response did not match the expected schema.";
	return "Unknown ingestion error.";
}
function formatHttpError(error) {
	if (error.status === 401) return "Authentication failed (401). Check your ClankerLog API key.";
	if (error.status === 400) return `Ingestion rejected the clank payload (400).${formatErrorBody(error.body)}`;
	return `Ingestion API returned HTTP ${error.status} ${error.statusText}.${formatErrorBody(error.body)}`;
}
function formatErrorBody(body) {
	if (!body) return "";
	try {
		const parsed = JSON.parse(body);
		const message = typeof parsed.error === "string" ? parsed.error : parsed.message;
		return typeof message === "string" ? ` ${message}` : "";
	} catch {
		return ` ${body.slice(0, 200)}`;
	}
}
//#endregion
//#region src/redact.ts
function redactApiKey(apiKey) {
	if (!apiKey) return "not configured";
	return `${apiKey.length <= 12 ? apiKey.slice(0, 4) : apiKey.slice(0, 12)}...redacted`;
}
//#endregion
//#region src/commands/doctor.ts
const color = {
	blue: (value) => `\x1b[34m${value}\x1b[0m`,
	dimGray: (value) => `\x1b[2;90m${value}\x1b[0m`,
	green: (value) => `\x1b[32m${value}\x1b[0m`,
	red: (value) => `\x1b[31m${value}\x1b[0m`,
	yellow: (value) => `\x1b[33m${value}\x1b[0m`
};
function registerDoctorCommand(program) {
	program.command("doctor").description("Print local ClankerLog CLI setup status without sending data.").option("--endpoint <url>", "Endpoint override to report").option("--api-key <key>", "API key override to report redacted").action(async (options, command) => {
		await handleDoctor(options, createRuntime(command));
	});
}
async function handleDoctor(options, runtime) {
	const configPath = resolveGlobalConfigPath({
		configPath: runtime.configPath,
		env: runtime.env
	});
	const { config, ok: configOk } = await readDoctorConfig(configPath, runtime);
	const projectPath = await resolveProjectPath(runtime.cwd);
	const projectConfig = await readDoctorProjectConfig(projectPath, runtime);
	const endpoint = options.endpoint ?? runtime.env.CLANKERLOG_INGEST_URL ?? config.endpoint ?? "https://ingest.clankerlog.ai/v1/clanks";
	const apiKey = options.apiKey ?? runtime.env.CLANKERLOG_API_KEY ?? config.apiKey;
	const allowedProject = configOk ? findAllowedProject(config, projectPath) : void 0;
	writeLine(runtime, `config: ${configOk ? color.green("ok") : color.red("error")} (${configPath})`);
	writeLine(runtime, `auth: ${apiKey ? `${color.green("ok")} ${redactApiKey(apiKey)}` : color.yellow("missing")}`);
	writeLine(runtime, `endpoint: ${color.dimGray(endpoint)}`);
	await writeApiCheck(apiKey, endpoint, runtime);
	writeLine(runtime);
	writeAllowedProjects(config, runtime);
	writeLine(runtime);
	writeLine(runtime, `current project: ${allowedProject ? `allowed as ${color.blue(allowedProject.displayName)}` : color.yellow("denied")}`);
	writeProjectConfig(projectPath, projectConfig, runtime);
}
async function writeApiCheck(apiKey, endpoint, runtime) {
	if (!apiKey) {
		writeLine(runtime, `api check: ${color.yellow("skipped")} (missing API key)`);
		return;
	}
	const result = await checkAuth({
		apiKey,
		endpoint
	});
	if (result.ok) {
		writeLine(runtime, `api check: ${color.green("ok")}`);
		return;
	}
	writeLine(runtime, `api check: ${color.red("failed")} ${result.message}`);
}
async function readDoctorConfig(configPath, runtime) {
	try {
		return {
			config: await loadGlobalConfig(configPath),
			ok: true
		};
	} catch (error) {
		if (error instanceof ConfigError) {
			writeLine(runtime, `config error: ${error.message}`);
			return {
				config: createDefaultGlobalConfig(),
				ok: false
			};
		}
		throw error;
	}
}
async function readDoctorProjectConfig(projectPath, runtime) {
	try {
		return await loadProjectConfig(projectPath);
	} catch (error) {
		if (error instanceof ConfigError) {
			writeLine(runtime, `project config error: ${error.message}`);
			return;
		}
		throw error;
	}
}
function writeAllowedProjects(config, runtime) {
	if (config.allowedProjects.length === 0) {
		writeLine(runtime, `allowed projects: ${color.yellow("none")}`);
		return;
	}
	writeLine(runtime, "allowed projects:");
	for (const project of config.allowedProjects) writeLine(runtime, `📂 ${color.dimGray(project.path)} -> ${color.blue(project.displayName)}`);
}
function writeProjectConfig(projectPath, projectConfig, runtime) {
	if (!projectConfig) {
		writeLine(runtime, `project config: missing (${resolveProjectConfigPath(projectPath)})`);
		return;
	}
	const stack = projectConfig.stack && projectConfig.stack.length > 0 ? ` stack=${projectConfig.stack.join(",")}` : "";
	writeLine(runtime, `project config: ok displayName=${projectConfig.displayName ?? "not set"}${stack}`);
}
//#endregion
//#region src/errors.ts
var CliError = class extends Error {
	exitCode;
	constructor(message, exitCode = 1) {
		super(message);
		this.name = "CliError";
		this.exitCode = exitCode;
	}
};
function formatCliError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
//#endregion
//#region src/stack.ts
function parseStackValues(values) {
	const stack = values?.flatMap((value) => value.split(",")).map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
	return stackSchema.parse(stack ?? []);
}
async function detectStackFromFilenames(projectPath) {
	const filenames = new Set(await readdir(projectPath));
	const detected = [];
	if (filenames.has("package.json")) detected.push("typescript");
	if (filenames.has("pnpm-lock.yaml")) detected.push("pnpm");
	if (filenames.has("go.mod")) detected.push("go");
	if (filenames.has("Cargo.toml")) detected.push("rust");
	if (filenames.has("pyproject.toml")) detected.push("python");
	if (filenames.has("deno.json")) detected.push("deno");
	if (filenames.has("wrangler.jsonc") || filenames.has("wrangler.toml")) detected.push("cloudflare");
	return uniqueStack(detected);
}
function uniqueStack(values) {
	return stackSchema.parse([...new Set(values)]);
}
//#endregion
//#region src/commands/ping.ts
function registerPingCommand(program) {
	program.command("ping").description("Send one manual clank from an allowed project.").option("--agent <name>", "Coding-agent name").option("--model <name>", "Model name").option("--project <name>", "One-off project display name for this ping").option("--stack <tags>", "Comma-separated stack tags; repeatable", collectStack$1, []).option("--timestamp <iso>", "ISO timestamp for the clank").option("--endpoint <url>", "Ingestion endpoint override").option("--api-key <key>", "API key override").option("--dry-run", "Print the payload without sending it").action(async (options, command) => {
		await handlePing(options, createRuntime(command));
	});
}
function collectStack$1(value, previous) {
	return [...previous, value];
}
async function handlePing(options, runtime) {
	const resolved = await resolvePing(options, runtime);
	if (options.dryRun) {
		writeLine(runtime, `endpoint: ${resolved.endpoint}`);
		writeLine(runtime, `api key: ${redactApiKey(resolved.apiKey)}`);
		writeLine(runtime, "payload:");
		writeLine(runtime, JSON.stringify(resolved.payload, null, 2));
		return;
	}
	if (!resolved.apiKey) throw new CliError("No ClankerLog API key configured. Run `clankerlog login` or pass `--api-key`.");
	const result = await sendClank({
		apiKey: resolved.apiKey,
		endpoint: resolved.endpoint,
		payload: resolved.payload
	});
	if (!result.ok) throw new CliError(result.message);
	writeLine(runtime, `Clank accepted: ${result.response.id}`);
}
async function resolvePing(options, runtime) {
	const projectPath = await resolveProjectPath(runtime.cwd);
	const globalConfig = await loadGlobalConfig(resolveGlobalConfigPath({
		configPath: runtime.configPath,
		env: runtime.env
	}));
	const allowedProject = findAllowedProject(globalConfig, projectPath);
	if (!allowedProject) throw new CliError("This project is not allowed to clank yet.\nRun `clankerlog init` here to allow it.");
	const projectConfig = await loadProjectConfig(projectPath);
	const endpoint = options.endpoint ?? runtime.env.CLANKERLOG_INGEST_URL ?? globalConfig.endpoint ?? "https://ingest.clankerlog.ai/v1/clanks";
	const apiKey = options.apiKey ?? runtime.env.CLANKERLOG_API_KEY ?? globalConfig.apiKey;
	const agent = options.agent ?? runtime.env.CLANKERLOG_AGENT;
	const model = options.model ?? runtime.env.CLANKERLOG_MODEL;
	if (!agent) throw new CliError("No agent configured. Pass `--agent` or set CLANKERLOG_AGENT.");
	if (!model) throw new CliError("No model configured. Pass `--model` or set CLANKERLOG_MODEL.");
	const explicitStack = stackFromPrecedence(options.stack, runtime.env.CLANKERLOG_STACK, projectConfig?.stack);
	const detectedStack = await detectStackFromFilenames(projectPath);
	return {
		apiKey,
		endpoint,
		payload: clankPayloadSchema.parse({
			agent,
			model,
			project: { display_name: options.project ?? projectConfig?.displayName ?? allowedProject.displayName },
			stack: uniqueStack([...explicitStack, ...detectedStack]),
			timestamp: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
			type: "clank"
		}),
		projectPath
	};
}
function stackFromPrecedence(flagStack, envStack, projectStack) {
	if (flagStack && flagStack.length > 0) return parseStackValues(flagStack);
	if (envStack) return parseStackValues([envStack]);
	return uniqueStack(projectStack ?? []);
}
//#endregion
//#region src/commands/hook.ts
const codexStopInputSchema = z.looseObject({
	cwd: z.string().trim().min(1),
	hook_event_name: z.literal("Stop"),
	last_assistant_message: z.string().nullable(),
	model: z.string().trim().min(1).max(120),
	permission_mode: z.enum([
		"default",
		"acceptEdits",
		"plan",
		"dontAsk",
		"bypassPermissions"
	]),
	session_id: z.string().trim().min(1),
	stop_hook_active: z.boolean(),
	transcript_path: z.string().nullable(),
	turn_id: z.string().trim().min(1)
});
const claudeStopInputSchema = z.looseObject({
	cwd: z.string().trim().min(1),
	hook_event_name: z.literal("Stop"),
	last_assistant_message: z.string().nullable().optional(),
	permission_mode: z.enum([
		"default",
		"acceptEdits",
		"auto",
		"plan",
		"dontAsk",
		"bypassPermissions"
	]).optional(),
	session_id: z.string().trim().min(1),
	stop_hook_active: z.boolean(),
	transcript_path: z.string().nullable().optional()
});
function registerHookCommand(program) {
	const hook = program.command("hook").description("Run coding-agent hook integrations.");
	const codex = hook.command("codex").description("Run Codex hook integrations.");
	const claude = hook.command("claude").description("Run Claude Code hook integrations.");
	codex.command("stop").description("Handle a Codex Stop hook payload from stdin.").option("--dry-run", "Print the resolved clank payload without sending it").action(async (options, command) => {
		await handleCodexStopHook(createRuntime(command), options);
	});
	claude.command("stop").description("Handle a Claude Code Stop hook payload from stdin.").option("--dry-run", "Print the resolved clank payload without sending it").action(async (options, command) => {
		await handleClaudeStopHook(createRuntime(command), options);
	});
}
async function handleCodexStopHook(runtime, options = {}) {
	const input = await parseCodexStopInput(runtime, options);
	const hookRuntime = createHookRuntime(runtime, input.cwd, { quiet: !options.dryRun });
	try {
		await handlePing({
			agent: runtime.env.CLANKERLOG_AGENT ?? "codex",
			dryRun: options.dryRun ?? false,
			model: input.model
		}, hookRuntime);
	} catch (error) {
		if (options.dryRun) throw error;
	}
}
async function handleClaudeStopHook(runtime, options = {}) {
	const hookRuntime = createHookRuntime(runtime, (await parseClaudeStopInput(runtime, options)).cwd, { quiet: !options.dryRun });
	try {
		await handlePing({
			agent: runtime.env.CLANKERLOG_AGENT ?? "claude",
			dryRun: options.dryRun ?? false
		}, hookRuntime);
	} catch (error) {
		if (options.dryRun) throw error;
	}
}
async function parseCodexStopInput(runtime, options) {
	const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });
	if (!raw.trim()) {
		if (options.dryRun) return codexStopInputSchema.parse({
			cwd: runtime.cwd,
			hook_event_name: "Stop",
			last_assistant_message: null,
			model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
			permission_mode: "default",
			session_id: "dry-run-session",
			stop_hook_active: false,
			transcript_path: null,
			turn_id: "dry-run-turn"
		});
		throw new CliError("Codex Stop hook payload was empty.");
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CliError("Codex Stop hook payload was not valid JSON.");
	}
	const result = codexStopInputSchema.safeParse(parsed);
	if (!result.success) throw new CliError(`Codex Stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`);
	return result.data;
}
async function parseClaudeStopInput(runtime, options) {
	const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });
	if (!raw.trim()) {
		if (options.dryRun) return claudeStopInputSchema.parse({
			cwd: runtime.cwd,
			hook_event_name: "Stop",
			last_assistant_message: null,
			permission_mode: "default",
			session_id: "dry-run-session",
			stop_hook_active: false,
			transcript_path: null
		});
		throw new CliError("Claude Code Stop hook payload was empty.");
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CliError("Claude Code Stop hook payload was not valid JSON.");
	}
	const result = claudeStopInputSchema.safeParse(parsed);
	if (!result.success) throw new CliError(`Claude Code Stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`);
	return result.data;
}
function createHookRuntime(runtime, cwd, options) {
	return {
		configPath: runtime.configPath,
		cwd,
		env: runtime.env,
		stderr: runtime.stderr,
		stdin: runtime.stdin,
		stdout: options.quiet ? new NullWritable() : runtime.stdout
	};
}
function readStdin(stream, options) {
	if (options.allowDryRunFallback && stdinIsTty(stream)) return Promise.resolve("");
	return new Promise((resolve, reject) => {
		const chunks = [];
		let fallbackTimer;
		const cleanup = () => {
			if (fallbackTimer) clearTimeout(fallbackTimer);
			stream.off("data", onData);
			stream.off("end", onEnd);
			stream.off("error", onError);
		};
		const finish = (value) => {
			cleanup();
			resolve(value);
		};
		const onData = (chunk) => {
			chunks.push(chunk.toString());
		};
		const onEnd = () => {
			finish(chunks.join(""));
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		stream.setEncoding("utf8");
		stream.on("data", onData);
		stream.on("end", onEnd);
		stream.on("error", onError);
		if (options.allowDryRunFallback) fallbackTimer = setTimeout(() => {
			finish(chunks.join(""));
		}, 50);
	});
}
function stdinIsTty(stream) {
	return Boolean(stream.isTTY);
}
var NullWritable = class extends Writable {
	_write(_chunk, _encoding, callback) {
		callback();
	}
};
//#endregion
//#region src/commands/init.ts
function registerInitCommand(program) {
	program.command("init").description("Initialize ClankerLog for the current project.").option("--name <name>", "Public display name for this project").option("--stack <tags>", "Comma-separated stack tags", collectStack, []).action(async (options, command) => {
		await handleInit(options, createRuntime(command));
	});
}
function collectStack(value, previous) {
	return [...previous, value];
}
async function handleInit(options, runtime) {
	const projectPath = await resolveProjectPath(runtime.cwd);
	const displayName = options.name?.trim() || await promptDisplayName(runtime, defaultDisplayName(projectPath));
	const stack = parseStackValues(options.stack);
	const configPath = resolveGlobalConfigPath({
		configPath: runtime.configPath,
		env: runtime.env
	});
	await saveGlobalConfig(configPath, upsertAllowedProject(await loadGlobalConfig(configPath), {
		displayName,
		path: projectPath
	}));
	await saveProjectConfig(projectPath, stack.length > 0 ? {
		displayName,
		stack
	} : { displayName });
	writeLine(runtime, `Allowed ${projectPath} as ${displayName}.`);
	writeLine(runtime, "Wrote .clankerlog.json.");
}
async function promptDisplayName(runtime, fallback) {
	const readline = createInterface({
		input: runtime.stdin,
		output: runtime.stdout
	});
	try {
		return (await readline.question(`Project display name (${fallback}): `)).trim() || fallback;
	} finally {
		readline.close();
	}
}
//#endregion
//#region src/commands/login.ts
function registerLoginCommand(program) {
	program.command("login").description("Save a ClankerLog API key in the local global config.").option("--api-key <key>", "API key to save without prompting").action(async (options, command) => {
		await handleLogin(options, createRuntime(command));
	});
}
async function handleLogin(options, runtime) {
	const apiKey = options.apiKey ?? await promptApiKey(runtime);
	const configPath = resolveGlobalConfigPath({
		configPath: runtime.configPath,
		env: runtime.env
	});
	await saveGlobalConfig(configPath, {
		...await loadGlobalConfig(configPath),
		apiKey
	});
	writeLine(runtime, `Saved API key ${redactApiKey(apiKey)} to ${configPath}.`);
}
async function promptApiKey(runtime) {
	const readline = createInterface({
		input: runtime.stdin,
		output: runtime.stdout
	});
	try {
		return (await readline.question("Paste your ClankerLog API key: ")).trim();
	} finally {
		readline.close();
	}
}
//#endregion
//#region src/cli.ts
function buildProgram() {
	const program = new Command();
	program.name("clankerlog").description("Send privacy-friendly coding-agent activity clanks to ClankerLog.").version("0.0.1").showHelpAfterError().configureOutput({
		writeErr: (text) => {
			process.stderr.write(text);
		},
		writeOut: (text) => {
			process.stdout.write(text);
		}
	});
	program.addOption(new Option("--workspace <path>").hideHelp());
	registerLoginCommand(program);
	registerInitCommand(program);
	registerAllowCommand(program);
	registerPingCommand(program);
	registerDoctorCommand(program);
	registerHookCommand(program);
	return program;
}
async function main(argv = process.argv) {
	const program = buildProgram();
	try {
		await program.parseAsync(argv);
	} catch (error) {
		process.stderr.write(`${formatCliError(error)}\n`);
		process.exitCode = 1;
	}
}
const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) await main();
//#endregion
export { buildProgram, main };
