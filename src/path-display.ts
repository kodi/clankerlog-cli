import { homedir } from "node:os";
import path from "node:path";

export function formatHomePath(filePath: string, homeDirectory = homedir()): string {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const relative = path.relative(homeDirectory, filePath);
  if (relative === "") {
    return "~";
  }

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }

  return `~/${relative.split(path.sep).join("/")}`;
}
