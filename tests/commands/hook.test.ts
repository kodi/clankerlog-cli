import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import { loadClaudeSessionModel } from "../../src/agent-hooks/claude-session-model.js";
import {
  handleClaudeSessionStartHook,
  handleClaudeStopHook,
  handleCodexStopHook,
  handleCursorStopHook,
  handleHermesStopHook,
  handleOpenClawMessageSentHook,
  handleTopchesterStopHook,
} from "../../src/commands/hook.js";
import { saveGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

const originalFetch = globalThis.fetch;
const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStdin) {
    Object.defineProperty(process, "stdin", originalStdin);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("codex stop hook", () => {
  it("sends one quiet clank using cwd and model from hook stdin", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      env: {
        CLANKERLOG_AGENT: "codex",
      },
      stdin: JSON.stringify(codexStopPayload({ cwd: projectPath, model: "gpt-5.5" })),
    });

    await handleCodexStopHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "codex",
      model: "gpt-5.5",
      project: { display_name: "Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("do not collect me");
    expect(JSON.stringify(body)).not.toContain("transcript.jsonl");
  });

  it("quietly no-ops when the hook cwd is not allowed", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const runtime = createMemoryRuntime({
      configPath,
      cwd: root,
      stdin: JSON.stringify(codexStopPayload({ cwd: root, model: "gpt-5.5" })),
    });

    await handleCodexStopHook(runtime);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toBe("");
    expect(runtime.stderrText()).toBe("");
  });

  it("wires the hook codex stop CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify(codexStopPayload({ cwd: projectPath, model: "gpt-5.5" })),
      ]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "codex", "stop"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("supports dry-run without sending a clank", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(codexStopPayload({ cwd: projectPath, model: "gpt-5.5" })),
    });

    await handleCodexStopHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "codex"');
    expect(runtime.stdoutText()).toContain('"model": "gpt-5.5"');
  });
});

describe("claude stop hook", () => {
  it("uses the model cached by the Claude SessionStart hook", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Claude Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    await handleClaudeSessionStartHook(
      createMemoryRuntime({
        configPath,
        cwd: projectPath,
        stdin: JSON.stringify(
          claudeSessionStartPayload({ cwd: projectPath, model: "claude-sonnet-4-6" }),
        ),
      }),
    );

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(claudeStopPayload({ cwd: projectPath })),
    });

    await handleClaudeStopHook(runtime);

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "claude",
      model: "claude-sonnet-4.6",
      project: { display_name: "Claude Hook Project" },
      type: "clank",
    });
  });

  it("sends one quiet clank using cwd from hook stdin and model from env", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Claude Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      env: {
        CLANKERLOG_MODEL: "gpt-5.5(low)",
      },
      stdin: JSON.stringify(claudeStopPayload({ cwd: projectPath })),
    });

    await handleClaudeStopHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "claude",
      model: "gpt-5.5",
      project: { display_name: "Claude Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("do not collect me");
    expect(JSON.stringify(body)).not.toContain("transcript.jsonl");
  });

  it("wires the hook claude stop CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("CLANKERLOG_MODEL", "gpt-5.5(low)");
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([JSON.stringify(claudeStopPayload({ cwd: projectPath }))]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Claude Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "claude", "stop"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("supports dry-run without sending a clank", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Claude Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      env: {
        CLANKERLOG_MODEL: "gpt-5.5(low)",
      },
      stdin: JSON.stringify(claudeStopPayload({ cwd: projectPath })),
    });

    await handleClaudeStopHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "claude"');
    expect(runtime.stdoutText()).toContain('"model": "gpt-5.5"');
  });

  it("supports dry-run without stdin by using the current workspace", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Claude Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: projectPath,
      env: {
        CLANKERLOG_MODEL: "gpt-5.5",
      },
    });

    await handleClaudeStopHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "claude"');
    expect(runtime.stdoutText()).toContain('"model": "gpt-5.5"');
    expect(runtime.stdoutText()).toContain('"display_name": "Claude Hook Project"');
  });

  it("wires the hook claude session-start CLI command through Commander", async () => {
    const root = await makeTempDir();
    const configHome = path.join(root, "xdg-config");
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify(claudeSessionStartPayload({ cwd: root, model: "claude-opus-4-8" })),
      ]),
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "claude", "session-start"]);

    const runtime = createMemoryRuntime({
      configPath: path.join(configHome, "clankerlog", "config.json"),
      cwd: root,
    });
    await expectClaudeSessionModel(runtime, "session_123", "claude-opus-4-8");
  });
});

