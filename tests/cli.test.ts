import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { buildProgram, isCliEntrypoint } from "../src/cli.js";

describe("cli entrypoint detection", () => {
  it("uses the package version for Commander --version output", () => {
    expect(buildProgram().version()).toBe(packageJson.version);
  });

  it("treats an npm-style symlink to the bin file as the CLI entrypoint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clankerlog-cli-entrypoint-"));
    const target = path.join(root, "lib", "node_modules", "clankerlog", "bin", "clankerlog.js");
    const link = path.join(root, "bin", "clankerlog");
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(path.dirname(link), { recursive: true });
    await writeFile(target, "");
    await symlink(target, link);

    await expect(
      isCliEntrypoint(pathToFileUrl(await realpath(target)), ["node", link]),
    ).resolves.toBe(true);
  });
});

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
