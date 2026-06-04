import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import {
  buildOpencodePlugin,
  getOpencodeHookStatus,
  installOpencodeHook,
  uninstallOpencodeHook,
} from "../../src/opencode-hook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Opencode plugin management", () => {
  it("installs clankerlog.ts in the Opencode global plugins directory", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, ".config", "opencode", "plugins", "clankerlog.ts");

    const plan = await installOpencodeHook({ pluginPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(pluginPath, "utf8")).resolves.toBe(buildOpencodePlugin());
    expect(buildOpencodePlugin()).toContain('event.type !== "session.idle"');
    expect(buildOpencodePlugin()).toContain('"ping", "--agent", "opencode", "--model"');
    expect(buildOpencodePlugin()).toContain("message.updated");
    expect(buildOpencodePlugin()).toContain("sentKeys");
    expect(buildOpencodePlugin()).not.toContain("last_assistant_message");
    expect(buildOpencodePlugin()).not.toContain(".text");
  });

  it("is idempotent when the generated plugin already matches", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");

    await installOpencodeHook({ pluginPath });
    const second = await installOpencodeHook({ pluginPath });

    expect(second.changed).toBe(false);
  });

  it("supports install dry-run without writing the plugin", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");

    const plan = await installOpencodeHook({ pluginPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("reports status from the generated plugin", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    await installOpencodeHook({ pluginPath });

    const status = await getOpencodeHookStatus({ pluginPath });

    expect(status).toEqual({
      installed: true,
      pluginMatchesExpected: true,
      pluginPath,
    });
  });

  it("uninstalls only the matching ClankerLog-managed plugin", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    await installOpencodeHook({ pluginPath });

    const plan = await uninstallOpencodeHook({ pluginPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("supports uninstall dry-run without removing the plugin", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    await installOpencodeHook({ pluginPath });

    const plan = await uninstallOpencodeHook({ pluginPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(pluginPath, "utf8")).resolves.toBe(buildOpencodePlugin());
  });

  it("refuses to remove a non-matching plugin file", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    await mkdir(path.dirname(pluginPath), { recursive: true });
    await writeFile(pluginPath, "export const OtherPlugin = async () => ({});\n");

    await expect(uninstallOpencodeHook({ pluginPath })).rejects.toThrow("Refusing to remove");
    await expect(readFile(pluginPath, "utf8")).resolves.toBe(
      "export const OtherPlugin = async () => ({});\n",
    );
  });
});

describe("Opencode plugin commands", () => {
  it("wires install, status, and uninstall through Commander", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "install",
      "opencode",
      "--plugin-path",
      pluginPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "status",
      "opencode",
      "--plugin-path",
      pluginPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "uninstall",
      "opencode",
      "--plugin-path",
      pluginPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${pluginPath}`);
    expect(stdout.text()).toContain("Files: clankerlog.ts");
    expect(stdout.text()).toContain(
      "Command: clankerlog ping --agent opencode --model <active Opencode model>",
    );
    expect(stdout.text()).toContain("Status: ClankerLog Opencode plugin is installed.");
    expect(stdout.text()).toContain("Action: removed ClankerLog Opencode plugin.");
  });

  it("wires install dry-run through Commander without writing the plugin", async () => {
    const root = await makeTempDir();
    const pluginPath = path.join(root, "plugins", "clankerlog.ts");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "install",
      "opencode",
      "--plugin-path",
      pluginPath,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain(
      "Action: would install ClankerLog Opencode session.idle plugin.",
    );
    expect(stdout.text()).toContain("restart Opencode");
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-opencode-hooks-"));
}

function captureStdout(): { text: () => string } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(chunk.toString());
    return true;
  });

  return {
    text: () => chunks.join(""),
  };
}
