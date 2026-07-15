import type { ProjectDefinition } from "../core/types";
import { CAUCE_PROJECTS } from "./registry.js";

export const PROJECTS: ProjectDefinition[] = CAUCE_PROJECTS;

export function getProject(projectId: string): ProjectDefinition {
  return PROJECTS.find((project) => project.id === projectId) ?? PROJECTS[0]!;
}
