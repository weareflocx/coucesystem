import {
  createMobiusGeometry,
  mobiusFlowProject,
  mobiusGradientGeometry,
  mobiusOpacityForBin,
  mobiusTextureStroke,
  mobiusViewTransform
} from "./mobius-flow.js";
import {
  appearanceParameters,
  paletteGradientStops
} from "./shared.js";

const PROJECT_ID = "mobius-flow-vector";

function makePath(Two, parent, gradient) {
  const path = new Two.Path([], false, false, true);
  path.noFill();
  path.stroke = gradient;
  path.cap = "round";
  path.join = "round";
  path.automatic = false;
  parent.add(path);
  return path;
}

function fillPath(Two, path, segments) {
  const activeVertexCount = segments.length / 2;
  while (path.vertices.length < activeVertexCount) {
    path.vertices.push(new Two.Anchor());
  }

  let vertexIndex = 0;
  for (let index = 0; index < segments.length; index += 4) {
    const start = path.vertices[vertexIndex++];
    const end = path.vertices[vertexIndex++];
    start.set(segments[index], segments[index + 1]);
    end.set(segments[index + 2], segments[index + 3]);
    if (start.command !== Two.Commands.move) start.command = Two.Commands.move;
    if (end.command !== Two.Commands.line) end.command = Two.Commands.line;
  }

  for (let index = activeVertexCount; index < path.vertices.length; index += 1) {
    const anchor = path.vertices[index];
    if (anchor.command !== Two.Commands.move) anchor.command = Two.Commands.move;
  }
}

