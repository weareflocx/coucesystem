const PROJECT_ID = "flow-cauce";
const MAX_PARTICLES = 8192 * 16;
const DEFAULT_LIGHTING = /** @type {import("../core/types").LightingRigState} */ ({
  environment: {
    enabled: true,
    intensity: 0.5,
    rotation: -123.2
  },
  ambient: {
    enabled: false,
    type: "hemisphere",
    color: "#ffffff",
    groundColor: "#111518",
    intensity: 0.6
  },
  lights: [{
    id: "flow-key",
    name: "Key Light",
    type: "spot",
    enabled: true,
    solo: false,
    colorSource: "custom",
    color: "#ffffff",
    intensity: 5,
    position: { x: 0, y: 1.2, z: -0.8 },
    target: { x: 0, y: 0.7, z: 0 },
    distance: 15,
    angle: 32.4,
    penumbra: 1,
    width: 1.4,
    height: 1.4,
    castShadow: true,
    shadowMapSize: 1024
  }]
});

const TERRAIN_LIGHTING = /** @type {import("../core/types").LightingRigState} */ ({
  environment: {
    enabled: true,
    intensity: 0.75,
    rotation: -82
  },
  ambient: {
    enabled: false,
    type: "hemisphere",
    color: "#ffffff",
    groundColor: "#201919",
    intensity: 0.4
  },
  lights: [{
    id: "terrain-sun",
    name: "Terrain Sun",
    type: "directional",
    enabled: true,
    solo: false,
    colorSource: "custom",
    color: "#ffffff",
    intensity: 2,
    position: { x: 2.4, y: 2.8, z: -1.6 },
    target: { x: 0, y: 0.5, z: 0.2 },
    distance: 12,
    angle: 35,
    penumbra: 1,
    width: 2,
    height: 2,
    castShadow: true,
    shadowMapSize: 1024
  }]
});

async function createFlowCauceRenderer(canvas, options) {
  const { createFlowCauceRuntime } = await import("./flow-cauce/runtime.js");
  return createFlowCauceRuntime(canvas, options);
}

