import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import { buildOpencodePlugin } from "../../src/opencode-hook.js";
import type { CliRuntime } from "../../src/runtime.js";
import { discoverSetupAgents, handleSetup } from "../../src/setup.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setup discovery", () => {
  it("finds an agent executable on PATH", async () => {
    const root = await makeTempDir();
    const bin = path.join(root, "bin");
    await mkdir(bin, { recursive: true });
    const codex = path.join(bin, "codex");
    await writeFile(codex, "#!/bin/sh\n");
    await chmod(codex, 0o755);

    const discoveries = await discoverSetupAgents({
      homeDirectory: root,
      pathEnv: bin,
    });

    expect(discoveries.find((entry) => entry.agent === "codex")).toMatchObject({
      agent: "codex",
      detected: true,
      signal: "PATH executable",
      status: "hook not installed",
    });
  });

  it("finds an agent config directory without a PATH executable", async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, ".config", "opencode"), { recursive: true });

    const discoveries = await discoverSetupAgents({
      homeDirectory: root,
      pathEnv: "",
    });

    expect(discoveries.find((entry) => entry.agent === "opencode")).toMatchObject({
      detected: true,
      signal: "config directory",
    });
  });

  it("finds the Topchester config directory", async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, ".config", "topchester"), { recursive: true });

    const discoveries = await discoverSetupAgents({
      homeDirectory: root,
      pathEnv: "",
    });

    expect(discoveries.find((entry) => entry.agent === "topchester")).toMatchObject({
      detected: true,
      signal: "config directory",
    });
  });
});

describe("setup command", () => {
  it("is registered in buildProgram", () => {
    const setup = buildProgram().commands.find((command) => command.name() === "setup");

    expect(setup?.description()).toBe(
      "Detect coding agents and install matching ClankerLog integrations.",
    );
  });

  it("prints a clear no-detection message and writes nothing", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--yes",
    ]);

    expect(stdout.text()).toContain("No supported coding agents detected.");
    expect(stdout.text()).toContain("Next: run clankerlog doctor");
    await expect(readFile(path.join(root, ".codex", "hooks.json"), "utf8")).rejects.toThrow();
  });

  it("dry-runs detected installs without writing files", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();
    await mkdir(path.join(root, ".codex"), { recursive: true });

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("Agent");
    expect(stdout.text()).toContain("ClankerLog hook");
    expect(stdout.text()).toContain("Detected by");
    expect(stdout.text()).toContain("○ codex");
    expect(stdout.text()).toContain("not installed");
    expect(stdout.text()).toContain("config directory");
    expect(stdout.text()).toContain("codex       would install at ~/.codex/hooks.json");
    await expect(readFile(path.join(root, ".codex", "hooks.json"), "utf8")).rejects.toThrow();
  });

  it("installs detected agents with --yes and prints uninstall commands", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();
    await mkdir(path.join(root, ".config", "opencode"), { recursive: true });

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--yes",
    ]);

    await expect(
      readFile(path.join(root, ".config", "opencode", "plugins", "clankerlog.ts"), "utf8"),
    ).resolves.toBe(buildOpencodePlugin());
    expect(stdout.text()).toContain(
      "opencode    installed at ~/.config/opencode/plugins/clankerlog.ts",
    );
    expect(stdout.text()).toContain("remove: clankerlog integrations uninstall opencode");
  });

  it("includes already-installed hooks in the summary", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "codex",
      "--yes",
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "codex",
      "--yes",
    ]);

    expect(stdout.text()).toContain("codex       already installed at ~/.codex/hooks.json");
  });

  it("installs Claude without a model and keeps processing other agents", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "claude,codex",
      "--yes",
    ]);

    expect(stdout.text()).toContain("claude      installed at ~/.claude/settings.json");
    expect(stdout.text()).toContain("codex       installed at ~/.codex/hooks.json");
  });

  it("confirms interactive Claude setup without asking for a model", async () => {
    const root = await makeTempDir();
    const stdout = captureWritable();
    const stdin = Readable.from(["yes\n"]);
    Object.defineProperty(stdin, "isTTY", { value: true });
    Object.defineProperty(stdout, "isTTY", { value: true });

    await handleSetup(
      {
        homeDirectory: root,
        include: "claude",
        pathEnv: "",
      },
      makeRuntime(root, stdin, stdout),
    );

    expect(stdout.text()).toContain("Install selected integrations?");
    expect(stdout.text()).toContain("claude      installed at ~/.claude/settings.json");
    await expect(readFile(path.join(root, ".claude", "settings.json"), "utf8")).resolves.toContain(
      "clankerlog hook claude session-start",
    );
  });

  it("keeps --model as a Claude Stop fallback when supplied", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "claude",
      "--model",
      "claude-sonnet-4.5",
      "--yes",
    ]);

    expect(stdout.text()).toContain("claude      installed at ~/.claude/settings.json");
    await expect(readFile(path.join(root, ".claude", "settings.json"), "utf8")).resolves.toContain(
      "CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
    );
  });

  it("supports --all regardless of detection", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--all",
      "--model",
      "claude-sonnet-4.5",
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("claude      would install at ~/.claude/settings.json");
    expect(stdout.text()).toContain("openclaw    would install at ~/.openclaw/hooks/clankerlog");
  });

  it("honors include and exclude filters", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "codex,opencode",
      "--exclude",
      "opencode",
      "--yes",
    ]);

    expect(stdout.text()).toContain("codex       installed at ~/.codex/hooks.json");
    expect(stdout.text()).not.toContain("opencode    installed");
  });

  it("formats current-user home paths as tilde even with an injected setup home", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    const codexConfig = path.join(homedir(), ".clankerlog-test", "hooks.json");
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "setup",
      "--home-directory",
      root,
      "--path-env",
      "",
      "--include",
      "codex",
      "--codex-config",
      codexConfig,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("codex       would install at ~/.clankerlog-test/hooks.json");
    expect(stdout.text()).not.toContain(homedir());
  });

  it("continues after a malformed config and exits non-zero", async () => {
    const root = await makeTempDir();
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, ".codex", "hooks.json"), "{bad json");

    await expect(
      program.parseAsync([
        "node",
        "clankerlog",
        "setup",
        "--home-directory",
        root,
        "--path-env",
        "",
        "--include",
        "codex,opencode",
        "--yes",
      ]),
    ).rejects.toThrow("Setup failed");

    expect(stdout.text()).toContain("codex       Hook config");
    expect(stdout.text()).toContain(
      "opencode    installed at ~/.config/opencode/plugins/clankerlog.ts",
    );
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-setup-"));
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

function captureWritable(): Writable & { text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: string | Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  }) as Writable & { text: () => string };
  stream.text = () => chunks.join("");
  return stream;
}

function makeRuntime(
  cwd: string,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): CliRuntime {
  return {
    cwd,
    env: {},
    stderr: captureWritable(),
    stdin,
    stdout,
  };
}
