import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import {
  buildOmpExtension,
  getOmpHookStatus,
  installOmpHook,
  uninstallOmpHook,
} from "../../src/omp-hook.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("omp extension management", () => {
  it("installs clankerlog.ts in the omp global extensions directory", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, ".omp", "agent", "extensions", "clankerlog.ts");

    const plan = await installOmpHook({ extensionPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(buildOmpExtension());
    expect(buildOmpExtension()).toContain('pi.on("agent_end"');
    expect(buildOmpExtension()).toContain('"ping", "--agent", "omp"');
    expect(buildOmpExtension()).toContain("ctx.cwd");
    expect(buildOmpExtension().indexOf('typeof model.id === "string"')).toBeLessThan(
      buildOmpExtension().indexOf('typeof model.name === "string"'),
    );
    expect(buildOmpExtension()).not.toContain("message.content");
  });

  it("is idempotent when the generated extension already matches", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");

    await installOmpHook({ extensionPath });
    const second = await installOmpHook({ extensionPath });

    expect(second.changed).toBe(false);
  });

  it("supports install dry-run without writing the extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");

    const plan = await installOmpHook({ extensionPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });

  it("reports status from the generated extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installOmpHook({ extensionPath });

    const status = await getOmpHookStatus({ extensionPath });

    expect(status).toEqual({
      extensionMatchesExpected: true,
      extensionPath,
      installed: true,
    });
  });

  it("uninstalls only the matching ClankerLog-managed extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installOmpHook({ extensionPath });

    const plan = await uninstallOmpHook({ extensionPath });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });

  it("supports uninstall dry-run without removing the extension", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await installOmpHook({ extensionPath });

    const plan = await uninstallOmpHook({ extensionPath, dryRun: true });

    expect(plan.changed).toBe(true);
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(buildOmpExtension());
  });

  it("refuses to remove a non-matching extension file", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    await mkdir(path.dirname(extensionPath), { recursive: true });
    await writeFile(extensionPath, "export default function other() {}\n");

    await expect(uninstallOmpHook({ extensionPath })).rejects.toThrow("Refusing to remove");
    await expect(readFile(extensionPath, "utf8")).resolves.toBe(
      "export default function other() {}\n",
    );
  });
});

describe("omp extension commands", () => {
  it("wires install, status, and uninstall through Commander", async () => {
    const root = await makeTempDir();
    const extensionPath = path.join(root, "extensions", "clankerlog.ts");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "install",
      "omp",
      "--extension-path",
      extensionPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "status",
      "omp",
      "--extension-path",
      extensionPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "integrations",
      "uninstall",
      "omp",
      "--extension-path",
      extensionPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${extensionPath}`);
    expect(stdout.text()).toContain("Files: clankerlog.ts");
    expect(stdout.text()).toContain(
      "Command: clankerlog ping --agent omp --model <active omp model>",
    );
    expect(stdout.text()).toContain("Status: ClankerLog omp extension is installed.");
    expect(stdout.text()).toContain("Action: removed ClankerLog omp extension.");
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
      "integrations",
      "install",
      "omp",
      "--extension-path",
      extensionPath,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("Action: would install ClankerLog omp agent_end extension.");
    expect(stdout.text()).toContain("restart omp");
    await expect(readFile(extensionPath, "utf8")).rejects.toThrow();
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-omp-hooks-"));
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
