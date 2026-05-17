import type { Command } from "commander";

export function registerAllowCommand(program: Command): void {
  program
    .command("allow")
    .description("Allow the current project to send clanks.")
    .option("--name <name>", "Public display name for this project")
    .action(() => {
      console.log("clankerlog allow is not implemented yet.");
    });
}
