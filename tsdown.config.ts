import { defineConfig } from "tsdown";

export default defineConfig({
  clean: ["bin"],
  dts: false,
  entry: {
    clankerlog: "src/cli.ts",
  },
  failOnWarn: true,
  fixedExtension: false,
  format: "esm",
  outDir: "bin",
  platform: "node",
  sourcemap: false,
  target: "node20",
});