async function createMobiusVectorRenderer(canvas) {
  const { default: Two } = await import("two.js");
  const two = new Two({
    type: Two.Types.canvas,
    domElement: canvas,
    width: 1,
    height: 1,
    ratio: 1,
    autostart: false
  });

  const stageBackground = new Two.Rectangle(0, 0, 1, 1);
  stageBackground.noStroke();
  const content = new Two.Group();
  const contentBackground = new Two.Rectangle(0, 0, 1, 1);
  contentBackground.noStroke();
  const artwork = new Two.Group();
  artwork.strokeAttenuation = true;
  content.add(contentBackground, artwork);

  const stops = Array.from({ length: 17 }, (_, index) => (
    new Two.Stop(index / 16, "#f4f3ee")
  ));
  const gradient = new Two.LinearGradient(0, 0, 1, 1, stops);
  const pathPairs = Array.from({ length: 12 }, () => ({
    base: makePath(Two, artwork, gradient),
    texture: makePath(Two, artwork, gradient)
  }));

  two.scene.add(stageBackground, content);

  let viewport = {
    width: 1,
    height: 1,
    pixelRatio: 1,
    contentX: 0,
    contentY: 0,
    contentWidth: 1,
    contentHeight: 1,
    stageBackground: null
  };
  let disposed = false;
  let gradientTransformKey = "";

  function resize(nextViewport) {
    if (disposed) return;
    viewport = { ...nextViewport };
    if (
      two.renderer.width !== viewport.width ||
      two.renderer.height !== viewport.height ||
      two.renderer.ratio !== viewport.pixelRatio
    ) {
      two.renderer.setSize(viewport.width, viewport.height, viewport.pixelRatio);
    }
  }

  function render(frame) {
    if (disposed) return;
    const geometry = createMobiusGeometry(frame);
    const appearance = appearanceParameters(frame);
    const gradientVector = mobiusGradientGeometry(frame, appearance);
    const viewTransform = mobiusViewTransform(frame);
    const ramp = paletteGradientStops(frame, appearance);
    const texture = mobiusTextureStroke(frame, appearance, geometry.strokeWidth);
    const hasTexture = texture.pattern.length > 0;
    const baseOpacity = hasTexture
      ? 1 - appearance.textureStrength * 0.82
      : 1;

    stageBackground.visible = typeof viewport.stageBackground === "string";
    if (stageBackground.visible) {
      stageBackground.fill = viewport.stageBackground;
      stageBackground.translation.set(viewport.width * 0.5, viewport.height * 0.5);
      stageBackground.width = viewport.width;
      stageBackground.height = viewport.height;
    }

    content.translation.set(viewport.contentX, viewport.contentY);
    content.scale = viewport.contentWidth / Math.max(1, frame.width);
    artwork.translation.set(viewTransform.translateX, viewTransform.translateY);
    artwork.scale = viewTransform.zoom;
    contentBackground.visible = !frame.transparent;
    contentBackground.fill = frame.palette.background;
    contentBackground.translation.set(frame.width * 0.5, frame.height * 0.5);
    contentBackground.width = frame.width;
    contentBackground.height = frame.height;

    const nextGradientTransformKey = [
      viewport.width,
      viewport.height,
      viewport.pixelRatio,
      viewport.contentX,
      viewport.contentY,
      viewport.contentWidth,
      viewport.contentHeight,
      viewTransform.zoom,
      viewTransform.translateX,
      viewTransform.translateY
    ].join(":");
    if (nextGradientTransformKey !== gradientTransformKey) {
      gradient.left = new Two.Vector(gradientVector.x1, gradientVector.y1);
      gradient.right = new Two.Vector(gradientVector.x2, gradientVector.y2);
      gradientTransformKey = nextGradientTransformKey;
    } else {
      gradient.left.set(gradientVector.x1, gradientVector.y1);
      gradient.right.set(gradientVector.x2, gradientVector.y2);
    }
    for (let stopIndex = 0; stopIndex < stops.length; stopIndex += 1) {
      const source = ramp[stopIndex];
      stops[stopIndex].offset = source.offset;
      stops[stopIndex].color = source.color;
      stops[stopIndex].opacity = source.opacity;
    }

    for (let bin = 0; bin < pathPairs.length; bin += 1) {
      const pair = pathPairs[bin];
      const segments = geometry.bins[bin];
      const depthOpacity = mobiusOpacityForBin(bin, geometry.depthFade);

      fillPath(Two, pair.base, segments);
      pair.base.linewidth = geometry.strokeWidth;
      pair.base.opacity = depthOpacity * baseOpacity;

      pair.texture.visible = hasTexture;
      if (hasTexture) {
        fillPath(Two, pair.texture, segments);
        pair.texture.linewidth = geometry.strokeWidth;
        pair.texture.opacity = depthOpacity * appearance.textureStrength;
        pair.texture.dashes = texture.pattern.slice();
        pair.texture.dashes.offset = texture.offset;
      }
    }

    two.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    two.release();
    two.clear();
    const instanceIndex = Two.Instances.indexOf(two);
    if (instanceIndex >= 0) Two.Instances.splice(instanceIndex, 1);
  }

  return { resize, render, dispose };
}

function toSvg(frame) {
  return mobiusFlowProject.toSvg(frame)
    .replace("Cauce 05 — Möbius Flow", "Cauce 05.2 — Möbius Flow Vector");
}

export const mobiusFlowVectorProject = {
  id: PROJECT_ID,
  index: "05.2",
  name: "Möbius Flow Vector",
  label: "Cauce — Möbius Flow Vector",
  description: "Prototipo vectorial de Möbius Flow con scene graph Two.js y render determinista controlado por Cauce.",
  backend: /** @type {"two"} */ ("two"),
  preferredFps: mobiusFlowProject.preferredFps,
  preferredFormatKey: mobiusFlowProject.preferredFormatKey,
  preferredLoopSeconds: mobiusFlowProject.preferredLoopSeconds,
  viewControls: true,
  controls: mobiusFlowProject.controls.map((control) => ({
    ...control,
    options: control.options?.map((option) => ({ ...option }))
  })),
  defaults: { ...mobiusFlowProject.defaults },
  createRenderer: createMobiusVectorRenderer,
  toSvg
};
