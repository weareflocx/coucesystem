import { confluenceWeaveProject } from "./confluence-weave.js";
import { flowCompressionProject } from "./flow-compression.js";
import { mobiusFlowProject } from "./mobius-flow.js";
import { orbitalBasinProject } from "./orbital-basin.js";
import { scalarDriftProject } from "./scalar-drift.js";
import { vectorCurrentsProject } from "./vector-currents.js";

export const CAUCE_PROJECTS = [
  flowCompressionProject,
  vectorCurrentsProject,
  scalarDriftProject,
  orbitalBasinProject,
  mobiusFlowProject,
  confluenceWeaveProject
];
