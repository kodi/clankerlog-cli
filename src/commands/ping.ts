import type { Command } from "commander";

export function registerPingCommand(program: Command): void {
  program
    .command("ping")
    .description("Send one manual clank from an allowed project.")
    .option("--agent <name>", "Coding-agent name")
    .option("--model <name>", "Model name")
    .option("--project <name>", "One-off project display name for this ping")
    .option(
      "--stack <tags>",
      "Comma-separated stack tags; repeatable",
      collectStack,
      [] as string[],
    )
    .option("--timestamp <iso>", "ISO timestamp for the clank")
    .option("--endpoint <url>", "Ingestion endpoint override")
    .option("--api-key <key>", "API key override")
    .option("--dry-run", "Print the payload without sending it")
    .action(() => {
      console.log("clankerlog ping is not implemented yet.");
    });
}

function collectStack(value: string, previous: string[]): string[] {
  return [...previous, value];
}