export const flowCauceProject = {
  id: PROJECT_ID,
  index: "08.4",
  name: "Flow Cauce",
  label: "Cauce — Flow Cauce",
  description: "Evolución Cauce de holtsetio/flow: MLS-MPM WebGPU, partículas orientadas por velocidad, materiales PBR, densidad visible e interacción espacial.",
  backend: /** @type {"webgpu"} */ ("webgpu"),
  appearanceCapabilities: {
    paint: true,
    gradientMapping: /** @type {Array<"screen" | "surface">} */ (["surface"]),
    materials: /** @type {Array<"matte" | "satin" | "metal" | "glass">} */ (["matte", "satin", "metal", "glass"]),
    proceduralTextures: /** @type {Array<"flow" | "grain" | "mineral">} */ (["flow", "grain", "mineral"])
  },
  preferredFps: 60,
  preferredFormatKey: "portrait",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  supportsUnboundedPreviewTime: true,
  viewControls: true,
  spatialLightControls: true,
  defaultLighting: DEFAULT_LIGHTING,
  lightingPresets: [
    {
      key: "flow-original",
      label: "Flow original",
      description: "Foco frontal, reflejos contenidos y sombras del look original.",
      lighting: DEFAULT_LIGHTING
    },
    {
      key: "terrain-studio",
      label: "Terrain studio",
      description: "Luz direccional amplia, sombra mate y entorno rotado como en la referencia TSL.",
      lighting: TERRAIN_LIGHTING
    }
  ],
  exportCapabilities: { svg: false, png: true, video: true, web: false },
  controls: [
    {
      key: "particleCount",
      label: "Partículas",
      min: 4096,
      max: MAX_PARTICLES,
      step: 4096,
      defaultValue: 32768,
      digits: 0
    },
    {
      key: "particleShape",
      label: "Forma de partícula",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 1,
      digits: 0,
      options: [
        { value: 0, label: "Flow original", description: "Prisma redondeado alargado y orientado por velocidad." },
        { value: 1, label: "Esfera", description: "Partícula redonda tridimensional que conserva densidad, color y sombras." }
      ]
    },
    { key: "particleSize", label: "Tamaño", min: 0.5, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "flowLength", label: "Longitud", min: 0.6, max: 1.8, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "noise", label: "Ruido de flujo", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "simulationSpeed", label: "Velocidad física", min: 0.1, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    {
      key: "gravityMode",
      label: "Gravedad",
      min: 0,
      max: 2,
      step: 1,
      defaultValue: 0,
      digits: 0,
      options: [
        { value: 0, label: "Fondo", description: "Empuja suavemente el fluido hacia el fondo como en Flow." },
        { value: 1, label: "Abajo", description: "Convierte el volumen en una caída contenida." },
        { value: 2, label: "Centro", description: "Gravedad radial hacia el centro del dominio." }
      ]
    },
    { key: "density", label: "Densidad", min: 0.4, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "interactionStrength", label: "Interacción", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    {
      key: "surfaceModel",
      label: "Superficie física",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      options: [
        { value: 0, label: "Flow original", description: "Conserva los cinco pasos MLS-MPM sin fuerzas capilares adicionales." },
        { value: 1, label: "Cohesiva CSF", description: "Añade masa suavizada, normal y curvatura sobre la rejilla para mantener el líquido unido." }
      ]
    },
    { key: "cohesion", label: "Cohesión", min: 0, max: 2, step: 0.01, defaultValue: 0.35, digits: 2, visibleWhen: { key: "surfaceModel", equals: 1 } },
    { key: "surfaceTension", label: "Tensión superficial", min: 0, max: 2, step: 0.01, defaultValue: 0.65, digits: 2, visibleWhen: { key: "surfaceModel", equals: 1 } },
    {
      key: "backgroundMode",
      label: "Fondo",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      options: [
        { value: 0, label: "Color Cauce", description: "Usa el color de Fondo editable en el panel Color." },
        { value: 1, label: "HDRI original", description: "Muestra la fotografía de entorno sin cambiar sus reflejos." }
      ]
    },
    {
      key: "roomVisible",
      label: "Sala",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      options: [
        { value: 0, label: "Invisible", description: "Oculta la caja decorativa sin modificar las paredes físicas." },
        { value: 1, label: "Visible", description: "Recupera la sala de hormigón de la referencia original." }
      ]
    },
    {
      key: "colorMode",
      label: "Color",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      group: "color3d",
      options: [
        { value: 0, label: "Flow HSV", description: "Color original derivado de densidad, velocidad, tiempo e interacción." },
        { value: 1, label: "Paleta Cauce", description: "Aplica los colores persistentes sin modificar la simulación." }
      ]
    },
    {
      key: "materialMode",
      label: "Material",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      group: "color3d",
      options: [
        { value: 0, label: "Flow original", description: "Conserva el acabado metálico y el color dinámico actual." },
        { value: 1, label: "Mineral procedural", description: "Ruido espacial mate inspirado en Procedural Terrain. Combínalo con el preset de luz Terrain studio." }
      ]
    },
    { key: "mineralScale", label: "Escala mineral", min: 0.01, max: 0.3, step: 0.005, defaultValue: 0.075, digits: 3, group: "color3d" },
    { key: "mineralWarp", label: "Deformación mineral", min: 0, max: 2, step: 0.01, defaultValue: 0.65, digits: 2, group: "color3d" },
    { key: "mineralContrast", label: "Contraste mineral", min: 0.5, max: 3, step: 0.01, defaultValue: 1.35, digits: 2, group: "color3d" },
    { key: "mineralVariation", label: "Variación de superficie", min: 0, max: 0.5, step: 0.01, defaultValue: 0.22, digits: 2, group: "color3d" },
    { key: "paletteMix", label: "Mezcla de paleta", min: 0, max: 1, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" },
    { key: "hueSpeed", label: "Deriva cromática", min: 0, max: 0.16, step: 0.002, defaultValue: 0.05, digits: 3, group: "color3d" },
    { key: "metalness", label: "Metal", min: 0, max: 1, step: 0.01, defaultValue: 0.9, digits: 2, group: "color3d" },
    { key: "roughness", label: "Rugosidad", min: 0.05, max: 1, step: 0.01, defaultValue: 0.5, digits: 2, group: "color3d" },
    { key: "exposure", label: "Exposición", min: 0.2, max: 1.5, step: 0.01, defaultValue: 0.66, digits: 2, group: "color3d" },
    { key: "fov", label: "Campo de visión", min: 35, max: 80, step: 1, defaultValue: 60, digits: 0, suffix: "°", group: "camera" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 0.65, max: 2.4, step: 0.01, defaultValue: 1.2, digits: 2, group: "camera" }
  ],
  defaults: {
    particleCount: 32768,
    particleShape: 1,
    particleSize: 1,
    flowLength: 1,
    noise: 1,
    simulationSpeed: 1,
    gravityMode: 0,
    density: 1,
    interactionStrength: 1,
    surfaceModel: 0,
    cohesion: 0.35,
    surfaceTension: 0.65,
    backgroundMode: 0,
    roomVisible: 0,
    colorMode: 0,
    materialMode: 0,
    mineralScale: 0.075,
    mineralWarp: 0.65,
    mineralContrast: 1.35,
    mineralVariation: 0.22,
    paletteMix: 1,
    hueSpeed: 0.05,
    metalness: 0.9,
    roughness: 0.5,
    exposure: 0.66,
    fov: 60,
    cameraDistance: 1.2
  },
  createRenderer: createFlowCauceRenderer
};
