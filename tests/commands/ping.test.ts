import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePing, resolvePing } from "../../src/commands/ping.js";
import { saveGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ping command", () => {
  it("fails closed from denied project folders", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await expect(
      handlePing({ agent: "codex", dryRun: true, model: "gpt-5.5" }, runtime),
    ).rejects.toThrow("This project is not allowed to clank yet.");
  });

  it("prints dry-run payload without network access or full API key", async () => {
    const { configPath, runtime } = await setupAllowedProject();
    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "CLI", path: await realpath(runtime.cwd) }],
      apiKey: "clk_live_abcdef_secret",
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("dry-run should not fetch");
    }) as typeof fetch;

    await handlePing(
      {
        agent: "codex",
        dryRun: true,
        model: "gpt-5.5",
        stack: ["typescript,hono"],
        timestamp: "2026-05-17T20:22:00Z",
      },
      runtime,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(runtime.stdoutText()).toContain("https://ingest.clankerlog.ai/v1/clanks");
    expect(runtime.stdoutText()).toContain("clk_live_abc...redacted");
    expect(runtime.stdoutText()).not.toContain("clk_live_abcdef_secret");
    expect(runtime.stdoutText()).toContain('"type": "clank"');
    expect(runtime.stdoutText()).toContain('"stack": [');
    expect(runtime.stdoutText()).toContain('"hono"');
    expect(runtime.stdoutText()).toContain('"pnpm"');
  });

  it("uses folder names for auto-tracked projects", async () => {
    const { configPath, projectPath, runtime } = await setupAllowedProject();
    await saveGlobalConfig(configPath, {
      allowedProjects: [],
      autoTrackProjects: true,
      apiKey: "clk_live_abcdef_secret",
    });

    const resolved = await resolvePing(
      {
        agent: "codex",
        model: "gpt-5.5",
        timestamp: "2026-05-17T20:22:00Z",
      },
      runtime,
    );

    expect(resolved.projectPath).toBe(projectPath);
    expect(resolved.payload.project.display_name).toBe(path.basename(projectPath));
  });

  it("uses project config names for auto-tracked projects", async () => {
    const { configPath, projectPath, runtime } = await setupAllowedProject();
    await writeFile(
      path.join(projectPath, ".clankerlog.json"),
      JSON.stringify({ displayName: "Project File" }),
    );
    await saveGlobalConfig(configPath, {
      allowedProjects: [],
      autoTrackProjects: true,
    });

    const resolved = await resolvePing(
      {
        agent: "codex",
        model: "gpt-5.5",
        timestamp: "2026-05-17T20:22:00Z",
      },
      runtime,
    );

    expect(resolved.payload.project.display_name).toBe("Project File");
  });

  it("resolves flags before env, project config, and global config", async () => {
    const { configPath, projectPath, runtime } = await setupAllowedProject({
      env: {
        CLANKERLOG_AGENT: "env-agent",
        CLANKERLOG_INGEST_URL: "https://ingest.dev.clankerlog.ai/v1/clanks",
        CLANKERLOG_MODEL: "env-model",
        CLANKERLOG_STACK: "python",
      },
    });
    await writeFile(
      path.join(projectPath, ".clankerlog.json"),
      JSON.stringify({ displayName: "Project File", stack: ["rust"] }),
    );
    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "Allowed Name", path: projectPath }],
      endpoint: "https://ingest.clankerlog.ai/v1/clanks",
    });

    const resolved = await resolvePing(
      {
        agent: "flag-agent",
        model: "flag-model",
        project: "Flag Project",
        stack: ["typescript"],
        timestamp: "2026-05-17T20:22:00Z",
      },
      runtime,
    );

    expect(resolved.endpoint).toBe("https://ingest.dev.clankerlog.ai/v1/clanks");
    expect(resolved.payload).toMatchObject({
      agent: "flag-agent",
      model: "flag-model",
      project: { display_name: "Flag Project" },
    });
    expect(resolved.payload.stack).toContain("typescript");
    expect(resolved.payload.stack).not.toContain("python");
    expect(resolved.payload.stack).not.toContain("rust");
  });

  it("sends one clank when configured", async () => {
    const { configPath, runtime } = await setupAllowedProject();
    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "CLI", path: await realpath(runtime.cwd) }],
      apiKey: "clk_live_abcdef_secret",
    });
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ id: "clank_123", ok: true }), { status: 202 }),
    ) as typeof fetch;

    await handlePing(
      {
        agent: "codex",
        model: "gpt-5.5",
        timestamp: "2026-05-17T20:22:00Z",
      },
      runtime,
    );

    expect(runtime.stdoutText()).toContain("Clank accepted: clank_123");
  });
});

async function setupAllowedProject(options: { env?: NodeJS.ProcessEnv } = {}) {
  const root = await makeTempDir();
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(path.join(root, "pnpm-lock.yaml"), "");
  const projectPath = await realpath(root);
  const configPath = path.join(root, "global", "config.json");
  const runtime = createMemoryRuntime({ configPath, cwd: root, env: options.env });

  return { configPath, projectPath, runtime };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-ping-"));
}
