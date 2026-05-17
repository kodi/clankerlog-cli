import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleInit } from "../../src/commands/init.js";
import { loadGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

describe("init command", () => {
  it("allows the current project and writes project config", async () => {
    const root = await makeTempDir();
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await handleInit({ name: "CLI", stack: ["typescript,hono", "d1"] }, runtime);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      allowedProjects: [{ displayName: "CLI", path: projectPath }],
    });
    await expect(readJson(path.join(root, ".clankerlog.json"))).resolves.toEqual({
      displayName: "CLI",
      stack: ["typescript", "hono", "d1"],
    });
    expect(runtime.stdoutText()).toContain(`Allowed ${projectPath} as CLI.`);
  });
});

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-init-"));
}
