import { describe, expect, it } from "vitest";
import {
  clankPayloadSchema,
  globalConfigSchema,
  ingestionSuccessSchema,
  projectConfigSchema,
} from "../src/schemas.js";

describe("schemas", () => {
  it("parses valid global config", () => {
    expect(
      globalConfigSchema.parse({
        allowedProjects: [{ displayName: "CLI", path: "/tmp/project" }],
        apiKey: "clk_live_test_secret",
      }),
    ).toEqual({
      allowedProjects: [{ displayName: "CLI", path: "/tmp/project" }],
      apiKey: "clk_live_test_secret",
    });
  });

  it("rejects invalid stack tags", () => {
    expect(() => projectConfigSchema.parse({ stack: ["TypeScript"] })).toThrow();
  });

  it("parses a valid clank payload", () => {
    expect(
      clankPayloadSchema.parse({
        agent: "codex",
        model: "gpt-5.5",
        project: { display_name: "clankerlog-cli" },
        stack: ["typescript", "pnpm"],
        timestamp: "2026-05-17T20:22:00Z",
        type: "clank",
      }),
    ).toMatchObject({ type: "clank" });
  });

  it("requires timestamp offsets", () => {
    expect(() =>
      clankPayloadSchema.parse({
        agent: "codex",
        model: "gpt-5.5",
        project: { display_name: "clankerlog-cli" },
        stack: [],
        timestamp: "2026-05-17T20:22:00",
        type: "clank",
      }),
    ).toThrow();
  });

  it("parses successful ingestion responses", () => {
    expect(ingestionSuccessSchema.parse({ id: "clank_123", ok: true })).toEqual({
      id: "clank_123",
      ok: true,
    });
  });
});
