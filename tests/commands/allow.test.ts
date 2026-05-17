import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleAllow } from "../../src/commands/allow.js";
import { loadGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

describe("allow command", () => {
  it("allows the current project with an explicit name", async () => {
    const root = await makeTempDir();
    const projectPath = await realpath(root);
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await handleAllow({ name: "CLI" }, runtime);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      allowedProjects: [{ displayName: "CLI", path: projectPath }],
    });
    expect(runtime.stdoutText()).toContain(`Allowed ${projectPath} -> CLI.`);
  });

  it("uses project config name when present", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });
    await writeFile(
      path.join(root, ".clankerlog.json"),
      JSON.stringify({ displayName: "Project Config Name" }),
    );

    await handleAllow({}, runtime);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      allowedProjects: [{ displayName: "Project Config Name" }],
    });
  });

  it("is idempotent for already allowed projects", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await handleAllow({ name: "CLI" }, runtime);
    await handleAllow({ name: "Other" }, runtime);

    const config = await loadGlobalConfig(configPath);
    expect(config.allowedProjects).toHaveLength(1);
    expect(config.allowedProjects[0]?.displayName).toBe("CLI");
    expect(runtime.stdoutText()).toContain("Project already allowed:");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-allow-"));
}
