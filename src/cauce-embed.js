import { clamp, positiveModulo } from "./projects/shared.js";
import { CAUCE_PROJECTS } from "./projects/registry.js";

export { CAUCE_PROJECTS };

export const CAUCE_RENDERERS = Object.fromEntries(
  CAUCE_PROJECTS.map((project) => [project.id, project])
);

export function renderCauceProject(projectId, context, frame) {
  const project = CAUCE_RENDERERS[projectId];
  if (!project) throw new Error(`Proyecto Cauce desconocido: ${projectId}.`);
  if (!project.render) throw new Error(`El proyecto ${projectId} requiere un renderer administrado.`);
  project.render(context, frame);
}

export function cauceProjectToSvg(projectId, frame) {
  const project = CAUCE_RENDERERS[projectId];
  if (!project) throw new Error(`Proyecto Cauce desconocido: ${projectId}.`);
  if (!project.toSvg || project.exportCapabilities?.svg === false) {
    throw new Error(`${project.index} · ${project.name} no ofrece exportación SVG.`);
  }
  return project.toSvg(frame);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeLighting(value, fallback, legacyParameters = {}) {
  if (!fallback) return null;
  const source = value && typeof value === "object" ? value : fallback;
  const environment = source.environment && typeof source.environment === "object"
    ? source.environment
    : fallback.environment;
  const ambient = source.ambient && typeof source.ambient === "object"
    ? source.ambient
    : fallback.ambient;
  const fallbackLight = fallback.lights[0];
  const usesLegacyLight = !(value && typeof value === "object" && Array.isArray(value.lights));
  const sourceLights = usesLegacyLight
    ? [{
        ...fallbackLight,
        position: {
          x: finiteNumber(legacyParameters.lightX, fallbackLight.position.x),
          y: finiteNumber(legacyParameters.lightY, fallbackLight.position.y),
          z: finiteNumber(legacyParameters.lightZ, fallbackLight.position.z)
        },
        target: {
          x: finiteNumber(legacyParameters.lightTargetX, fallbackLight.target.x),
          y: finiteNumber(legacyParameters.lightTargetY, fallbackLight.target.y),
          z: finiteNumber(legacyParameters.lightTargetZ, fallbackLight.target.z)
        },
        intensity: finiteNumber(legacyParameters.lightIntensity, fallbackLight.intensity),
        angle: finiteNumber(legacyParameters.lightAngle, fallbackLight.angle),
        penumbra: finiteNumber(legacyParameters.lightPenumbra, fallbackLight.penumbra),
        castShadow: finiteNumber(legacyParameters.lightShadows, fallbackLight.castShadow ? 1 : 0) >= 0.5
      }]
    : value.lights.slice(0, 6);
  const allowedTypes = new Set(["spot", "point", "directional", "rect-area"]);
  const allowedSources = new Set(["custom", "foreground", "accent", "secondary"]);
  const normalizeVector = (candidate, defaultVector, minimum, maximum) => ({
    x: clamp(finiteNumber(candidate?.x, defaultVector.x), minimum, maximum),
    y: clamp(finiteNumber(candidate?.y, defaultVector.y), minimum, maximum),
    z: clamp(finiteNumber(candidate?.z, defaultVector.z), minimum, maximum)
  });
  const lights = sourceLights.map((candidate, index) => {
    const defaultLight = fallback.lights[index] ?? {
      ...fallbackLight,
      id: `light-${index + 1}`,
      name: `Luz ${index + 1}`,
      castShadow: false
    };
    return {
      id: typeof candidate?.id === "string" && candidate.id ? candidate.id.slice(0, 80) : defaultLight.id,
      name: typeof candidate?.name === "string" && candidate.name ? candidate.name.slice(0, 48) : defaultLight.name,
      type: allowedTypes.has(candidate?.type) ? candidate.type : defaultLight.type,
      enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : defaultLight.enabled,
      solo: typeof candidate?.solo === "boolean" ? candidate.solo : false,
      colorSource: allowedSources.has(candidate?.colorSource) ? candidate.colorSource : defaultLight.colorSource,
      color: typeof candidate?.color === "string" ? candidate.color : defaultLight.color,
      intensity: clamp(finiteNumber(candidate?.intensity, defaultLight.intensity), 0, 24),
      position: normalizeVector(candidate?.position, defaultLight.position, -4, 4),
      target: normalizeVector(candidate?.target, defaultLight.target, -3, 3),
      distance: clamp(finiteNumber(candidate?.distance, defaultLight.distance), 0.1, 30),
      angle: clamp(finiteNumber(candidate?.angle, defaultLight.angle), 5, 89),
      penumbra: clamp(finiteNumber(candidate?.penumbra, defaultLight.penumbra), 0, 1),
      width: clamp(finiteNumber(candidate?.width, defaultLight.width), 0.1, 8),
      height: clamp(finiteNumber(candidate?.height, defaultLight.height), 0.1, 8),
      castShadow: typeof candidate?.castShadow === "boolean" ? candidate.castShadow : defaultLight.castShadow,
      shadowMapSize: [256, 512, 1024].includes(candidate?.shadowMapSize)
        ? candidate.shadowMapSize
        : defaultLight.shadowMapSize
    };
  });
  const ambientType = ["none", "ambient", "hemisphere"].includes(ambient.type)
    ? ambient.type
    : fallback.ambient.type;
  return {
    environment: {
      enabled: typeof environment.enabled === "boolean" ? environment.enabled : fallback.environment.enabled,
      intensity: clamp(finiteNumber(environment.intensity, fallback.environment.intensity), 0, 3),
      rotation: clamp(finiteNumber(environment.rotation, fallback.environment.rotation), -180, 180)
    },
    ambient: {
      enabled: typeof ambient.enabled === "boolean" ? ambient.enabled : fallback.ambient.enabled,
      type: ambientType,
      color: typeof ambient.color === "string" ? ambient.color : fallback.ambient.color,
      groundColor: typeof ambient.groundColor === "string" ? ambient.groundColor : fallback.ambient.groundColor,
      intensity: clamp(finiteNumber(ambient.intensity, fallback.ambient.intensity), 0, 5)
    },
    lights
  };
}

function usesUnboundedPreviewTime(project) {
  return project?.supportsUnboundedPreviewTime === true;
}

function normalizeConfig(value) {
  if (!value || typeof value !== "object") throw new Error("La configuración de Cauce no es válida.");
  if (value.schemaVersion !== 1) throw new Error("Versión de configuración Cauce no compatible.");
  const suppliedProjectId = typeof value.projectId === "string" ? value.projectId : "";
  const projectId = suppliedProjectId === "flow-advection"
    ? "vector-currents"
    : suppliedProjectId;
  const project = CAUCE_RENDERERS[projectId];
  if (!project) throw new Error(`Proyecto Cauce desconocido: ${projectId || "sin identificador"}.`);

  const format = value.format && typeof value.format === "object" ? value.format : {};
  const palette = value.palette && typeof value.palette === "object" ? value.palette : {};
  const view = value.view && typeof value.view === "object" ? value.view : {};
  const playback = value.playback && typeof value.playback === "object" ? value.playback : {};
  const suppliedParameters = value.parameters && typeof value.parameters === "object"
    ? value.parameters
    : {};
  const parameters = {};
  const playbackMode = project.supportsLoopTime === false || playback.mode === "continuous"
    ? "continuous"
    : "loop";

  for (const control of project.controls) {
    parameters[control.key] = clamp(
      finiteNumber(suppliedParameters[control.key], control.defaultValue),
      control.min,
      control.max
    );
  }

  const loopSeconds = clamp(finiteNumber(playback.loopSeconds, 8), 0.1, 3600);
  const startTime = playbackMode === "continuous"
    ? clamp(finiteNumber(playback.startTime, 0), 0, 0.999999)
    : positiveModulo(finiteNumber(playback.startTime, 0), 1);

  return {
    schemaVersion: 1,
    projectId,
    format: {
      width: Math.round(clamp(finiteNumber(format.width, 1600), 1, 8192)),
      height: Math.round(clamp(finiteNumber(format.height, 900), 1, 8192))
    },
    seed: Math.round(clamp(finiteNumber(value.seed, 0), 0, 4294967295)),
    palette: {
      background: typeof palette.background === "string" ? palette.background : "#11110f",
      foreground: typeof palette.foreground === "string" ? palette.foreground : "#f4f3ee",
      accent: typeof palette.accent === "string"
        ? palette.accent
        : (typeof palette.foreground === "string" ? palette.foreground : "#f4f3ee"),
      secondary: typeof palette.secondary === "string"
        ? palette.secondary
        : (typeof palette.accent === "string" ? palette.accent : "#aeb7ff")
    },
    appearance: value.appearance && typeof value.appearance === "object"
      ? structuredClone(value.appearance)
      : undefined,
    view: {
      zoom: clamp(finiteNumber(view.zoom, 1), 0.35, 4),
      panX: clamp(finiteNumber(view.panX, 0), -1, 1),
      panY: clamp(finiteNumber(view.panY, 0), -1, 1),
      orbitYaw: clamp(finiteNumber(view.orbitYaw, 0), -180, 180),
      orbitPitch: clamp(finiteNumber(view.orbitPitch, 0), -80, 80)
    },
    playback: {
      autoplay: playback.autoplay !== false,
      speed: clamp(finiteNumber(playback.speed, 1), 0.01, 8),
      loopSeconds,
      startTime,
      startElapsedTime: usesUnboundedPreviewTime(project)
        ? Math.max(0, finiteNumber(playback.startElapsedTime, startTime * loopSeconds))
        : startTime * loopSeconds,
      mode: playbackMode
    },
    parameters,
    lighting: normalizeLighting(value.lighting, project.defaultLighting, suppliedParameters),
    transparent: value.transparent === true,
    label: typeof value.label === "string" && value.label.trim()
      ? value.label.trim()
      : project.label
  };
}

if (
  typeof window !== "undefined" &&
  typeof HTMLElement !== "undefined" &&
  !window.customElements.get("cauce-flow")
) {
  class CauceFlowElement extends HTMLElement {
    static observedAttributes = ["src"];

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host {
            display: block;
            position: relative;
            overflow: hidden;
            aspect-ratio: var(--cauce-aspect, 16 / 9);
            contain: layout paint;
          }
          canvas {
            display: block;
            width: 100%;
            height: 100%;
          }
          [part="error"] {
            position: absolute;
            inset: 0;
            display: grid;
            place-items: center;
            margin: 0;
            padding: 1rem;
            background: #11110f;
            color: #f4f3ee;
            font: 12px/1.5 ui-monospace, monospace;
            text-align: center;
          }
          [part="error"][hidden] { display: none; }
        </style>
        <canvas part="canvas" role="img"></canvas>
        <p part="error" role="alert" hidden></p>
      `;
      this._canvas = root.querySelector("canvas");
      this._error = root.querySelector("[part='error']");
      this._context = null;
      this._renderer = null;
      this._backendProjectId = "";
      this._config = null;
      this._time = 0;
      this._elapsedSeconds = 0;
      this._playing = false;
      this._visible = true;
      this._connected = false;
      this._frameRequest = 0;
      this._lastTimestamp = null;
      this._loadToken = 0;
      this._applyToken = 0;
      this._resizeObserver = null;
      this._intersectionObserver = null;
      this._reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this._onVisibilityChange = () => this._updateLoop();
      this._onReducedMotionChange = (event) => {
        if (event.matches) this.pause();
      };
      this._tick = (timestamp) => {
        this._frameRequest = 0;
        if (!this._canAnimate()) return;
        if (this._lastTimestamp !== null && this._config) {
          const delta = Math.min(0.1, Math.max(0, (timestamp - this._lastTimestamp) / 1000));
          const elapsedDelta = delta * this._config.playback.speed;
          const project = CAUCE_RENDERERS[this._config.projectId];
          if (usesUnboundedPreviewTime(project)) {
            this._elapsedSeconds += elapsedDelta;
            this._time = positiveModulo(
              this._elapsedSeconds / this._config.playback.loopSeconds,
              1
            );
          } else {
            const nextTime = this._time + elapsedDelta / this._config.playback.loopSeconds;
            if (this._config.playback.mode === "continuous" && nextTime >= 1) {
              this._time = 0.999999;
              this._playing = false;
              this.dispatchEvent(new CustomEvent("cauce-ended"));
            } else {
              this._time = this._config.playback.mode === "loop"
                ? positiveModulo(nextTime, 1)
                : clamp(nextTime, 0, 0.999999);
            }
            this._elapsedSeconds = this._time * this._config.playback.loopSeconds;
          }
        }
        this._lastTimestamp = timestamp;
        this._render();
        if (this._canAnimate()) {
          this._frameRequest = window.requestAnimationFrame(this._tick);
        }
      };
    }

    connectedCallback() {
      if (this._connected) return;
      this._connected = true;
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this);
      this._intersectionObserver = new IntersectionObserver((entries) => {
        this._visible = entries.some((entry) => entry.isIntersecting);
        this._updateLoop();
      });
      this._intersectionObserver.observe(this);
      document.addEventListener("visibilitychange", this._onVisibilityChange);
      this._reducedMotion.addEventListener("change", this._onReducedMotionChange);

      if (this.hasAttribute("src")) {
        this._loadFromSource();
      } else if (this._config) {
        this._applyConfig(this._config);
      } else {
        this._showError("Falta la configuración: añade src o asigna la propiedad config.");
      }
    }

    disconnectedCallback() {
      this._connected = false;
      this._stopLoop();
      this._resizeObserver?.disconnect();
      this._intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._reducedMotion.removeEventListener("change", this._onReducedMotionChange);
      this._renderer?.dispose();
      this._renderer = null;
      this._backendProjectId = "";
      this._applyToken += 1;
    }

    attributeChangedCallback(name, previousValue, nextValue) {
      if (name === "src" && previousValue !== nextValue && this._connected) {
        this._loadFromSource();
      }
    }

    set config(value) {
      this._applyConfig(value);
    }

    get config() {
      return this._config ? JSON.parse(JSON.stringify(this._config)) : null;
    }

    play() {
      if (!this._config) return;
      const project = CAUCE_RENDERERS[this._config.projectId];
      if (
        !usesUnboundedPreviewTime(project) &&
        this._config.playback.mode === "continuous" &&
        this._time >= 0.999
      ) {
        this._time = 0;
        this._elapsedSeconds = 0;
      }
      this._playing = true;
      this._lastTimestamp = null;
      this._updateLoop();
    }

    pause() {
      this._playing = false;
      this._lastTimestamp = null;
      this._updateLoop();
    }

    seek(time) {
      const suppliedTime = finiteNumber(time, 0);
      this._time = this._config?.playback.mode === "continuous"
        ? clamp(suppliedTime, 0, 0.999999)
        : positiveModulo(suppliedTime, 1);
      this._elapsedSeconds = this._time * (this._config?.playback.loopSeconds ?? 1);
      this._lastTimestamp = null;
      this._render();
    }

    async _loadFromSource() {
      const source = this.getAttribute("src");
      if (!source) {
        this._showError("El atributo src está vacío.");
        return;
      }

      const token = ++this._loadToken;
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`No se pudo cargar ${source} (${response.status}).`);
        const config = await response.json();
        if (token === this._loadToken) await this._applyConfig(config);
      } catch (error) {
        if (token !== this._loadToken) return;
        const message = error instanceof Error ? error.message : "No se pudo cargar la configuración.";
        this._showError(message);
        this.dispatchEvent(new CustomEvent("cauce-error", { detail: { message } }));
      }
    }

    async _applyConfig(value) {
      const token = ++this._applyToken;
      this._stopLoop();
      try {
        const config = normalizeConfig(value);
        const ready = await this._setupBackend(CAUCE_RENDERERS[config.projectId], token, config);
        if (!ready || token !== this._applyToken) return;
        this._config = config;
        this._time = this._config.playback.startTime;
        this._elapsedSeconds = this._config.playback.startElapsedTime;
        if (usesUnboundedPreviewTime(CAUCE_RENDERERS[this._config.projectId])) {
          this._time = positiveModulo(
            this._elapsedSeconds / this._config.playback.loopSeconds,
            1
          );
        }
        this._playing = this._config.playback.autoplay && !this._reducedMotion.matches;
        this._lastTimestamp = null;
        this.style.setProperty(
          "--cauce-aspect",
          `${this._config.format.width} / ${this._config.format.height}`
        );
        this._canvas.setAttribute("aria-label", this.getAttribute("aria-label") || this._config.label);
        this._showError("");
        this._resize();
        this._render();
        this._updateLoop();
        this.dispatchEvent(new CustomEvent("cauce-ready", { detail: { config: this.config } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "La configuración de Cauce no es válida.";
        this._showError(message);
        this.dispatchEvent(new CustomEvent("cauce-error", { detail: { message } }));
      }
    }

    async _setupBackend(project, token, config) {
      if (this._backendProjectId === project.id) return true;
      this._renderer?.dispose();
      this._renderer = null;
      this._context = null;
      this._backendProjectId = "";

      const nextCanvas = document.createElement("canvas");
      nextCanvas.setAttribute("part", "canvas");
      nextCanvas.setAttribute("role", "img");
      this._canvas.replaceWith(nextCanvas);
      this._canvas = nextCanvas;

      if (project.createRenderer) {
        const renderer = await project.createRenderer(this._canvas, {
          initialParticleCount: Number(config.parameters.particleCount) || undefined,
          initialSeed: config.seed,
          initialParameters: { ...config.parameters }
        });
        if (token !== this._applyToken) {
          renderer.dispose();
          return false;
        }
        this._renderer = renderer;
      } else {
        this._context = this._canvas.getContext("2d", { alpha: true });
        if (!this._context) throw new Error("Canvas 2D no está disponible.");
      }
      this._backendProjectId = project.id;
      return true;
    }

    _resize() {
      if (!this._config) return;
      const bounds = this.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const ratio = clamp(window.devicePixelRatio || 1, 1, 2);
      if (this._renderer) {
        this._renderer.resize({
          width: bounds.width,
          height: bounds.height,
          pixelRatio: ratio,
          contentX: 0,
          contentY: 0,
          contentWidth: bounds.width,
          contentHeight: bounds.height,
          stageBackground: null
        });
        this._render();
        return;
      }
      const width = Math.max(1, Math.min(4096, Math.round(bounds.width * ratio)));
      const height = Math.max(1, Math.min(4096, Math.round(bounds.height * ratio)));
      if (this._canvas.width === width && this._canvas.height === height) return;
      this._canvas.width = width;
      this._canvas.height = height;
      this._render();
    }

    _render() {
      if (!this._config || this._canvas.width === 0 || this._canvas.height === 0) return;
      const project = CAUCE_RENDERERS[this._config.projectId];
      if (this._renderer) {
        this._renderer.render({
          width: this._config.format.width,
          height: this._config.format.height,
          time: this._time,
          elapsedTime: this._elapsedSeconds,
          timeMode: this._config.playback.mode,
          seed: this._config.seed,
          palette: this._config.palette,
          appearance: this._config.appearance,
          view: this._config.view,
          parameters: this._config.parameters,
          lighting: this._config.lighting,
          transparent: this._config.transparent
        });
        return;
      }
      if (!this._context || !project.render) return;
      this._context.setTransform(1, 0, 0, 1, 0, 0);
      this._context.globalAlpha = 1;
      this._context.clearRect(0, 0, this._canvas.width, this._canvas.height);
      project.render(this._context, {
        width: this._canvas.width,
        height: this._canvas.height,
        time: this._time,
        elapsedTime: this._elapsedSeconds,
        timeMode: this._config.playback.mode,
        seed: this._config.seed,
        palette: this._config.palette,
        appearance: this._config.appearance,
        view: this._config.view,
        parameters: this._config.parameters,
        lighting: this._config.lighting,
        transparent: this._config.transparent
      });
    }

    _showError(message) {
      this._error.textContent = message;
      this._error.hidden = message.length === 0;
    }

    _canAnimate() {
      return Boolean(
        this._connected &&
        this._config &&
        this._playing &&
        this._visible &&
        !document.hidden
      );
    }

    _stopLoop() {
      if (this._frameRequest) window.cancelAnimationFrame(this._frameRequest);
      this._frameRequest = 0;
      this._lastTimestamp = null;
    }

    _updateLoop() {
      this._stopLoop();
      if (this._canAnimate()) {
        this._frameRequest = window.requestAnimationFrame(this._tick);
      } else {
        this._render();
      }
    }
  }

  window.customElements.define("cauce-flow", CauceFlowElement);
}
