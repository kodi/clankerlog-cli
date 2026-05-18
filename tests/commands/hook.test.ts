import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import { handleClaudeStopHook, handleCodexStopHook } from "../../src/commands/hook.js";
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
      model: "gpt-5.5(low)",
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
    expect(runtime.stdoutText()).toContain('"model": "gpt-5.5(low)"');
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

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-hook-"));
}
