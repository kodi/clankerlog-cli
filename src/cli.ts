#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { registerAllowCommand } from "./commands/allow.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerInitCommand } from "./commands/init.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerPingCommand } from "./commands/ping.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("clankerlog")
    .description("Send privacy-friendly coding-agent activity clanks to ClankerLog.")
    .version("0.0.1")
    .showHelpAfterError()
    .configureOutput({
      writeErr: (text) => {
        process.stderr.write(text);
      },
      writeOut: (text) => {
        process.stdout.write(text);
      },
    });

  program.addOption(new Option("--workspace <path>").hideHelp());

  registerLoginCommand(program);
  registerInitCommand(program);
  registerAllowCommand(program);
  registerPingCommand(program);
  registerDoctorCommand(program);

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entrypoint) {
  await main();
}
