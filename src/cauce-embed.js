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
  return project.toSvg(frame);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
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

  for (const [key, fallback] of Object.entries(project.defaults)) {
    parameters[key] = finiteNumber(suppliedParameters[key], fallback);
  }

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
      loopSeconds: clamp(finiteNumber(playback.loopSeconds, 8), 0.1, 3600),
      startTime: positiveModulo(finiteNumber(playback.startTime, 0), 1)
    },
    parameters,
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
          this._time = positiveModulo(
            this._time + delta * this._config.playback.speed / this._config.playback.loopSeconds,
            1
          );
        }
        this._lastTimestamp = timestamp;
        this._render();
        this._frameRequest = window.requestAnimationFrame(this._tick);
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
      this._time = positiveModulo(finiteNumber(time, 0), 1);
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
        const ready = await this._setupBackend(CAUCE_RENDERERS[config.projectId], token);
        if (!ready || token !== this._applyToken) return;
        this._config = config;
        this._time = this._config.playback.startTime;
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

    async _setupBackend(project, token) {
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
        const renderer = await project.createRenderer(this._canvas);
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
          seed: this._config.seed,
          palette: this._config.palette,
          view: this._config.view,
          parameters: this._config.parameters,
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
        seed: this._config.seed,
        palette: this._config.palette,
        view: this._config.view,
        parameters: this._config.parameters,
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
