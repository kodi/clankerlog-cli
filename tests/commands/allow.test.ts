import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import { handleAllow } from "../../src/commands/allow.js";
import { loadGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("enables automatic project tracking with --all", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "global", "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await handleAllow({ all: true }, runtime);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      allowedProjects: [],
      autoTrackProjects: true,
    });
    expect(runtime.stdoutText()).toContain("Automatic project tracking enabled.");
  });

  it("wires allow --all through Commander", async () => {
    const root = await makeTempDir();
    const configHome = path.join(root, "xdg-config");
    const configPath = path.join(configHome, "clankerlog", "config.json");
    const program = buildProgram();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    program.exitOverride();
    program.setOptionValue("workspace", root);
    await program.parseAsync(["node", "clankerlog", "allow", "--all"]);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      autoTrackProjects: true,
    });
    expect(stdoutWrite).toHaveBeenCalledWith("Automatic project tracking enabled.\n");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-allow-"));
}
