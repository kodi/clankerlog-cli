import { describe, expect, it } from "vitest";
import { normalizeModelName } from "../src/model.js";
import { clankPayloadSchema } from "../src/schemas.js";

describe("normalizeModelName", () => {
  it.each([
    ["gpt-5.5", "gpt-5.5"],
    ["gpt-5-5", "gpt-5.5"],
    ["gpt5.5", "gpt-5.5"],
    ["GPT 5 5", "gpt-5.5"],
    ["openai/gpt-5-5", "gpt-5.5"],
    ["gpt-5.5(low)", "gpt-5.5"],
    ["gpt-5.5(medium)", "gpt-5.5"],
    ["gpt-5.5(high)", "gpt-5.5"],
    ["gpt-5.5(xtrahigh)", "gpt-5.5"],
    ["gpt-5.5 (HIGH)", "gpt-5.5"],
    ["gpt5.5pro", "gpt-5.5-pro"],
    ["gpt-5-4-mini", "gpt-5.4-mini"],
    ["gpt 5.3 codex spark", "gpt-5.3-codex-spark"],
    ["gpt41", "gpt-4.1"],
    ["gpt-4-1-mini", "gpt-4.1-mini"],
    ["gpt 4o mini", "gpt-4o-mini"],
    ["o4 mini", "o4-mini"],
    ["o3mini", "o3-mini"],
    ["claude-opus-4-7", "claude-opus-4.7"],
    ["claude opus 4.7", "claude-opus-4.7"],
    ["opus4.7", "claude-opus-4.7"],
    ["anthropic/claude-opus-4-7", "claude-opus-4.7"],
    ["claude-sonnet-4-6", "claude-sonnet-4.6"],
    ["sonnet4.6", "claude-sonnet-4.6"],
    ["claude 3 7 sonnet", "claude-3.7-sonnet"],
    ["claude-3-5-sonnet", "claude-3.5-sonnet"],
    ["haiku3.5", "claude-3.5-haiku"],
    ["gemini-3-1-pro", "gemini-3.1-pro"],
    ["gemini pro 3.1", "gemini-3.1-pro"],
    ["google/gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
    ["openrouter/google/gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
    ["gemini 2.5 flash lite", "gemini-2.5-flash-lite"],
    ["deepseek r1", "deepseek-r1"],
    ["deepseek-v3-2", "deepseek-v3.2"],
    ["qwen3 coder", "qwen3-coder"],
    ["qwen3 235b a22b", "qwen3-235b-a22b"],
    ["grok fast 4", "grok-4-fast"],
    ["grok-3-mini", "grok-3-mini"],
    ["mistral large", "mistral-large"],
    ["magistral medium", "magistral-medium"],
    ["llama 4 maverick", "llama-4-maverick"],
    ["llama-3-3-70b-instruct", "llama-3.3-70b-instruct"],
    ["kimi k2", "kimi-k2"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeModelName(input)).toBe(expected);
  });

  it("passes through unknown model names after trimming", () => {
    expect(normalizeModelName("  future-provider/model-x-99  ")).toBe("future-provider/model-x-99");
    expect(normalizeModelName("  future-provider/model-x-99(low)  ")).toBe(
      "future-provider/model-x-99",
    );
  });

  it("does not guess from very different names", () => {
    expect(normalizeModelName("opus experimental")).toBe("opus experimental");
    expect(normalizeModelName("gpt-five-five")).toBe("gpt-five-five");
  });

  it("normalizes models when parsing clank payloads", () => {
    const payload = clankPayloadSchema.parse({
      agent: "codex",
      model: "gpt-5.5(low)",
      project: { display_name: "clankerlog-cli" },
      stack: [],
      timestamp: "2026-05-17T20:22:00Z",
      type: "clank",
    });

    expect(payload.model).toBe("gpt-5.5");
  });
});
