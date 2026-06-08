import { Option, type Command } from "commander";
import { createRuntime } from "../runtime.js";
import { handleSetup, type SetupOptions } from "../setup.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Detect coding agents and install matching ClankerLog integrations.")
    .option("--yes", "Install without confirmation when running interactively")
    .option("--dry-run", "Show what setup would install without writing files")
    .option("--all", "Install every supported integration, even if not detected")
    .option("--include <agents>", "Comma-separated integrations to include")
    .option("--exclude <agents>", "Comma-separated integrations to exclude")
    .option("--model <model>", "Claude Code model name, for example claude-sonnet-4.5")
    .addOption(new Option("--home-directory <path>").hideHelp())
    .addOption(new Option("--path-env <path>").hideHelp())
    .addOption(new Option("--codex-config <path>").hideHelp())
    .addOption(new Option("--claude-config <path>").hideHelp())
    .addOption(new Option("--cursor-config <path>").hideHelp())
    .addOption(new Option("--hermes-config <path>").hideHelp())
    .addOption(new Option("--topchester-config <path>").hideHelp())
    .addOption(new Option("--opencode-plugin-path <path>").hideHelp())
    .addOption(new Option("--openclaw-hook-dir <path>").hideHelp())
    .addOption(new Option("--pi-extension-path <path>").hideHelp())
    .action(async (options: SetupOptions, command: Command) => {
      await handleSetup(options, createRuntime(command));
    });
}
