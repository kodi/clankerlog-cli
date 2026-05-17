import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadGlobalConfig,
  loadProjectConfig,
  resolveGlobalConfigPath,
  saveGlobalConfig,
} from "../src/config.js";

describe("global config", () => {
  it("loads an absent config as the empty default", async () => {
    const config = await loadGlobalConfig(path.join(tmpdir(), "missing-clankerlog-config.json"));

    expect(config).toEqual({ allowedProjects: [] });
  });

  it("saves and loads valid config", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "config.json");

    await saveGlobalConfig(configPath, {
      allowedProjects: [{ displayName: "clankerlog", path: root }],
      apiKey: "clk_live_test_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });

    await expect(loadGlobalConfig(configPath)).resolves.toEqual({
      allowedProjects: [{ displayName: "clankerlog", path: root }],
      apiKey: "clk_live_test_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
    });
  });

  it("rejects malformed config cleanly", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, '{"allowedProjects":');

    await expect(loadGlobalConfig(configPath)).rejects.toBeInstanceOf(ConfigError);
  });

  it("rejects schema-invalid config cleanly", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ allowedProjects: [{ displayName: "", path: root }] }),
    );

    await expect(loadGlobalConfig(configPath)).rejects.toThrow("invalid");
  });

  it("resolves XDG config path without touching the real home directory", () => {
    const configPath = resolveGlobalConfigPath({
      env: { XDG_CONFIG_HOME: "/tmp/xdg-test" },
      home: "/tmp/home-test",
    });

    expect(configPath).toBe("/tmp/xdg-test/clankerlog/config.json");
  });
});

describe("project config", () => {
  it("loads project-local config when present", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, ".clankerlog.json"),
      JSON.stringify({ displayName: "CLI", stack: ["typescript"] }),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({
      displayName: "CLI",
      stack: ["typescript"],
    });
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-cli-"));
}
