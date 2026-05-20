import type { Command } from "commander";
import { handleClaudeStopHook, registerClaudeHookCommand } from "../agent-hooks/claude.js";
import { handleCodexStopHook, registerCodexHookCommand } from "../agent-hooks/codex.js";
import { handleCursorStopHook, registerCursorHookCommand } from "../agent-hooks/cursor.js";
import { handleHermesStopHook, registerHermesHookCommand } from "../agent-hooks/hermes.js";
import {
  handleOpenClawMessageSentHook,
  registerOpenClawHookCommand,
} from "../agent-hooks/openclaw.js";

export {
  handleClaudeStopHook,
  handleCodexStopHook,
  handleCursorStopHook,
  handleHermesStopHook,
  handleOpenClawMessageSentHook,
};

export function registerHookCommand(program: Command): void {
  const hook = program.command("hook").description("Run coding-agent hook integrations.");

  registerCodexHookCommand(hook);
  registerClaudeHookCommand(hook);
  registerCursorHookCommand(hook);
  registerHermesHookCommand(hook);
  registerOpenClawHookCommand(hook);
}
