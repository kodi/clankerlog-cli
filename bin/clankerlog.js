#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError, z } from "zod";
import { HttpError, NetworkError, ParseError, ValidationError, getJson, postJson } from "fetch-safe";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
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
	if (!await fileExists$1(configPath)) return createDefaultGlobalConfig();
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
	if (!await fileExists$1(configPath)) return;
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
async function fileExists$1(filePath) {
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
function writeLine$1(runtime, message = "") {
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
		writeLine$1(runtime, `Project already allowed: ${existing.path} -> ${existing.displayName}.`);
		return;
	}
	const projectConfig = await loadProjectConfig(projectPath);
	const displayName = options.name?.trim() || projectConfig?.displayName || defaultDisplayName(projectPath);
	await saveGlobalConfig(configPath, upsertAllowedProject(config, {
		displayName,
		path: projectPath
	}));
	writeLine$1(runtime, `Allowed ${projectPath} -> ${displayName}.`);
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
	writeLine$1(runtime, `config: ${configOk ? color.green("ok") : color.red("error")} (${configPath})`);
	writeLine$1(runtime, `auth: ${apiKey ? `${color.green("ok")} ${redactApiKey(apiKey)}` : color.yellow("missing")}`);
	writeLine$1(runtime, `endpoint: ${color.dimGray(endpoint)}`);
	await writeApiCheck(apiKey, endpoint, runtime);
	writeLine$1(runtime);
	writeAllowedProjects(config, runtime);
	writeLine$1(runtime);
	writeLine$1(runtime, `current project: ${allowedProject ? `allowed as ${color.blue(allowedProject.displayName)}` : color.yellow("denied")}`);
	writeProjectConfig(projectPath, projectConfig, runtime);
}
async function writeApiCheck(apiKey, endpoint, runtime) {
	if (!apiKey) {
		writeLine$1(runtime, `api check: ${color.yellow("skipped")} (missing API key)`);
		return;
	}
	const result = await checkAuth({
		apiKey,
		endpoint
	});
	if (result.ok) {
		writeLine$1(runtime, `api check: ${color.green("ok")}`);
		return;
	}
	writeLine$1(runtime, `api check: ${color.red("failed")} ${result.message}`);
}
async function readDoctorConfig(configPath, runtime) {
	try {
		return {
			config: await loadGlobalConfig(configPath),
			ok: true
		};
	} catch (error) {
		if (error instanceof ConfigError) {
			writeLine$1(runtime, `config error: ${error.message}`);
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
			writeLine$1(runtime, `project config error: ${error.message}`);
			return;
		}
		throw error;
	}
}
function writeAllowedProjects(config, runtime) {
	if (config.allowedProjects.length === 0) {
		writeLine$1(runtime, `allowed projects: ${color.yellow("none")}`);
		return;
	}
	writeLine$1(runtime, "allowed projects:");
	for (const project of config.allowedProjects) writeLine$1(runtime, `📂 ${color.dimGray(project.path)} -> ${color.blue(project.displayName)}`);
}
function writeProjectConfig(projectPath, projectConfig, runtime) {
	if (!projectConfig) {
		writeLine$1(runtime, `project config: missing (${resolveProjectConfigPath(projectPath)})`);
		return;
	}
	const stack = projectConfig.stack && projectConfig.stack.length > 0 ? ` stack=${projectConfig.stack.join(",")}` : "";
	writeLine$1(runtime, `project config: ok displayName=${projectConfig.displayName ?? "not set"}${stack}`);
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
		writeLine$1(runtime, `endpoint: ${resolved.endpoint}`);
		writeLine$1(runtime, `api key: ${redactApiKey(resolved.apiKey)}`);
		writeLine$1(runtime, "payload:");
		writeLine$1(runtime, JSON.stringify(resolved.payload, null, 2));
		return;
	}
	if (!resolved.apiKey) throw new CliError("No ClankerLog API key configured. Run `clankerlog login` or pass `--api-key`.");
	const result = await sendClank({
		apiKey: resolved.apiKey,
		endpoint: resolved.endpoint,
		payload: resolved.payload
	});
	if (!result.ok) throw new CliError(result.message);
	writeLine$1(runtime, `Clank accepted: ${result.response.id}`);
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
const cursorStopInputSchema = z.looseObject({
	workspace_roots: z.array(z.string().trim().min(1)).min(1),
	conversation_id: z.string().trim().min(1),
	cursor_version: z.string().trim().min(1),
	generation_id: z.string().trim().min(1),
	hook_event_name: z.literal("stop").optional(),
	model: z.string().trim().min(1).max(120),
	transcript_path: z.string().nullable(),
	user_email: z.string().nullable()
});
function registerHookCommand(program) {
	const hook = program.command("hook").description("Run coding-agent hook integrations.");
	const codex = hook.command("codex").description("Run Codex hook integrations.");
	const claude = hook.command("claude").description("Run Claude Code hook integrations.");
	const cursor = hook.command("cursor").description("Run Cursor hook integrations.");
	codex.command("stop").description("Handle a Codex Stop hook payload from stdin.").option("--dry-run", "Print the resolved clank payload without sending it").action(async (options, command) => {
		await handleCodexStopHook(createRuntime(command), options);
	});
	claude.command("stop").description("Handle a Claude Code Stop hook payload from stdin.").option("--dry-run", "Print the resolved clank payload without sending it").action(async (options, command) => {
		await handleClaudeStopHook(createRuntime(command), options);
	});
	cursor.command("stop").description("Handle a Cursor stop hook payload from stdin.").option("--dry-run", "Print the resolved clank payload without sending it").action(async (options, command) => {
		await handleCursorStopHook(createRuntime(command), options);
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
async function handleCursorStopHook(runtime, options = {}) {
	const input = await parseCursorStopInput(runtime, options);
	const hookRuntime = createHookRuntime(runtime, input.workspace_roots[0], { quiet: !options.dryRun });
	try {
		await handlePing({
			agent: runtime.env.CLANKERLOG_AGENT ?? "cursor",
			dryRun: options.dryRun ?? false,
			model: input.model
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
async function parseCursorStopInput(runtime, options) {
	const raw = await readStdin(runtime.stdin, { allowDryRunFallback: options.dryRun ?? false });
	if (!raw.trim()) {
		if (options.dryRun) return cursorStopInputSchema.parse({
			workspace_roots: [runtime.cwd],
			conversation_id: "dry-run-conversation",
			cursor_version: "dry-run-cursor",
			generation_id: "dry-run-generation",
			hook_event_name: "stop",
			model: runtime.env.CLANKERLOG_MODEL ?? "dry-run-model",
			transcript_path: null,
			user_email: null
		});
		throw new CliError("Cursor stop hook payload was empty.");
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CliError("Cursor stop hook payload was not valid JSON.");
	}
	const result = cursorStopInputSchema.safeParse(parsed);
	if (!result.success) throw new CliError(`Cursor stop hook payload was invalid: ${result.error.issues[0]?.message ?? "schema validation failed"}`);
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
//#region src/hook-config.ts
const HOOK_AGENT_DEFINITIONS = {
	claude: {
		agent: "claude",
		configPath: (homeDirectory) => path.join(homeDirectory, ".claude", "settings.json"),
		defaultTimeoutSeconds: 10,
		statusMessage: "Sending ClankerLog clank"
	},
	codex: {
		agent: "codex",
		configPath: (homeDirectory) => path.join(homeDirectory, ".codex", "hooks.json"),
		defaultTimeoutSeconds: 10,
		statusMessage: "Sending ClankerLog clank"
	},
	cursor: {
		agent: "cursor",
		configPath: (homeDirectory) => path.join(homeDirectory, ".cursor", "hooks.json"),
		defaultTimeoutSeconds: 10,
		statusMessage: "Sending ClankerLog clank"
	}
};
function planInstallHook(config, agent, options = {}) {
	const source = validateHookConfig(config);
	const command = buildHookCommand(agent, options);
	const status = getHookStatus(source, agent);
	if (status.installed) return {
		action: "already-installed",
		agent,
		changed: false,
		command: status.command ?? command,
		config: source,
		summary: `ClankerLog ${agent} Stop hook is already installed.`
	};
	const nextConfig = cloneHookConfig(source);
	const hooks = ensureObjectProperty(nextConfig, "hooks");
	if (agent === "cursor") {
		ensureDirectStopHooks(hooks).push(buildHookObject(agent, command));
		return {
			action: "install",
			agent,
			changed: true,
			command,
			config: nextConfig,
			summary: `Install ClankerLog ${agent} Stop hook.`
		};
	}
	const stop = ensureStopGroups(hooks);
	const group = stop[0] ?? { hooks: [] };
	const groupHooks = getGroupHooks(group);
	if (!stop[0]) stop.push(group);
	groupHooks.push(buildHookObject(agent, command));
	return {
		action: "install",
		agent,
		changed: true,
		command,
		config: nextConfig,
		summary: `Install ClankerLog ${agent} Stop hook.`
	};
}
function planUninstallHook(config, agent) {
	const source = validateHookConfig(config);
	const locations = findClankerLogHooks(source, agent);
	if (locations.length === 0) return {
		action: "not-installed",
		agent,
		changed: false,
		config: source,
		summary: `ClankerLog ${agent} Stop hook is not installed.`
	};
	const nextConfig = cloneHookConfig(source);
	const hooks = nextConfig.hooks;
	for (const location of locations.toReversed()) if (location.format === "direct") hooks.stop.splice(location.hookIndex, 1);
	else hooks.Stop[location.groupIndex].hooks.splice(location.hookIndex, 1);
	return {
		action: "uninstall",
		agent,
		changed: true,
		command: getHookCommand(locations[0]?.hook),
		config: nextConfig,
		summary: `Remove ClankerLog ${agent} Stop hook.`
	};
}
async function uninstallHookConfig(agent, options = {}) {
	const targetPath = resolveHookConfigPath(agent, options);
	return applyHookConfigFilePlan(targetPath, planUninstallHook(await loadHookConfigFile(targetPath), agent), options.dryRun ?? false);
}
function getHookStatus(config, agent) {
	const hook = findClankerLogHooks(validateHookConfig(config), agent)[0]?.hook;
	return {
		agent,
		command: getHookCommand(hook),
		commandMatchesExpected: hook ? isExpectedClankerLogHook(hook, agent) : false,
		installed: Boolean(hook)
	};
}
async function getHookConfigStatus(agent, options = {}) {
	const targetPath = resolveHookConfigPath(agent, options);
	return {
		...getHookStatus(await loadHookConfigFile(targetPath), agent),
		targetPath
	};
}
function resolveHookConfigPath(agent, options = {}) {
	if (options.configPath) return path.resolve(options.configPath);
	return HOOK_AGENT_DEFINITIONS[agent].configPath(options.homeDirectory ?? homedir());
}
async function loadHookConfigFile(configPath) {
	if (!await fileExists(configPath)) return {};
	let raw;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (error) {
		throw new CliError(`Could not read hook config at ${configPath}: ${formatCause(error)}.`);
	}
	let parsed;
	try {
		parsed = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		throw new CliError(`Hook config at ${configPath} is not valid JSON.`);
	}
	try {
		return validateHookConfig(parsed);
	} catch (error) {
		throw new CliError(`Hook config at ${configPath} is unsupported: ${formatCause(error)}.`);
	}
}
async function writeHookConfigFileAtomic(configPath, config) {
	await mkdir(path.dirname(configPath), {
		mode: 448,
		recursive: true
	});
	const tempPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${randomUUID()}.tmp`);
	try {
		await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 384 });
		await rename(tempPath, configPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw new CliError(`Could not write hook config at ${configPath}: ${formatCause(error)}.`);
	}
}
function buildHookCommand(agent, options = {}) {
	if (agent === "codex") return "CLANKERLOG_AGENT=codex clankerlog hook codex stop";
	if (agent === "cursor") return `CLANKERLOG_AGENT=cursor ${options.model?.trim() ? `CLANKERLOG_MODEL=${shellQuote(options.model.trim())} ` : ""}clankerlog hook cursor stop`;
	const model = options.model?.trim();
	if (!model) throw new CliError("Claude Code hook install requires --model, for example `--model claude-sonnet-4.5`.");
	return `CLANKERLOG_AGENT=claude CLANKERLOG_MODEL=${shellQuote(model)} clankerlog hook claude stop`;
}
async function applyHookConfigFilePlan(targetPath, plan, dryRun) {
	if (plan.changed && !dryRun) await writeHookConfigFileAtomic(targetPath, plan.config);
	return {
		...plan,
		dryRun,
		targetPath,
		willWrite: plan.changed
	};
}
function validateHookConfig(config) {
	if (!isPlainObject(config)) throw new CliError("Hook config must be a JSON object.");
	const hooks = config.hooks;
	if (hooks === void 0) return config;
	if (!isPlainObject(hooks)) throw new CliError("Hook config `hooks` must be a JSON object.");
	const stop = hooks.Stop;
	if (stop !== void 0) {
		if (!Array.isArray(stop)) throw new CliError("Hook config `hooks.Stop` must be an array.");
		for (const [groupIndex, group] of stop.entries()) {
			if (!isPlainObject(group)) throw new CliError(`Hook config \`hooks.Stop[${groupIndex}]\` must be an object.`);
			if (!Array.isArray(group.hooks)) throw new CliError(`Hook config \`hooks.Stop[${groupIndex}].hooks\` must be an array.`);
			for (const [hookIndex, hook] of group.hooks.entries()) if (!isPlainObject(hook)) throw new CliError(`Hook config \`hooks.Stop[${groupIndex}].hooks[${hookIndex}]\` must be an object.`);
		}
	}
	const cursorStop = hooks.stop;
	if (cursorStop !== void 0) {
		if (!Array.isArray(cursorStop)) throw new CliError("Hook config `hooks.stop` must be an array.");
		for (const [hookIndex, hook] of cursorStop.entries()) if (!isPlainObject(hook)) throw new CliError(`Hook config \`hooks.stop[${hookIndex}]\` must be an object.`);
	}
	return config;
}
function buildHookObject(agent, command) {
	if (agent === "cursor") return { command };
	const definition = HOOK_AGENT_DEFINITIONS[agent];
	return {
		type: "command",
		command,
		timeout: definition.defaultTimeoutSeconds,
		statusMessage: definition.statusMessage
	};
}
function ensureObjectProperty(target, key) {
	const value = target[key];
	if (isPlainObject(value)) return value;
	const next = {};
	target[key] = next;
	return next;
}
function ensureStopGroups(hooks) {
	const stop = hooks.Stop;
	if (Array.isArray(stop)) return stop;
	const next = [];
	hooks.Stop = next;
	return next;
}
function ensureDirectStopHooks(hooks) {
	const stop = hooks.stop;
	if (Array.isArray(stop)) return stop;
	const next = [];
	hooks.stop = next;
	return next;
}
function getGroupHooks(group) {
	if (Array.isArray(group.hooks)) return group.hooks;
	const hooks = [];
	group.hooks = hooks;
	return hooks;
}
function findClankerLogHooks(config, agent) {
	const hooks = config.hooks;
	if (!isPlainObject(hooks)) return [];
	const locations = [];
	if (agent === "cursor" && Array.isArray(hooks.stop)) {
		for (const [hookIndex, hook] of hooks.stop.entries()) if (isPlainObject(hook) && isClankerLogHook(hook, agent)) locations.push({
			format: "direct",
			groupIndex: -1,
			hookIndex,
			hook
		});
		return locations;
	}
	if (!Array.isArray(hooks.Stop)) return [];
	for (const [groupIndex, group] of hooks.Stop.entries()) {
		const groupHooks = group.hooks;
		if (!Array.isArray(groupHooks)) continue;
		for (const [hookIndex, hook] of groupHooks.entries()) if (isPlainObject(hook) && isClankerLogHook(hook, agent)) locations.push({
			format: "grouped",
			groupIndex,
			hookIndex,
			hook
		});
	}
	return locations;
}
function isClankerLogHook(hook, agent) {
	const marker = hook.clankerlog;
	if (isPlainObject(marker) && marker.agent === agent && marker.version === 1) return true;
	return isExpectedClankerLogHook(hook, agent);
}
function isExpectedClankerLogHook(hook, agent) {
	if (agent !== "cursor" && hook.type !== "command") return false;
	if (agent !== "cursor" && hook.statusMessage !== HOOK_AGENT_DEFINITIONS[agent].statusMessage) return false;
	const command = getHookCommand(hook);
	if (!command) return false;
	if (agent === "codex") return command === buildHookCommand("codex");
	if (agent === "cursor") return command === buildHookCommand("cursor") || /^CLANKERLOG_AGENT=cursor CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook cursor stop$/.test(command);
	return /^CLANKERLOG_AGENT=claude CLANKERLOG_MODEL=(?:'([^']|'\\'')+'|[^ ]+) clankerlog hook claude stop$/.test(command);
}
function getHookCommand(hook) {
	return typeof hook?.command === "string" ? hook.command : void 0;
}
function cloneHookConfig(config) {
	return structuredClone(config);
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
async function fileExists(filePath) {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
function formatCause(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/commands/hooks.ts
function registerHooksCommand(program) {
	const hooks = program.command("hooks").description("Install and inspect coding-agent hooks.");
	const install = hooks.command("install").description("Install a ClankerLog Stop hook.");
	const status = hooks.command("status").description("Inspect a ClankerLog Stop hook.");
	const uninstall = hooks.command("uninstall").description("Remove a ClankerLog Stop hook.");
	install.command("codex").description("Install the Codex Stop hook.").option("--dry-run", "Show the hook config change without writing it").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleInstallHook("codex", createRuntime(command), options);
	});
	install.command("claude").description("Install the Claude Code Stop hook.").option("--dry-run", "Show the hook config change without writing it").option("--model <model>", "Claude model name, for example claude-sonnet-4.5").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleInstallHook("claude", createRuntime(command), options);
	});
	install.command("cursor").description("Install the Cursor stop hook.").option("--dry-run", "Show the hook config change without writing it").option("--model <model>", "Optional Cursor model override; by default Cursor supplies it").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleInstallHook("cursor", createRuntime(command), options);
	});
	status.command("codex").description("Inspect the Codex Stop hook.").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleHookStatus("codex", createRuntime(command), options);
	});
	status.command("claude").description("Inspect the Claude Code Stop hook.").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleHookStatus("claude", createRuntime(command), options);
	});
	status.command("cursor").description("Inspect the Cursor stop hook.").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleHookStatus("cursor", createRuntime(command), options);
	});
	uninstall.command("codex").description("Remove the Codex Stop hook.").option("--dry-run", "Show the hook config change without writing it").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleUninstallHook("codex", createRuntime(command), options);
	});
	uninstall.command("claude").description("Remove the Claude Code Stop hook.").option("--dry-run", "Show the hook config change without writing it").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleUninstallHook("claude", createRuntime(command), options);
	});
	uninstall.command("cursor").description("Remove the Cursor stop hook.").option("--dry-run", "Show the hook config change without writing it").addOption(new Option("--hook-config <path>").hideHelp()).action(async (options, command) => {
		await handleUninstallHook("cursor", createRuntime(command), options);
	});
}
async function handleInstallHook(agent, runtime, options = {}) {
	if (agent === "claude" && !options.model?.trim()) throw new CliError("Claude Code hook install requires --model, for example `--model claude-sonnet-4.5` or `--model claude-opus-4.5`.");
	const fileOptions = toHookConfigFileOptions(options);
	const targetPath = resolveHookConfigPath(agent, fileOptions);
	const plan = planInstallHook(await loadHookConfigFile(targetPath), agent, fileOptions);
	writeLine(runtime, `Target: ${targetPath}`);
	if (plan.command) writeLine(runtime, `Command: ${plan.command}`);
	if (options.dryRun) {
		writeLine(runtime, plan.changed ? `Action: would install ClankerLog ${agentName(agent)} Stop hook.` : `Action: ClankerLog ${agentName(agent)} Stop hook is already installed.`);
		writeNextStep(runtime, agent);
		return;
	}
	if (plan.changed) {
		await writeHookConfigFileAtomic(targetPath, plan.config);
		writeLine(runtime, `Action: installed ClankerLog ${agentName(agent)} Stop hook.`);
	} else writeLine(runtime, `Action: ClankerLog ${agentName(agent)} Stop hook is already installed.`);
	writeNextStep(runtime, agent);
}
async function handleHookStatus(agent, runtime, options = {}) {
	const status = await getHookConfigStatus(agent, toHookConfigFileOptions(options));
	writeLine(runtime, `Target: ${status.targetPath}`);
	writeLine(runtime, `Status: ${status.installed ? `ClankerLog ${agentName(agent)} Stop hook is installed.` : `ClankerLog ${agentName(agent)} Stop hook is not installed.`}`);
	if (status.command) {
		writeLine(runtime, `Command: ${status.command}`);
		writeLine(runtime, `Command matches expected: ${status.commandMatchesExpected ? "yes" : "no"}`);
	}
}
async function handleUninstallHook(agent, runtime, options = {}) {
	const plan = await uninstallHookConfig(agent, toHookConfigFileOptions(options));
	writeLine(runtime, `Target: ${plan.targetPath}`);
	if (plan.command) writeLine(runtime, `Command: ${plan.command}`);
	if (options.dryRun) {
		writeLine(runtime, plan.changed ? `Action: would remove ClankerLog ${agentName(agent)} Stop hook.` : `Action: ClankerLog ${agentName(agent)} Stop hook is not installed.`);
		return;
	}
	writeLine(runtime, plan.changed ? `Action: removed ClankerLog ${agentName(agent)} Stop hook.` : `Action: ClankerLog ${agentName(agent)} Stop hook is not installed.`);
}
function toHookConfigFileOptions(options) {
	return {
		configPath: options.hookConfig,
		dryRun: options.dryRun,
		model: options.model
	};
}
function writeNextStep(runtime, agent) {
	if (agent === "codex") writeLine(runtime, "Next: run /hooks in Codex if command approval is required.");
}
function writeLine(runtime, line) {
	runtime.stdout.write(`${line}\n`);
}
function agentName(agent) {
	if (agent === "claude") return "Claude Code";
	if (agent === "cursor") return "Cursor";
	return "Codex";
}
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
	writeLine$1(runtime, `Allowed ${projectPath} as ${displayName}.`);
	writeLine$1(runtime, "Wrote .clankerlog.json.");
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
	writeLine$1(runtime, `Saved API key ${redactApiKey(apiKey)} to ${configPath}.`);
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
	registerHooksCommand(program);
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
