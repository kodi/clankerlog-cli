import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import {
  buildPiExtension,
  getPiHookStatus,
  installPiHook,
  uninstallPiHook,
} from "../../src/pi-hook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pi extension management", () => {
  it("installs clankerlog.ts in the Pi global extensions directory", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, ".pi", "agent", "extensions", "clankerlog.ts");

    const plan = await installPiHook({ extensionPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(buildPiExtension());
    expect(buildPiExtension()).toContain('pi.on("agent_end"');
    expect(buildPiExtension()).toContain('"ping", "--agent", "pi"');
    expect(buildPiExtension()).toContain("ctx.cwd");
    expect(buildPiExtension()).not.toContain("message.content");
  });

  it("is idempotent when the generated extension already matches", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");

    await installPiHook({ extensionPath });
    const second = await installPiHook({ extensionPath });

    expect(second.changed).toBe(false);
  });

  it("supports install dry-run without writing the extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");

    const plan = await installPiHook({ extensionPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });

  it("reports status from the generated extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installPiHook({ extensionPath });

    const status = await getPiHookStatus({ extensionPath });

    expect(status).toEqual({
      extensionMatchesExpected: true,
      extensionPath,
      installed: true,
    });
  });

  it("uninstalls only the matching ClankerLog-managed extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installPiHook({ extensionPath });

    const plan = await uninstallPiHook({ extensionPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });

  it("supports uninstall dry-run without removing the extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installPiHook({ extensionPath });

    const plan = await uninstallPiHook({ extensionPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(buildPiExtension());
  });

  it("refuses to remove a non-matching extension file", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await mkdir(path.dirname(extensionPath), { recursive: true });
    await writeFile(extensionPath, "export default function other() {}\n");

    await expect(uninstallPiHook({ extensionPath })).rejects.toThrow("Refusing to remove");
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(
      "export default function other() {}\n",
    );
  });
});

describe("Pi extension commands", () => {
  it("wires install, status, and uninstall through Commander", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "install",
      "pi",
      "--extension-path",
      extensionPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "status",
      "pi",
      "--extension-path",
      extensionPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "uninstall",
      "pi",
      "--extension-path",
      extensionPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${extensionPath}`);
    expect(stdout.text()).toContain("Files: clankerlog.ts");
    expect(stdout.text()).toContain(
      "Command: clankerlog ping --agent pi --model <active Pi model>",
    );
    expect(stdout.text()).toContain("Status: ClankerLog Pi extension is installed.");
    expect(stdout.text()).toContain("Action: removed ClankerLog Pi extension.");
  });

  it("wires install dry-run through Commander without writing the extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "install",
      "pi",
      "--extension-path",
      extensionPath,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("Action: would install ClankerLog Pi agent_end extension.");
    expect(stdout.text()).toContain("/reload");
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-pi-hooks-"));
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
