import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCodexStopHook } from "../../src/commands/hook.js";
import { saveGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
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

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-hook-"));
}
