#!/usr/bin/env node
import { Command, Option } from "commander";
//#region src/commands/allow.ts
function registerAllowCommand(program) {
	program.command("allow").description("Allow the current project to send clanks.").option("--name <name>", "Public display name for this project").action(() => {
		console.log("clankerlog allow is not implemented yet.");
	});
}
//#endregion
//#region src/commands/doctor.ts
function registerDoctorCommand(program) {
	program.command("doctor").description("Print local ClankerLog CLI setup status without sending data.").action(() => {
		console.log("clankerlog doctor is not implemented yet.");
	});
}
//#endregion
//#region src/commands/init.ts
function registerInitCommand(program) {
	program.command("init").description("Initialize ClankerLog for the current project.").option("--name <name>", "Public display name for this project").option("--stack <tags>", "Comma-separated stack tags", collectStack$1, []).action(() => {
		console.log("clankerlog init is not implemented yet.");
	});
}
function collectStack$1(value, previous) {
	return [...previous, value];
}
//#endregion
//#region src/commands/login.ts
function registerLoginCommand(program) {
	program.command("login").description("Save a ClankerLog API key in the local global config.").option("--api-key <key>", "API key to save without prompting").action(() => {
		console.log("clankerlog login is not implemented yet.");
	});
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
	await buildProgram().parseAsync(argv);
}
await main();
//#endregion
export { buildProgram, main };
