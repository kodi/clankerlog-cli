import { describe, expect, it } from "vitest";
import { redactApiKey } from "../src/redact.js";

describe("redactApiKey", () => {
  it("does not print missing keys as secrets", () => {
    expect(redactApiKey(undefined)).toBe("not configured");
  });

  it("redacts configured keys", () => {
    expect(redactApiKey("clk_live_abcdef_secret")).toBe("clk_live_abc...redacted");
  });
});
