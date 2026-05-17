import type { Command } from "commander";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Save a ClankerLog API key in the local global config.")
    .option("--api-key <key>", "API key to save without prompting")
    .action(() => {
      console.log("clankerlog login is not implemented yet.");
    });
}
