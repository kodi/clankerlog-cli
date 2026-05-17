import type { Command } from "commander";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Print local ClankerLog CLI setup status without sending data.")
    .action(() => {
      console.log("clankerlog doctor is not implemented yet.");
    });
}
