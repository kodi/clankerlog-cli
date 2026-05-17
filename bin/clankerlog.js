#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError, z } from "zod";
import { createInterface } from "node:readline/promises";
//#region src/schemas.ts
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
z.object({
	agent: z.string().trim().min(1).max(80),
	model: z.string().trim().min(1).max(120),
	project: z.object({ display_name: displayNameSchema }).strict(),
	stack: stackSchema,
	timestamp: z.string().refine(isIsoDateTimeWithOffsetValue, { message: "Timestamp must be an ISO datetime with an offset" }),
	type: z.literal("clank")
}).strict();
z.object({
	id: z.string().min(1),
	ok: z.literal(true)
}).passthrough();
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
//#region src/commands/doctor.ts
function registerDoctorCommand(program) {
	program.command("doctor").description("Print local ClankerLog CLI setup status without sending data.").action(() => {
		console.log("clankerlog doctor is not implemented yet.");
	});
}
//#endregion
//#region src/stack.ts
function parseStackValues(values) {
	const stack = values?.flatMap((value) => value.split(",")).map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
	return stackSchema.parse(stack ?? []);
}
//#endregion
//#region src/commands/init.ts
function registerInitCommand(program) {
	program.command("init").description("Initialize ClankerLog for the current project.").option("--name <name>", "Public display name for this project").option("--stack <tags>", "Comma-separated stack tags", collectStack$1, []).action(async (options, command) => {
		await handleInit(options, createRuntime(command));
	});
}
function collectStack$1(value, previous) {
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
//#region src/redact.ts
function redactApiKey(apiKey) {
	if (!apiKey) return "not configured";
	return `${apiKey.length <= 12 ? apiKey.slice(0, 4) : apiKey.slice(0, 12)}...redacted`;
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
//#region src/commands/ping.ts
function registerPingCommand(program) {
	program.command("ping").description("Send one manual clank from an allowed project.").option("--agent <name>", "Coding-agent name").option("--model <name>", "Model name").option("--project <name>", "One-off project display name for this ping").option("--stack <tags>", "Comma-separated stack tags; repeatable", collectStack, []).option("--timestamp <iso>", "ISO timestamp for the clank").option("--endpoint <url>", "Ingestion endpoint override").option("--api-key <key>", "API key override").option("--dry-run", "Print the payload without sending it").action(() => {
		console.log("clankerlog ping is not implemented yet.");
	});
}
function collectStack(value, previous) {
	return [...previous, value];
}
//#endregion
//#region src/errors.ts
function formatCliError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
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
