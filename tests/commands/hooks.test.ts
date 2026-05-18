import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli.js";
import {
  buildHookCommand,
  getHookStatus,
  installHookConfig,
  planInstallHook,
  planUninstallHook,
  resolveHookConfigPath,
  uninstallHookConfig,
} from "../../src/hook-config.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hook config transforms", () => {
  it("creates a Codex Stop hook in an empty config", () => {
    const plan = planInstallHook({}, "codex");

    expect(plan.changed).toBe(true);
    expect(plan.command).toBe("CLANKERLOG_AGENT=codex clankerlog hook codex stop");
    expect(plan.config).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
                timeout: 10,
                statusMessage: "Sending ClankerLog clank",
              },
            ],
          },
        ],
      },
    });
  });

  it("creates a Claude Stop hook with the required model environment", () => {
    const plan = planInstallHook({}, "claude", { model: "claude-sonnet-4.5" });

    expect(plan.changed).toBe(true);
    expect(plan.command).toBe(
      "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
    );
    expect(plan.config).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
                timeout: 10,
                statusMessage: "Sending ClankerLog clank",
              },
            ],
          },
        ],
      },
    });
  });

  it("requires a Claude model when building the installed command", () => {
    expect(() => buildHookCommand("claude")).toThrow("requires --model");
  });

  it("creates a Cursor stop hook that reads the model from hook stdin", () => {
    const plan = planInstallHook({}, "cursor");

    expect(plan.changed).toBe(true);
    expect(plan.command).toBe("CLANKERLOG_AGENT=cursor clankerlog hook cursor stop");
    expect(plan.config).toEqual({
      hooks: {
        stop: [
          {
            command: "CLANKERLOG_AGENT=cursor clankerlog hook cursor stop",
          },
        ],
      },
    });
  });

  it("can pin a Cursor model through environment when requested", () => {
    expect(buildHookCommand("cursor", { model: "gpt-5.5" })).toBe(
      "CLANKERLOG_AGENT=cursor CLANKERLOG_MODEL='gpt-5.5' clankerlog hook cursor stop",
    );
  });

  it("preserves existing Stop hooks, non-Stop hooks, and unrelated settings", () => {
    const existingCommand = {
      type: "command",
      command: "echo existing",
      timeout: 2,
    };
    const config = {
      theme: "dark",
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "echo pre" }],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [existingCommand],
          },
        ],
      },
    };

    const plan = planInstallHook(config, "codex");

    expect(plan.config).toMatchObject({
      theme: "dark",
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "echo pre" }],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [existingCommand, expect.objectContaining({ command: plan.command })],
          },
        ],
      },
    });
    expect(config.hooks.Stop[0]?.hooks).toEqual([existingCommand]);
  });

  it("does not duplicate an existing ClankerLog hook", () => {
    const first = planInstallHook({}, "codex");
    const second = planInstallHook(first.config, "codex");

    expect(second.changed).toBe(false);
    expect(second.action).toBe("already-installed");
    expect(second.config).toEqual(first.config);
  });

  it("detects markerless Codex hooks by exact command and status message", () => {
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
                timeout: 10,
                statusMessage: "Sending ClankerLog clank",
              },
            ],
          },
        ],
      },
    };

    expect(getHookStatus(config, "codex")).toEqual({
      agent: "codex",
      command: "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
      commandMatchesExpected: true,
      installed: true,
    });
    expect(planInstallHook(config, "codex").changed).toBe(false);
  });

  it("removes only ClankerLog hooks and preserves empty containers", () => {
    const existingCommand = { type: "command", command: "echo existing" };
    const installed = planInstallHook(
      {
        hooks: {
          Stop: [
            {
              hooks: [existingCommand],
            },
          ],
        },
      },
      "codex",
    );

    const plan = planUninstallHook(installed.config, "codex");

    expect(plan.changed).toBe(true);
    expect(plan.config).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [existingCommand],
          },
        ],
      },
    });

    const emptyPlan = planUninstallHook(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "CLANKERLOG_AGENT=codex clankerlog hook codex stop",
                  timeout: 10,
                  statusMessage: "Sending ClankerLog clank",
                },
              ],
            },
          ],
        },
      },
      "codex",
    );

    expect(emptyPlan.config).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [],
          },
        ],
      },
    });
  });

  it("no-ops uninstall when ClankerLog is not installed", () => {
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo existing" }],
          },
        ],
      },
    };

    const plan = planUninstallHook(config, "codex");

    expect(plan.changed).toBe(false);
    expect(plan.action).toBe("not-installed");
    expect(plan.config).toBe(config);
  });

  it("removes only ClankerLog Cursor hooks and preserves neighboring hooks", () => {
    const installed = planInstallHook(
      {
        version: 1,
        hooks: {
          stop: [{ command: "echo existing" }],
        },
      },
      "cursor",
    );

    const plan = planUninstallHook(installed.config, "cursor");

    expect(plan.changed).toBe(true);
    expect(plan.config).toEqual({
      version: 1,
      hooks: {
        stop: [{ command: "echo existing" }],
      },
    });
  });

  it("reports status without mutating config", () => {
    const config = planInstallHook({}, "claude", { model: "claude-opus-4.5" }).config;

    expect(getHookStatus(config, "claude")).toEqual({
      agent: "claude",
      command:
        "CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-opus-4.5' clankerlog hook claude stop",
      commandMatchesExpected: true,
      installed: true,
    });
  });

  it("rejects unsupported hook config shapes", () => {
    expect(() => planInstallHook([], "codex")).toThrow("must be a JSON object");
    expect(() => planInstallHook({ hooks: [] }, "codex")).toThrow("`hooks` must be a JSON object");
    expect(() => planInstallHook({ hooks: { Stop: {} } }, "codex")).toThrow(
      "`hooks.Stop` must be an array",
    );
    expect(() => planInstallHook({ hooks: { Stop: [{}] } }, "codex")).toThrow(
      "`hooks.Stop[0].hooks` must be an array",
    );
    expect(() => planInstallHook({ hooks: { stop: {} } }, "cursor")).toThrow(
      "`hooks.stop` must be an array",
    );
  });
});

