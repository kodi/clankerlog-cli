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
  handleInstallOpencodeHook,
  handleOpencodeHookStatus,
  handleUninstallOpencodeHook,
  registerOpencodeHooksCommands,
} from "../agent-hooks/opencode.js";
import {
  handleInstallPiHook,
  handlePiHookStatus,
  handleUninstallPiHook,
  registerPiHooksCommands,
} from "../agent-hooks/pi.js";
import { createRuntime, type CliRuntime } from "../runtime.js";
import { registerTopchesterHooksCommands } from "../agent-hooks/topchester.js";

export {
  handleHookStatus,
  handleInstallHook,
  handleInstallOpenClawHook,
  handleInstallOpencodeHook,
  handleInstallPiHook,
  handleOpenClawHookStatus,
  handleOpencodeHookStatus,
  handlePiHookStatus,
  handleUninstallHook,
  handleUninstallOpenClawHook,
  handleUninstallOpencodeHook,
  handleUninstallPiHook,
};

export function registerIntegrationsCommand(program: Command): void {
  const integrations = program
    .command("integrations")
    .description("Install and inspect ClankerLog coding-agent integrations.");
  integrations
    .command("list")
    .description("List supported ClankerLog integrations.")
    .action((_options, command: Command) => {
      handleListIntegrations(createRuntime(command));
    });

  const groups: HooksCommandGroups = {
    install: integrations.command("install").description("Install a ClankerLog integration."),
    status: integrations.command("status").description("Inspect a ClankerLog integration."),
    uninstall: integrations.command("uninstall").description("Remove a ClankerLog integration."),
  };

  registerCodexHooksCommands(groups);
  registerClaudeHooksCommands(groups);
  registerCursorHooksCommands(groups);
  registerHermesHooksCommands(groups);
  registerTopchesterHooksCommands(groups);
  registerOpencodeHooksCommands(groups);
  registerPiHooksCommands(groups);
  registerOpenClawHooksCommands(groups);
}

export function handleListIntegrations(runtime: CliRuntime): void {
  runtime.stdout.write(
    [
      "Supported integrations:",
      "  codex       Codex Stop hook",
      "  claude      Claude Code Stop hook",
      "  cursor      Cursor stop hook",
      "  hermes      Hermes shell hook",
      "  topchester  Topchester Stop hook",
      "  opencode    Opencode session.idle plugin",
      "  openclaw    OpenClaw message:sent hook",
      "  pi          Pi agent_end extension",
      "",
    ].join("\n"),
  );
}
