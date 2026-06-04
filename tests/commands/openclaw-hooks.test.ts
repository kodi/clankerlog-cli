import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import {
  buildOpenClawHandler,
  buildOpenClawHookMd,
  getOpenClawHookStatus,
  installOpenClawHook,
  uninstallOpenClawHook,
} from "../../src/openclaw-hook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenClaw hook directory management", () => {
  it("installs HOOK.md and handler.ts in the managed global hook directory", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, ".openclaw", "hooks", "clankerlog");

    const plan = await installOpenClawHook({ hookDir });

    expect(plan.changed).toBe(true);
    await expect(readFile(path.join(hookDir, "HOOK.md"), "utf8")).resolves.toBe(
      buildOpenClawHookMd(),
    );
    await expect(readFile(path.join(hookDir, "handler.ts"), "utf8")).resolves.toBe(
      buildOpenClawHandler(),
    );
    expect(buildOpenClawHookMd()).toContain('events: ["message:sent"]');
    expect(buildOpenClawHandler()).not.toContain("writeDebugLog");
    expect(buildOpenClawHandler()).not.toContain("openclaw-hook.log");
    expect(buildOpenClawHandler()).toContain("openClawSessionInfo");
    expect(buildOpenClawHandler()).toContain("systemPromptReport?.model");
    expect(buildOpenClawHandler()).toContain("sessions.json");
    expect(buildOpenClawHandler()).not.toContain("event.context.content");
  });

  it("is idempotent when the generated files already match", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");

    await installOpenClawHook({ hookDir });
    const second = await installOpenClawHook({ hookDir });

    expect(second.changed).toBe(false);
  });

  it("supports install dry-run without writing hook files", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");

    const plan = await installOpenClawHook({ hookDir, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(path.join(hookDir, "HOOK.md"), "utf8")).rejects.toThrow();
  });

  it("reports status from generated files without requiring the OpenClaw CLI", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    await installOpenClawHook({ hookDir });

    const status = await getOpenClawHookStatus({ hookDir, inspectOpenClawCli: false });

    expect(status).toMatchObject({
      handlerMatchesExpected: true,
      hookMdMatchesExpected: true,
      installed: true,
      openClawCliAvailable: false,
    });
  });

  it("uninstalls only matching ClankerLog-managed hook files", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    await installOpenClawHook({ hookDir });

    const plan = await uninstallOpenClawHook({ hookDir });

    expect(plan.changed).toBe(true);
    await expect(readFile(path.join(hookDir, "HOOK.md"), "utf8")).rejects.toThrow();
  });

  it("supports uninstall dry-run without removing files", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    await installOpenClawHook({ hookDir });

    const plan = await uninstallOpenClawHook({ hookDir, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(path.join(hookDir, "handler.ts"), "utf8")).resolves.toBe(
      buildOpenClawHandler(),
    );
  });

  it("refuses to remove a directory that is not the expected ClankerLog hook", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    await mkdir(hookDir, { recursive: true });
    await writeFile(path.join(hookDir, "HOOK.md"), "# other hook\n");
    await writeFile(path.join(hookDir, "handler.ts"), "export default function handler() {}\n");

    await expect(uninstallOpenClawHook({ hookDir })).rejects.toThrow("Refusing to remove");
    await expect(readFile(path.join(hookDir, "HOOK.md"), "utf8")).resolves.toBe("# other hook\n");
  });

  it("refuses to remove unexpected files from the managed hook directory", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    await installOpenClawHook({ hookDir });
    await writeFile(path.join(hookDir, "notes.txt"), "not managed by ClankerLog\n");

    await expect(uninstallOpenClawHook({ hookDir })).rejects.toThrow("Refusing to remove");
    await expect(readFile(path.join(hookDir, "notes.txt"), "utf8")).resolves.toBe(
      "not managed by ClankerLog\n",
    );
  });
});

describe("OpenClaw hook commands", () => {
  it("wires install, status, and uninstall through Commander", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "install",
      "openclaw",
      "--hook-dir",
      hookDir,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "status",
      "openclaw",
      "--hook-dir",
      hookDir,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "uninstall",
      "openclaw",
      "--hook-dir",
      hookDir,
    ]);

    expect(stdout.text()).toContain(`Target: ${hookDir}`);
    expect(stdout.text()).toContain("Files: HOOK.md, handler.ts");
    expect(stdout.text()).toContain("Command: clankerlog hook openclaw message-sent");
    expect(stdout.text()).toContain("Status: ClankerLog OpenClaw hook is installed.");
    expect(stdout.text()).toContain("Action: removed ClankerLog OpenClaw hook.");
  });

  it("wires install dry-run through Commander without writing files", async () => {
    const root = await makeTempDir();
    const hookDir = path.join(root, "hooks", "clankerlog");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "install",
      "openclaw",
      "--hook-dir",
      hookDir,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("Action: would install ClankerLog OpenClaw message:sent hook.");
    await expect(readFile(path.join(hookDir, "HOOK.md"), "utf8")).rejects.toThrow();
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-openclaw-hooks-"));
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
