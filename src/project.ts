import { realpath } from "node:fs/promises";
import path from "node:path";
import type { AllowedProject, GlobalConfig, ProjectConfig } from "./schemas.js";

export async function resolveProjectPath(cwd: string): Promise<string> {
  return realpath(cwd);
}

export function findAllowedProject(
  config: GlobalConfig,
  projectPath: string,
): AllowedProject | undefined {
  return config.allowedProjects.find((project) => project.path === projectPath);
}

export function resolveTrackedProject(
  config: GlobalConfig,
  projectPath: string,
  projectConfig?: ProjectConfig | undefined,
): AllowedProject | undefined {
  const allowedProject = findAllowedProject(config, projectPath);
  if (allowedProject) {
    return allowedProject;
  }

  if (!config.autoTrackProjects) {
    return undefined;
  }

  return {
    displayName: projectConfig?.displayName ?? defaultDisplayName(projectPath),
    path: projectPath,
  };
}

export function isProjectAllowed(config: GlobalConfig, projectPath: string): boolean {
  return resolveTrackedProject(config, projectPath) !== undefined;
}

export function defaultDisplayName(projectPath: string): string {
  return path.basename(projectPath) || "project";
}

export function upsertAllowedProject(config: GlobalConfig, project: AllowedProject): GlobalConfig {
  const nextProjects = config.allowedProjects.filter(
    (allowedProject) => allowedProject.path !== project.path,
  );

  return {
    ...config,
    allowedProjects: [...nextProjects, project],
  };
}
