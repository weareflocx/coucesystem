/**
 * Derives a format-independent composition space from the output artboard.
 *
 * One world unit always maps to the short side of the format. A square keeps
 * the canonical [0, 1] × [0, 1] domain; wider or taller formats reveal more of
 * the same field instead of stretching it.
 */
export function compositionMetrics(frame) {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const shortSide = Math.min(width, height);
  const worldWidth = width / shortSide;
  const worldHeight = height / shortSide;

  return {
    width,
    height,
    shortSide,
    longSide: Math.max(width, height),
    aspect: width / height,
    orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
    centerX: width * 0.5,
    centerY: height * 0.5,
    worldLeft: 0.5 - worldWidth * 0.5,
    worldTop: 0.5 - worldHeight * 0.5,
    worldWidth,
    worldHeight
  };
}

/**
 * Creates an approximately square screen grid with a stable number of cells
 * along the short side. Cell centres also expose isotropic world coordinates.
 */
export function createFieldGrid(frame, shortSideCells) {
  const composition = compositionMetrics(frame);
  const density = Math.max(1, Math.round(shortSideCells));
  const columns = Math.max(1, Math.round(density * composition.worldWidth));
  const rows = Math.max(1, Math.round(density * composition.worldHeight));
  const cellWidth = composition.width / columns;
  const cellHeight = composition.height / rows;

  return {
    ...composition,
    columns,
    rows,
    cellWidth,
    cellHeight,
    cellSize: Math.min(cellWidth, cellHeight),
    worldCellWidth: composition.worldWidth / columns,
    worldCellHeight: composition.worldHeight / rows
  };
}

export function shortSideScale(frame, referenceSize = 760) {
  return compositionMetrics(frame).shortSide / referenceSize;
}

/**
 * Gently adapts contained artwork to the artboard orientation. This is not a
 * raw pixel stretch: the result is applied in the project's logical space and
 * then uniformly fitted back into the safe artboard bounds.
 */
export function adaptiveAxisScale(frame, strength = 0.35, maximum = 1.35) {
  const aspect = compositionMetrics(frame).aspect;
  const x = Math.min(maximum, Math.max(1 / maximum, Math.pow(aspect, strength)));
  const y = Math.min(maximum, Math.max(1 / maximum, Math.pow(aspect, -strength)));
  return { x, y };
}

export function fitBoundsToArtboard(frame, bounds, paddingRatio = 0.08) {
  const composition = compositionMetrics(frame);
  const padding = composition.shortSide * Math.max(0, Math.min(0.45, paddingRatio));
  const boundsWidth = Math.max(0.000001, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(0.000001, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, composition.width - padding * 2);
  const availableHeight = Math.max(1, composition.height - padding * 2);
  const scale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
  const boundsCenterX = (bounds.minX + bounds.maxX) * 0.5;
  const boundsCenterY = (bounds.minY + bounds.maxY) * 0.5;

  return {
    scale,
    offsetX: composition.centerX - boundsCenterX * scale,
    offsetY: composition.centerY - boundsCenterY * scale
  };
}
