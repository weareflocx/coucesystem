const PROJECT_ID = "chromatic-fluid";
const MAX_PARTICLES = 8192 * 16;

async function createChromaticFluidRenderer(canvas, options) {
  const { createChromaticFluidRuntime } = await import("./chromatic-fluid/runtime.js");
  return createChromaticFluidRuntime(canvas, options);
}

export const chromaticFluidProject = /** @type {import("../core/types").ProjectDefinition} */ ({
  id: PROJECT_ID,
  index: "08.5",
  name: "Chromatic Fluid",
  label: "Cauce — Chromatic Fluid",
  description: "Una única simulación Cauce Fluid Engine con partículas opacas y color continuo derivado de densidad, movimiento, espacio y tiempo.",
  backend: /** @type {"webgpu"} */ ("webgpu"),
  appearanceCapabilities: {
    paint: true,
    gradientMapping: /** @type {Array<"surface">} */ (["surface"]),
    materials: /** @type {Array<"matte" | "satin" | "metal">} */ (["matte", "satin", "metal"])
  },
  preferredFps: 60,
  preferredFormatKey: "portrait",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  supportsUnboundedPreviewTime: true,
  viewControls: true,
  exportCapabilities: { svg: false, png: true, video: true, web: false },
  controls: [
    {
      key: "particleCount",
      label: "Partículas",
      min: 4096,
      max: MAX_PARTICLES,
      step: 4096,
      defaultValue: 32768,
      digits: 0,
      inspectorSection: "essential"
    },
    {
      key: "particleShape",
      label: "Forma",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      inspectorSection: "shape",
      options: [
        { value: 0, label: "Flow original", description: "Prisma redondeado alargado y orientado por velocidad." },
        { value: 1, label: "Esfera", description: "Volumen esférico fiel a Flow Cauce." }
      ]
    },
    { key: "particleSize", label: "Tamaño", min: 0.5, max: 2.4, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "shape" },
    { key: "flowLength", label: "Longitud", min: 0.6, max: 1.8, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "shape", visibleWhen: { key: "particleShape", equals: 0 } },
    {
      key: "colorBehavior",
      label: "Evolución del color",
      min: 0,
      max: 3,
      step: 1,
      defaultValue: 0,
      digits: 0,
      group: "color3d",
      options: [
        { value: 0, label: "Flujo continuo", description: "Recorre el gradiente mediante densidad, velocidad, posición y tiempo." },
        { value: 1, label: "Densidad", description: "Asigna el gradiente según la concentración física." },
        { value: 2, label: "Velocidad", description: "Asigna el gradiente según la rapidez de cada partícula." },
        { value: 3, label: "Flow HSV", description: "Recupera la evolución cromática procedural del Flow original." }
      ]
    },
    { key: "colorDrift", label: "Deriva cromática", min: 0, max: 0.16, step: 0.002, defaultValue: 0.045, digits: 3, group: "color3d" },
    { key: "noise", label: "Ruido de flujo", min: 0, max: 2, step: 0.01, defaultValue: 0.85, digits: 2, inspectorSection: "motion" },
    { key: "simulationSpeed", label: "Velocidad física", min: 0.1, max: 2, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "motion" },
    {
      key: "gravityMode",
      label: "Gravedad",
      min: 0,
      max: 2,
      step: 1,
      defaultValue: 2,
      digits: 0,
      inspectorSection: "motion",
      options: [
        { value: 0, label: "Fondo", description: "Empuja el volumen hacia el fondo del dominio." },
        { value: 1, label: "Abajo", description: "Hace caer el fluido dentro del contenedor físico." },
        { value: 2, label: "Centro", description: "Mantiene una nube cromática radial." }
      ]
    },
    { key: "density", label: "Densidad", min: 0.4, max: 2, step: 0.01, defaultValue: 0.9, digits: 2, inspectorSection: "shape" },
    {
      key: "surfaceModel",
      label: "Superficie física",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      advanced: true,
      options: [
        { value: 0, label: "MLS-MPM", description: "Cinco pasos del solver base compartido." },
        { value: 1, label: "Cohesiva CSF", description: "Añade cohesión y tensión superficial sobre la misma simulación." }
      ]
    },
    { key: "cohesion", label: "Cohesión", min: 0, max: 2, step: 0.01, defaultValue: 0.35, digits: 2, advanced: true, visibleWhen: { key: "surfaceModel", equals: 1 } },
    { key: "surfaceTension", label: "Tensión superficial", min: 0, max: 2, step: 0.01, defaultValue: 0.65, digits: 2, advanced: true, visibleWhen: { key: "surfaceModel", equals: 1 } },
    { key: "fov", label: "Campo de visión", min: 30, max: 75, step: 1, defaultValue: 48, digits: 0, suffix: "°", group: "camera" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 0.75, max: 2.8, step: 0.01, defaultValue: 1.45, digits: 2, group: "camera" }
  ],
  defaults: {
    particleCount: 32768,
    particleShape: 0,
    particleSize: 1,
    flowLength: 1,
    colorBehavior: 0,
    colorDrift: 0.045,
    noise: 0.85,
    simulationSpeed: 1,
    gravityMode: 2,
    density: 0.9,
    surfaceModel: 0,
    cohesion: 0.35,
    surfaceTension: 0.65,
    fov: 48,
    cameraDistance: 1.45
  },
  createRenderer: createChromaticFluidRenderer
});