describe("cursor stop hook", () => {
  it("sends one quiet clank using workspace root and model from hook stdin", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Cursor Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(cursorStopPayload({ workspaceRoot: projectPath, model: "gpt-5.5" })),
    });

    await handleCursorStopHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "cursor",
      model: "gpt-5.5",
      project: { display_name: "Cursor Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("transcript.jsonl");
    expect(JSON.stringify(body)).not.toContain("kodi@example.com");
  });

  it("wires the hook cursor stop CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify(cursorStopPayload({ workspaceRoot: projectPath, model: "gpt-5.5" })),
      ]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Cursor Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "cursor", "stop"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("hermes stop hook", () => {
  it("sends one quiet clank using cwd and model from post_llm_call shell hook stdin", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hermes Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(hermesPostLlmPayload({ cwd: projectPath, model: "nous/hermes-4" })),
    });

    await handleHermesStopHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "hermes",
      model: "nous/hermes-4",
      project: { display_name: "Hermes Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("do not collect me");
    expect(JSON.stringify(body)).not.toContain("conversation_history");
  });

  it("wires the hook hermes stop CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify(hermesPostLlmPayload({ cwd: projectPath, model: "nous/hermes-4" })),
      ]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hermes Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "hermes", "stop"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores interrupted on_session_end payloads", async () => {
    const root = await makeTempDir();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const runtime = createMemoryRuntime({
      configPath: path.join(root, "global", "config.json"),
      cwd: root,
      stdin: JSON.stringify({
        cwd: root,
        extra: {
          completed: false,
          interrupted: true,
          model: "nous/hermes-4",
          platform: "cli",
        },
        hook_event_name: "on_session_end",
        session_id: "session_123",
      }),
    });

    await handleHermesStopHook(runtime);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toBe("");
    expect(runtime.stderrText()).toBe("");
  });

  it("supports dry-run without stdin by using the current workspace", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Hermes Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: projectPath,
      env: {
        CLANKERLOG_MODEL: "nous/hermes-4",
      },
    });

    await handleHermesStopHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "hermes"');
    expect(runtime.stdoutText()).toContain('"model": "nous/hermes-4"');
    expect(runtime.stdoutText()).toContain('"display_name": "Hermes Hook Project"');
  });
});

describe("topchester stop hook", () => {
  it("sends one quiet clank using workspace and model from Topchester stdin", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Topchester Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(topchesterStopPayload({ workspaceRoot: projectPath })),
    });

    await handleTopchesterStopHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "topchester",
      model: "claude-sonnet-4.5",
      project: { display_name: "Topchester Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("do not collect me");
  });

  it("wires the hook topchester stop CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([JSON.stringify(topchesterStopPayload({ workspaceRoot: projectPath }))]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Topchester Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "topchester", "stop"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores failed Topchester turns", async () => {
    const root = await makeTempDir();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const runtime = createMemoryRuntime({
      configPath: path.join(root, "global", "config.json"),
      cwd: root,
      stdin: JSON.stringify({
        ...topchesterStopPayload({ workspaceRoot: root }),
        status: "failed",
      }),
    });

    await handleTopchesterStopHook(runtime);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toBe("");
    expect(runtime.stderrText()).toBe("");
  });

  it("normalizes nested OpenRouter provider prefixes from Topchester model metadata", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Topchester Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(
        topchesterStopPayload({
          modelId: "google/gemini-3.1-flash-lite",
          modelRef: "openrouter/google/gemini-3.1-flash-lite",
          workspaceRoot: projectPath,
        }),
      ),
    });

    await handleTopchesterStopHook(runtime);

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("gemini-3.1-flash-lite");
  });

  it("supports dry-run without stdin by using the current workspace", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Topchester Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: projectPath,
      env: {
        CLANKERLOG_MODEL: "openrouter/anthropic/claude-sonnet-4.5",
      },
    });

    await handleTopchesterStopHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "topchester"');
    expect(runtime.stdoutText()).toContain('"model": "claude-sonnet-4.5"');
    expect(runtime.stdoutText()).toContain('"display_name": "Topchester Hook Project"');
  });
});

