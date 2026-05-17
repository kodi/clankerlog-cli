import type { Command } from "commander";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize ClankerLog for the current project.")
    .option("--name <name>", "Public display name for this project")
    .option("--stack <tags>", "Comma-separated stack tags", collectStack, [] as string[])
    .action(() => {
      console.log("clankerlog init is not implemented yet.");
    });
}

function collectStack(value: string, previous: string[]): string[] {
  return [...previous, value];
}
