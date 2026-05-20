import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatHomePath } from "../src/path-display.js";

describe("path display", () => {
  it("shortens paths inside the home directory", () => {
    expect(
      formatHomePath(
        path.join("/Users", "dragan.bajcic", ".hermes", "config.yaml"),
        path.join("/Users", "dragan.bajcic"),
      ),
    ).toBe("~/.hermes/config.yaml");
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(formatHomePath("/tmp/clankerlog/config.json", "/Users/dragan.bajcic")).toBe(
      "/tmp/clankerlog/config.json",
    );
  });
});