describe("hook config filesystem helpers", () => {
  it("resolves default config paths from the home directory", () => {
    const home = path.join("/", "tmp", "clankerlog-home");

    expect(resolveHookConfigPath("codex", { homeDirectory: home })).toBe(
      path.join(home, ".codex", "hooks.json"),
    );
    expect(resolveHookConfigPath("claude", { homeDirectory: home })).toBe(
      path.join(home, ".claude", "settings.json"),
    );
    expect(resolveHookConfigPath("cursor", { homeDirectory: home })).toBe(
      path.join(home, ".cursor", "hooks.json"),
    );
  });

  it("installs a missing Codex hook file with private parent directory creation", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");

    const plan = await installHookConfig("codex", { configPath });

    expect(plan.changed).toBe(true);
    expect(plan.willWrite).toBe(true);
    expect(plan.targetPath).toBe(configPath);
    expect(await readJson(configPath)).toEqual(plan.config);
  });

  it("supports install dry-runs without creating files", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".claude", "settings.json");

    const plan = await installHookConfig("claude", {
      configPath,
      dryRun: true,
      model: "claude-sonnet-4.5",
    });

    expect(plan.changed).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.willWrite).toBe(true);
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("installs idempotently through the filesystem helper", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");

    await installHookConfig("codex", { configPath });
    const second = await installHookConfig("codex", { configPath });

    expect(second.changed).toBe(false);
    expect(second.willWrite).toBe(false);
    expect(countClankerLogCommands(await readJson(configPath))).toBe(1);
  });

  it("uninstalls through the filesystem helper and preserves unrelated hooks", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        planInstallHook(
          {
            hooks: {
              Stop: [
                {
                  hooks: [{ type: "command", command: "echo existing" }],
                },
              ],
            },
          },
          "codex",
        ).config,
      )}\n`,
    );

    const plan = await uninstallHookConfig("codex", { configPath });

    expect(plan.changed).toBe(true);
    expect(await readJson(configPath)).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo existing" }],
          },
        ],
      },
    });
  });

  it("supports uninstall dry-runs without changing files", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    const installed = planInstallHook({}, "codex").config;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(installed, null, 2)}\n`);

    const plan = await uninstallHookConfig("codex", { configPath, dryRun: true });

    expect(plan.changed).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(await readJson(configPath)).toEqual(installed);
  });

  it("refuses malformed JSON without rewriting the file", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not json");

    await expect(installHookConfig("codex", { configPath })).rejects.toThrow("not valid JSON");
    await expect(readFile(configPath, "utf8")).resolves.toBe("{not json");
  });

  it("refuses unsupported hook shapes without rewriting the file", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ hooks: { Stop: {} } })}\n`);

    await expect(installHookConfig("codex", { configPath })).rejects.toThrow("unsupported");
    await expect(readJson(configPath)).resolves.toEqual({ hooks: { Stop: {} } });
  });
});

describe("hooks install command", () => {
  it("wires Codex install through Commander", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "install",
      "codex",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${configPath}`);
    expect(stdout.text()).toContain("Command: CLANKERLOG_AGENT=codex clankerlog hook codex stop");
    expect(stdout.text()).toContain("Action: installed");
    expect(stdout.text()).toContain("/hooks");
    expect(countClankerLogCommands(await readJson(configPath))).toBe(1);
  });

  it("wires Claude install dry-run through Commander", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".claude", "settings.json");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "install",
      "claude",
      "--hook-config",
      configPath,
      "--model",
      "claude-sonnet-4.5",
      "--dry-run",
    ]);

    expect(stdout.text()).toContain(`Target: ${configPath}`);
    expect(stdout.text()).toContain(
      "Command: CLANKERLOG_AGENT=claude CLANKERLOG_MODEL='claude-sonnet-4.5' clankerlog hook claude stop",
    );
    expect(stdout.text()).toContain("Action: would install");
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("prints a concise Claude model hint when model is missing", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".claude", "settings.json");
    const program = buildProgram();
    program.exitOverride();

    await expect(
      program.parseAsync([
        "node",
        "clankerlog",
        "hooks",
        "install",
        "claude",
        "--hook-config",
        configPath,
      ]),
    ).rejects.toThrow("claude-sonnet-4.5");
  });

  it("wires Cursor install through Commander", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".cursor", "hooks.json");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "install",
      "cursor",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${configPath}`);
    expect(stdout.text()).toContain("Command: CLANKERLOG_AGENT=cursor clankerlog hook cursor stop");
    expect(stdout.text()).toContain("Action: installed");
    expect(await readJson(configPath)).toEqual({
      hooks: {
        stop: [
          {
            command: "CLANKERLOG_AGENT=cursor clankerlog hook cursor stop",
          },
        ],
      },
    });
  });
});

describe("hooks status and uninstall commands", () => {
  it("reports installed status without running a hook simulation", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(planInstallHook({}, "codex").config, null, 2)}\n`,
    );
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "status",
      "codex",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain(`Target: ${configPath}`);
    expect(stdout.text()).toContain("Status: ClankerLog Codex Stop hook is installed.");
    expect(stdout.text()).toContain("Command matches expected: yes");
    expect(stdout.text()).not.toContain("dry-run");
  });

  it("reports when an installed command does not match the current expected command", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "clankerlog hook codex stop",
                    timeout: 10,
                    statusMessage: "Sending ClankerLog clank",
                    clankerlog: {
                      agent: "codex",
                      version: 1,
                    },
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "status",
      "codex",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain("Status: ClankerLog Codex Stop hook is installed.");
    expect(stdout.text()).toContain("Command matches expected: no");
  });

  it("wires uninstall through Commander and preserves neighboring hooks", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        planInstallHook(
          {
            hooks: {
              Stop: [
                {
                  hooks: [{ type: "command", command: "echo existing" }],
                },
              ],
            },
          },
          "codex",
        ).config,
        null,
        2,
      )}\n`,
    );
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "uninstall",
      "codex",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain("Action: removed");
    expect(await readJson(configPath)).toEqual({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo existing" }],
          },
        ],
      },
    });
  });

  it("wires uninstall dry-run through Commander without changing files", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".claude", "settings.json");
    const installed = planInstallHook({}, "claude", { model: "claude-opus-4.5" }).config;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(installed, null, 2)}\n`);
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "uninstall",
      "claude",
      "--hook-config",
      configPath,
      "--dry-run",
    ]);

    expect(stdout.text()).toContain("Action: would remove");
    expect(await readJson(configPath)).toEqual(installed);
  });

  it("reports uninstall no-ops cleanly", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".codex", "hooks.json");
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "uninstall",
      "codex",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain("is not installed");
  });

  it("reports and uninstalls Cursor hooks through Commander", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, ".cursor", "hooks.json");
    const installed = planInstallHook(
      {
        hooks: {
          stop: [{ command: "echo existing" }],
        },
      },
      "cursor",
    ).config;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(installed, null, 2)}\n`);
    const stdout = captureStdout();
    const program = buildProgram();
    program.exitOverride();

    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "status",
      "cursor",
      "--hook-config",
      configPath,
    ]);
    await program.parseAsync([
      "node",
      "clankerlog",
      "hooks",
      "uninstall",
      "cursor",
      "--hook-config",
      configPath,
    ]);

    expect(stdout.text()).toContain("Status: ClankerLog Cursor Stop hook is installed.");
    expect(stdout.text()).toContain("Command matches expected: yes");
    expect(stdout.text()).toContain("Action: removed");
    expect(await readJson(configPath)).toEqual({
      hooks: {
        stop: [{ command: "echo existing" }],
      },
    });
  });
});

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-hooks-"));
}

function countClankerLogCommands(config: unknown): number {
  const stop = (config as { hooks?: { Stop?: Array<{ hooks?: unknown[] }> } }).hooks?.Stop;
  return (
    stop
      ?.flatMap((group) => group.hooks ?? [])
      .filter((hook) => {
        const hookObject = hook as Record<string, unknown>;
        return (
          typeof hook === "object" &&
          hook !== null &&
          "command" in hook &&
          String(hookObject.command).includes("clankerlog hook codex stop")
        );
      }).length ?? 0
  );
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
