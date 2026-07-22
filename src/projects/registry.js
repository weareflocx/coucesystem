import { confluenceWeaveProject } from "./confluence-weave.js";
import { chromaticFluxProject } from "./chromatic-flux.js";
import { chromaticFluxWebGpuProject } from "./chromatic-flux-webgpu.js";
import { flowCompression2Project } from "./flow-compression-2.js";
import { flowCompressionProject } from "./flow-compression.js";
import { flowCauceProject } from "./flow-cauce.js";
import { fluidParticlesWebGpuProject } from "./fluid-particles-webgpu.js";
import { imageCurrentsProject } from "./image-currents.js";
import { mobiusFlowProject } from "./mobius-flow.js";
import { mobiusFlow11Project } from "./mobius-flow-1-1.js";
import { mobiusFlowDynamicsProject } from "./mobius-flow-dynamics.js";
import { orbitalBasinFlowProject } from "./orbital-basin-flow.js";
import { orbitalBasinProject } from "./orbital-basin.js";
import { scalarDriftProject } from "./scalar-drift.js";
import { tensionNetworkProject } from "./tension-network.js";
import { vectorCurrentsAdvectionProject } from "./vector-currents-advection.js";
import { vectorCurrentsProject } from "./vector-currents.js";

export const CAUCE_PROJECTS = [
  flowCompressionProject,
  flowCompression2Project,
  vectorCurrentsProject,
  vectorCurrentsAdvectionProject,
  scalarDriftProject,
  orbitalBasinProject,
  orbitalBasinFlowProject,
  mobiusFlowProject,
  mobiusFlow11Project,
  mobiusFlowDynamicsProject,
  confluenceWeaveProject,
  imageCurrentsProject,
  chromaticFluxProject,
  tensionNetworkProject,
  chromaticFluxWebGpuProject,
  fluidParticlesWebGpuProject,
  flowCauceProject
];
