import type { ProjectDefinition } from "../core/types";
import { CAUCE_PROJECTS } from "./registry.js";

export const PROJECTS: ProjectDefinition[] = CAUCE_PROJECTS;

export function getProject(projectId: string): ProjectDefinition {
  const compatibleProjectId = projectId === "mobius-flow-vector"
    ? "mobius-flow"
    : projectId;
  return PROJECTS.find((project) => project.id === compatibleProjectId) ?? PROJECTS[0]!;
}
