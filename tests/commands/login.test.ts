import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleLogin } from "../../src/commands/login.js";
import { loadGlobalConfig } from "../../src/config.js";
import { createMemoryRuntime } from "../helpers.js";

describe("login command", () => {
  it("saves an API key and redacts output", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "config.json");
    const runtime = createMemoryRuntime({ configPath, cwd: root });

    await handleLogin({ apiKey: "clk_live_abcdef_secret" }, runtime);

    await expect(loadGlobalConfig(configPath)).resolves.toMatchObject({
      apiKey: "clk_live_abcdef_secret",
    });
    expect(runtime.stdoutText()).toContain("clk_live_abc...redacted");
    expect(runtime.stdoutText()).not.toContain("clk_live_abcdef_secret");
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "clankerlog-login-"));
}