describe("openclaw message:sent hook", () => {
  it("sends one quiet clank using explicit workspace metadata", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "OpenClaw Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: await makeTempDir(),
      stdin: JSON.stringify(
        openClawMessageSentPayload({ workspaceDir: projectPath, model: "gpt-5.5" }),
      ),
    });

    await handleOpenClawMessageSentHook(runtime);

    expect(runtime.stdoutText()).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      agent: "openclaw",
      model: "gpt-5.5",
      project: { display_name: "OpenClaw Hook Project" },
      type: "clank",
    });
    expect(JSON.stringify(body)).not.toContain("do not collect me");
  });

  it("rejects unsuccessful message payloads in dry-run validation", async () => {
    const root = await makeTempDir();
    const runtime = createMemoryRuntime({
      configPath: path.join(root, "global", "config.json"),
      cwd: root,
      stdin: JSON.stringify({
        content: "do not collect me",
        success: false,
        workspaceDir: root,
      }),
    });

    await expect(handleOpenClawMessageSentHook(runtime, { dryRun: true })).rejects.toThrow(
      "OpenClaw message:sent hook payload was invalid",
    );
  });

  it("wires the hook openclaw message-sent CLI command through Commander", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: "clank_hook", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([
        JSON.stringify(openClawMessageSentPayload({ workspaceDir: projectPath, model: "gpt-5.5" })),
      ]),
    });

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "OpenClaw Hook Project", path: projectPath }],
      apiKey: "clk_live_hook_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "clankerlog", "hook", "openclaw", "message-sent"]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("supports dry-run without stdin by using the current workspace", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "package.json"), "{}");
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "OpenClaw Hook Project", path: projectPath }],
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    const runtime = createMemoryRuntime({
      configPath,
      cwd: projectPath,
      env: {
        CLANKERLOG_MODEL: "gpt-5.5",
      },
    });

    await handleOpenClawMessageSentHook(runtime, { dryRun: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain('"agent": "openclaw"');
    expect(runtime.stdoutText()).toContain('"model": "gpt-5.5"');
    expect(runtime.stdoutText()).toContain('"display_name": "OpenClaw Hook Project"');
  });
});

function codexStopPayload(options: { cwd: string; model: string }) {
  return {
    cwd: options.cwd,
    hook_event_name: "Stop",
    last_assistant_message: "do not collect me",
    model: options.model,
    permission_mode: "default",
    session_id: "session_123",
    stop_hook_active: false,
    transcript_path: "/tmp/transcript.jsonl",
    turn_id: "turn_123",
  };
}

function claudeStopPayload(options: { cwd: string }) {
  return {
    cwd: options.cwd,
    hook_event_name: "Stop",
    last_assistant_message: "do not collect me",
    permission_mode: "default",
    session_id: "session_123",
    stop_hook_active: false,
    transcript_path: "/tmp/transcript.jsonl",
  };
}

function claudeSessionStartPayload(options: { cwd: string; model: string }) {
  return {
    cwd: options.cwd,
    hook_event_name: "SessionStart",
    model: options.model,
    session_id: "session_123",
    source: "startup",
    transcript_path: "/tmp/transcript.jsonl",
  };
}

async function expectClaudeSessionModel(
  runtime: ReturnType<typeof createMemoryRuntime>,
  sessionId: string,
  model: string,
): Promise<void> {
  await expect(loadClaudeSessionModel(runtime, sessionId)).resolves.toBe(model);
}

function cursorStopPayload(options: { workspaceRoot: string; model: string }) {
  return {
    conversation_id: "conversation_123",
    cursor_version: "2.6.22",
    generation_id: "generation_123",
    hook_event_name: "stop",
    model: options.model,
    transcript_path: "/tmp/transcript.jsonl",
    user_email: "kodi@example.com",
    workspace_roots: [options.workspaceRoot],
  };
}

function hermesPostLlmPayload(options: { cwd: string; model: string }) {
  return {
    cwd: options.cwd,
    extra: {
      assistant_response: "do not collect me",
      conversation_history: [{ content: "do not collect me", role: "user" }],
      model: options.model,
      platform: "cli",
      user_message: "do not collect me",
    },
    hook_event_name: "post_llm_call",
    session_id: "session_123",
    tool_input: null,
    tool_name: null,
  };
}

function topchesterStopPayload(options: {
  workspaceRoot: string;
  modelId?: string;
  modelRef?: string;
}) {
  const modelId = options.modelId ?? "anthropic/claude-sonnet-4.5";
  const modelRef = options.modelRef ?? "openrouter/anthropic/claude-sonnet-4.5";

  return {
    cwd: options.workspaceRoot,
    event: "Stop",
    finalMessage: "do not collect me",
    hook_event_name: "Stop",
    model: {
      modelId,
      providerId: "openrouter",
      ref: modelRef,
    },
    model_id: modelId,
    model_ref: modelRef,
    session_id: "session_123",
    source: "topchester",
    status: "completed",
    taskCompleteAlias: "TaskComplete",
    workspaceRoot: options.workspaceRoot,
  };
}

function openClawMessageSentPayload(options: { workspaceDir: string; model: string }) {
  return {
    content: "do not collect me",
    model: options.model,
    success: true,
    workspaceDir: options.workspaceDir,
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-hook-"));
}
