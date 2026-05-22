import type { Command } from "commander";
import { registerClaudeHooksCommands } from "../agent-hooks/claude.js";
import {
  handleHookStatus,
  handleInstallHook,
  handleUninstallHook,
} from "../agent-hooks/config-agent-hooks.js";
import { registerCodexHooksCommands } from "../agent-hooks/codex.js";
import { registerCursorHooksCommands } from "../agent-hooks/cursor.js";
import { registerHermesHooksCommands } from "../agent-hooks/hermes.js";
import type { HooksCommandGroups } from "../agent-hooks/install-shared.js";
import {
  handleInstallOpenClawHook,
  handleOpenClawHookStatus,
  handleUninstallOpenClawHook,
  registerOpenClawHooksCommands,
} from "../agent-hooks/openclaw.js";
import {
  handleInstallPiHook,
  handlePiHookStatus,
  handleUninstallPiHook,
  registerPiHooksCommands,
} from "../agent-hooks/pi.js";
import { registerTopchesterHooksCommands } from "../agent-hooks/topchester.js";

export {
  handleHookStatus,
  handleInstallHook,
  handleInstallOpenClawHook,
  handleInstallPiHook,
  handleOpenClawHookStatus,
  handlePiHookStatus,
  handleUninstallHook,
  handleUninstallOpenClawHook,
  handleUninstallPiHook,
};

export function registerHooksCommand(program: Command): void {
  const hooks = program.command("hooks").description("Install and inspect coding-agent hooks.");
  const groups: HooksCommandGroups = {
    install: hooks.command("install").description("Install a ClankerLog Stop hook."),
    status: hooks.command("status").description("Inspect a ClankerLog Stop hook."),
    uninstall: hooks.command("uninstall").description("Remove a ClankerLog Stop hook."),
  };

  registerCodexHooksCommands(groups);
  registerClaudeHooksCommands(groups);
  registerCursorHooksCommands(groups);
  registerHermesHooksCommands(groups);
  registerTopchesterHooksCommands(groups);
  registerPiHooksCommands(groups);
  registerOpenClawHooksCommands(groups);
}
