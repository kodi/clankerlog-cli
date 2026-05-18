import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDoctor } from "../../src/commands/doctor.js";
import { saveGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("doctor command", () => {
  it("reports local setup without printing secrets", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ authenticated: true, keyId: "devkey", ok: true }), {
          status: 200,
        }),
    ) as typeof fetch;

    const root = await makeTempDir();
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({
      configPath,
      cwd: root,
      env: {
        CLANKERLOG_AGENT: "codex",
        CLANKERLOG_MODEL: "gpt-5.5",
      },
    });

    await writeFile(
      path.join(root, ".clankerlog.json"),
      JSON.stringify({ displayName: "Project File", stack: ["typescript"] }),
    );
    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "CLI", path: projectPath }],
      apiKey: "clk_live_abcdef_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    await handleDoctor({}, runtime);

    expect(runtime.stdoutText()).toContain(`config: ok (${configPath})`);
    expect(runtime.stdoutText()).toContain("auth: ok clk_live_abc...redacted");
    expect(runtime.stdoutText()).not.toContain("clk_live_abcdef_secret");
    expect(runtime.stdoutText()).toContain("endpoint: https://ingest.dev.clankerlog.ai/v1/clanks");
    expect(runtime.stdoutText()).toContain("api check: ok keyId=devkey");
    expect(runtime.stdoutText()).toContain(`- ${projectPath} -> CLI`);
    expect(runtime.stdoutText()).toContain("current project: allowed as CLI");
    expect(runtime.stdoutText()).toContain(
      "project config: ok displayName=Project File stack=typescript",
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ingest.dev.clankerlog.ai/v1/auth/check",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer clk_live_abcdef_secret",
        }),
        method: "GET",
      }),
    );
  });

  it("reports API check failures without throwing", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
    ) as typeof fetch;

    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });
    await saveGlobalConfig(configPath, {
      allowedProjects: [],
      apiKey: "clk_live_bad_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    await handleDoctor({}, runtime);

    expect(runtime.stdoutText()).toContain(
      "api check: failed Authentication failed (401). Check your ClankerLog API key.",
    );
  });

  it("reports invalid global config without throwing", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });
    await writeFile(configPath, '{"allowedProjects":');

    await handleDoctor({}, runtime);

    expect(runtime.stdoutText()).toContain("config error:");
    expect(runtime.stdoutText()).toContain("config: error");
    expect(runtime.stdoutText()).toContain("api check: skipped (missing API key)");
    expect(runtime.stdoutText()).toContain("current project: denied");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-doctor-"));
}
