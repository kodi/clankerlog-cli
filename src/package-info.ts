import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
  name: string;
  version: string;
};

export function getPackageName(): string {
  return packageJson.name;
}

export function getPackageVersion(): string {
  return packageJson.version;
}
