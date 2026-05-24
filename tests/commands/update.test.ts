import { describe, expect, it, vi, afterEach } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import {
  detectPackageManager,
  fetchLatestVersion,
  getUpdateCommand,
  getUpdateStatus,
  handleUpdate,
} from "../../src/commands/update.js";
import { createMemoryRuntime } from "../helpers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("update command", () => {
  it("reports when the CLI is already up to date", async () => {
    const runtime = createRuntime();
    const runPackageCommand = vi.fn(async () => undefined);

    await handleUpdate({}, runtime, {
      fetchLatestVersion: async () => packageJson.version,
      runPackageCommand,
    });

    expect(runtime.stdoutText()).toContain(`clankerlog is up to date (${packageJson.version}).`);
    expect(runPackageCommand).not.toHaveBeenCalled();
  });

  it("checks for updates without installing", async () => {
    const runtime = createRuntime();
    const runPackageCommand = vi.fn(async () => undefined);

    await handleUpdate({ check: true }, runtime, {
      fetchLatestVersion: async () => "99.0.0",
      runPackageCommand,
    });

    expect(runtime.stdoutText()).toContain(
      `Update available: ${packageJson.name} ${packageJson.version} -> 99.0.0`,
    );
    expect(runtime.stdoutText()).toContain("Run `clankerlog update` to install it.");
    expect(runPackageCommand).not.toHaveBeenCalled();
  });

  it("prints the npm install command during dry runs", async () => {
    const runtime = createRuntime();
    const runPackageCommand = vi.fn(async () => undefined);

    await handleUpdate({ dryRun: true, manager: "npm" }, runtime, {
      fetchLatestVersion: async () => "99.0.0",
      runPackageCommand,
    });

    expect(runtime.stdoutText()).toContain("Would run: npm install -g clankerlog@latest");
    expect(runPackageCommand).not.toHaveBeenCalled();
  });

  it("runs the detected package manager when installing", async () => {
    const runtime = createRuntime({
      npm_config_user_agent: "pnpm/11.0.8 npm/? node/v25.0.0 darwin arm64",
    });
    const runPackageCommand = vi.fn(async () => undefined);

    await handleUpdate({}, runtime, {
      fetchLatestVersion: async () => "99.0.0",
      runPackageCommand,
    });

    expect(runPackageCommand).toHaveBeenCalledWith(
      "pnpm",
      ["add", "-g", "clankerlog@latest"],
      runtime,
    );
    expect(runtime.stdoutText()).toContain("Running: pnpm add -g clankerlog@latest");
    expect(runtime.stdoutText()).toContain("Updated clankerlog to 99.0.0.");
  });

  it("fetches the latest package version from an npm registry", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 }),
    ) as typeof fetch;

    await expect(fetchLatestVersion("@scope/pkg", "https://registry.example.test/")).resolves.toBe(
      "1.2.3",
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://registry.example.test/%40scope%2Fpkg/latest",
      expect.objectContaining({
        headers: expect.objectContaining({ accept: expect.stringContaining("application/json") }),
      }),
    );
  });

  it("compares semver versions instead of plain strings", () => {
    expect(getUpdateStatus("0.9.0", "0.10.0").updateAvailable).toBe(true);
    expect(getUpdateStatus("1.0.0", "1.0.0-beta.1").updateAvailable).toBe(false);
  });

  it("detects supported package managers from npm user agent", () => {
    expect(detectPackageManager({ npm_config_user_agent: "bun/1.3.0 npm/? node/v25.0.0" })).toBe(
      "bun",
    );
    expect(detectPackageManager({})).toBe("npm");
  });

  it("builds global update commands for supported package managers", () => {
    expect(getUpdateCommand("npm", "clankerlog")).toEqual({
      command: "npm",
      args: ["install", "-g", "clankerlog@latest"],
    });
    expect(getUpdateCommand("yarn", "clankerlog")).toEqual({
      command: "yarn",
      args: ["global", "add", "clankerlog@latest"],
    });
  });
});

function createRuntime(env: NodeJS.ProcessEnv = {}) {
  return createMemoryRuntime({
    configPath: "/tmp/clankerlog-test/config.json",
    cwd: "/tmp",
    env,
  });
}
