#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { registerAllowCommand } from "./commands/allow.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHookCommand } from "./commands/hook.js";
import { registerIntegrationsCommand } from "./commands/integrations.js";
import { registerInitCommand } from "./commands/init.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerPingCommand } from "./commands/ping.js";
import { registerUpdateCommand } from "./commands/update.js";
import { formatCliError } from "./errors.js";
import { getPackageVersion } from "./package-info.js";

export function getCliVersion(): string {
  return getPackageVersion();
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("clankerlog")
    .description("Send privacy-friendly coding-agent activity clanks to ClankerLog.")
    .version(getCliVersion())
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
  registerHookCommand(program);
  registerIntegrationsCommand(program);
  registerUpdateCommand(program);

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  }
}

export async function isCliEntrypoint(
  metaUrl = import.meta.url,
  argv: readonly string[] = process.argv,
): Promise<boolean> {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  const entrypointUrl = pathToFileURL(entrypoint).href;
  if (metaUrl === entrypointUrl) {
    return true;
  }

  try {
    return metaUrl === pathToFileURL(await realpath(entrypoint)).href;
  } catch {
    return false;
  }
}

if (await isCliEntrypoint()) {
  await main();
}
