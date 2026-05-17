import { afterEach, describe, expect, it, vi } from "vitest";
import { sendClank } from "../src/ingest.js";
import type { ClankPayload } from "../src/schemas.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("sendClank", () => {
  it("posts one clank and parses a 202 response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "clank_123", ok: true }), { status: 202 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await sendClank({
      apiKey: "clk_live_test_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
      payload: payload(),
    });

    expect(result).toEqual({ ok: true, response: { id: "clank_123", ok: true } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ingest.dev.clankerlog.ai/v1/clanks",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer clk_live_test_secret",
          "Content-Type": "application/json",
        }),
        method: "POST",
      }),
    );
  });

  it("formats 400 errors", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Invalid clank payload", ok: false }), {
          status: 400,
          statusText: "Bad Request",
        }),
    ) as typeof fetch;

    const result = await sendClank({
      apiKey: "clk_live_test_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
      payload: payload(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        "Ingestion rejected the clank payload (400). Invalid clank payload",
      );
    }
  });

  it("formats 401 errors", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
    ) as typeof fetch;

    const result = await sendClank({
      apiKey: "bad",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
      payload: payload(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Authentication failed (401). Check your ClankerLog API key.");
    }
  });

  it("formats invalid JSON responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not json", { status: 202 })) as typeof fetch;

    const result = await sendClank({
      apiKey: "clk_live_test_secret",
      endpoint: "https://ingest.dev.clankerlog.ai/v1/clanks",
      payload: payload(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Ingestion API returned invalid JSON.");
    }
  });

  it("formats network failures", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const result = await sendClank({
      apiKey: "clk_live_test_secret",
      endpoint: "http://127.0.0.1:8787/v1/clanks",
      payload: payload(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Network error while contacting ClankerLog: ECONNREFUSED");
    }
  });
});

function payload(): ClankPayload {
  return {
    agent: "codex",
    model: "gpt-5.5",
    project: { display_name: "clankerlog-cli" },
    stack: ["typescript"],
    timestamp: "2026-05-17T20:22:00Z",
    type: "clank",
  };
}
