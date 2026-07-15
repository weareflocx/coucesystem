import embedModuleSource from "../cauce-embed.js?raw";

import { getOutputFormat } from "./formats";
import type { EngineState } from "./types";
import { createZip } from "./zip";
import { getProject } from "../projects";

const projectModuleSources = import.meta.glob("../projects/*.js", {
  eager: true,
  import: "default",
  query: "?raw"
}) as Record<string, string>;

interface EmbedConfigV1 {
  schemaVersion: 1;
  projectId: string;
  format: { width: number; height: number };
  seed: number;
  palette: EngineState["palette"];
  playback: {
    autoplay: boolean;
    speed: number;
    loopSeconds: number;
    startTime: number;
  };
  parameters: Record<string, number>;
  transparent: boolean;
  label: string;
}

export interface WebPackageResult {
  blob: Blob;
  filename: string;
  configFilename: string;
  snippet: string;
}

function createConfig(state: EngineState, time: number, transparent: boolean): EmbedConfigV1 {
  const project = getProject(state.projectId);
  const format = getOutputFormat(state.formatKey);
  return {
    schemaVersion: 1,
    projectId: project.id,
    format: { width: format.width, height: format.height },
    seed: state.seed,
    palette: structuredClone(state.palette),
    playback: {
      autoplay: true,
      speed: state.playback.speed,
      loopSeconds: state.playback.loopSeconds,
      startTime: Math.max(0, Math.min(0.999999, time))
    },
    parameters: structuredClone(state.parameters),
    transparent,
    label: `Cauce ${project.index} — ${project.name}`
  };
}

function createSnippet(configFilename: string, width: number, height: number): string {
  return `<cauce-flow src="./${configFilename}"></cauce-flow>\n<script type="module" src="./cauce-embed.js"></script>\n\n<style>\n  cauce-flow {\n    display: block;\n    width: 100%;\n    aspect-ratio: ${width} / ${height};\n  }\n</style>`;
}

function createExampleHtml(config: EmbedConfigV1, configFilename: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="data:,">
    <title>${config.label}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        display: grid;
        place-items: center;
        min-height: 100dvh;
        margin: 0;
        padding: 5vw;
        background: #171a1c;
      }
      cauce-flow {
        display: block;
        width: 100%;
        max-width: 1100px;
        aspect-ratio: ${config.format.width} / ${config.format.height};
      }
    </style>
  </head>
  <body>
    <cauce-flow src="./${configFilename}"></cauce-flow>
    <script type="module" src="./cauce-embed.js"></script>
  </body>
</html>`;
}

function createReadme(configFilename: string, snippet: string, usesThree: boolean): string {
  const vendorEntry = usesThree
    ? "- vendor/three.module.js y vendor/three.core.min.js: backend 3D local incluido en el paquete.\n"
    : "";
  return `# Cauce web embed

## Archivos

- cauce-embed.js: Web Component autónomo.
${vendorEntry}- projects/: renderers deterministas incluidos en el paquete.
- ${configFilename}: configuración editable de la pieza.
- index.html: integración mínima funcional.

## Integración

\`\`\`html
${snippet}
\`\`\`

Sirve los archivos mediante HTTP(S); fetch no puede cargar el JSON de forma fiable desde file://.

## API

\`document.querySelector("cauce-flow").play()\`
\`document.querySelector("cauce-flow").pause()\`
\`document.querySelector("cauce-flow").seek(0.5)\`

El valor de seek está normalizado entre 0 y 1. El componente emite los eventos
\`cauce-ready\` y \`cauce-error\`, se pausa fuera de pantalla y respeta
\`prefers-reduced-motion\`.
`;
}

function createProjectModuleEntries(): { name: string; contents: string }[] {
  return Object.entries(projectModuleSources)
    .map(([sourcePath, contents]) => ({
      name: `projects/${sourcePath.split("/").at(-1)}`,
      contents: contents.replace(
        /from\s+["']three["']/g,
        'from "../vendor/three.module.js"'
      ).replace(
        /import\(["']three["']\)/g,
        'import("../vendor/three.module.js")'
      )
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWebPackage(
  state: EngineState,
  time: number,
  transparent: boolean
): Promise<WebPackageResult> {
  const project = getProject(state.projectId);
  const format = getOutputFormat(state.formatKey);
  const config = createConfig(state, time, transparent);
  const configFilename = `cauce-${project.index}-${project.id}.json`;
  const snippet = createSnippet(configFilename, format.width, format.height);
  const configSource = `${JSON.stringify(config, null, 2)}\n`;
  const usesThree = project.backend === "three";
  const vendorEntries = usesThree
    ? await Promise.all([
      import("../../node_modules/three/build/three.module.min.js?raw"),
      import("../../node_modules/three/build/three.core.min.js?raw")
    ]).then(([threeModule, threeCore]) => [
      { name: "vendor/three.module.js", contents: threeModule.default },
      { name: "vendor/three.core.min.js", contents: threeCore.default }
    ])
    : [];
  const blob = createZip([
    { name: "cauce-embed.js", contents: embedModuleSource },
    ...vendorEntries,
    ...createProjectModuleEntries(),
    { name: configFilename, contents: configSource },
    { name: "index.html", contents: createExampleHtml(config, configFilename) },
    { name: "README.md", contents: createReadme(configFilename, snippet, usesThree) }
  ]);

  return {
    blob,
    filename: `cauce-${project.index}-${project.id}-${format.key}-web.zip`,
    configFilename,
    snippet
  };
}
