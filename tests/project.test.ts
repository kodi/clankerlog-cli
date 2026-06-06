import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultDisplayName,
  findAllowedProject,
  isProjectAllowed,
  resolveProjectPath,
  upsertAllowedProject,
} from "../src/project.js";
import type { GlobalConfig } from "../src/schemas.js";

describe("project allow-list", () => {
  it("resolves project paths through realpath", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clankerlog-project-"));
    const normalizedRoot = await realpath(root);

    await expect(resolveProjectPath(root)).resolves.toBe(normalizedRoot);
  });

  it("fails closed when the project is absent from config", () => {
    const config: GlobalConfig = { allowedProjects: [], autoTrackProjects: false };

    expect(isProjectAllowed(config, "/tmp/project")).toBe(false);
    expect(findAllowedProject(config, "/tmp/project")).toBeUndefined();
  });

  it("finds exact allow-list matches", () => {
    const config: GlobalConfig = {
      allowedProjects: [{ displayName: "CLI", path: "/tmp/project" }],
      autoTrackProjects: false,
    };

    expect(findAllowedProject(config, "/tmp/project")).toEqual({
      displayName: "CLI",
      path: "/tmp/project",
    });
    expect(isProjectAllowed(config, "/tmp/project/nested")).toBe(false);
  });

  it("upserts allowed projects by path", () => {
    const config = upsertAllowedProject(
      {
        allowedProjects: [{ displayName: "Old", path: "/tmp/project" }],
        autoTrackProjects: false,
      },
      { displayName: "New", path: "/tmp/project" },
    );

    expect(config.allowedProjects).toEqual([{ displayName: "New", path: "/tmp/project" }]);
  });

  it("uses folder basename as the default display name", () => {
    expect(defaultDisplayName("/tmp/clankerlog-cli")).toBe("clankerlog-cli");
  });

  it("allows any project when auto tracking is enabled", () => {
    const config: GlobalConfig = { allowedProjects: [], autoTrackProjects: true };

    expect(isProjectAllowed(config, "/tmp/project")).toBe(true);
    expect(findAllowedProject(config, "/tmp/project")).toBeUndefined();
  });
});
