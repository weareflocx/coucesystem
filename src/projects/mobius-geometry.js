import { mobiusShape, motionSample, writeAnimatedMobiusPoint } from "./mobius-core.js";

export const MOBIUS_BASE_SURFACE_SEGMENTS = 192;
export const MOBIUS_BASE_WIDTH_SEGMENTS = 24;
export const MOBIUS_MAX_SURFACE_SEGMENTS = 1024;

function roundUp(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

export function mobiusTessellation(frame, shape = mobiusShape(frame)) {
  const resolutionScale = Math.max(
    1,
    Math.min(1.5, Math.sqrt(Math.min(frame?.width ?? 1000, frame?.height ?? 1000) / 1000))
  );
  const surfaceSegments = Math.min(
    MOBIUS_MAX_SURFACE_SEGMENTS,
    roundUp(Math.max(
      MOBIUS_BASE_SURFACE_SEGMENTS,
      shape.halfTwists * 32 * Math.sqrt(shape.twistDetail),
      shape.profileMode === 3 ? shape.profileFrequency * 32 : 0
    ) * resolutionScale, 8)
  );
  const widthSegments = roundUp(Math.max(
    MOBIUS_BASE_WIDTH_SEGMENTS,
    shape.profileMode === 3 ? shape.profileFrequency * 6 : 0,
    shape.thickness > 0 ? 32 : 0
  ), 4);
  return {
    surfaceSegments,
    widthSegments,
    centerSamples: Math.max(144, Math.round(surfaceSegments * 0.75)),
    sideSamples: Math.max(288, surfaceSegments * 2),
    signature: [surfaceSegments, widthSegments].join(":"),
    vertexCount: (surfaceSegments + 1) * (widthSegments + 1),
    triangleCount: surfaceSegments * widthSegments * 2
  };
}

export function mobiusPreviewTessellation(frame, shape = mobiusShape(frame)) {
  const exact = mobiusTessellation(frame, shape);
  const surfaceSegments = Math.min(exact.surfaceSegments, 320);
  const profileWidthSegments = shape.profileMode === 3
    ? shape.profileFrequency * 2
    : shape.profileMode === 0 ? 12 : 16;
  const widthSegments = Math.min(
    exact.widthSegments,
    roundUp(Math.max(12, profileWidthSegments), 2)
  );
  return {
    surfaceSegments,
    widthSegments,
    centerSamples: Math.min(exact.centerSamples, 192),
    sideSamples: Math.min(exact.sideSamples, 512),
    signature: `preview:${surfaceSegments}:${widthSegments}`,
    vertexCount: (surfaceSegments + 1) * (widthSegments + 1),
    triangleCount: surfaceSegments * widthSegments * 2
  };
}

export function createMobiusSurfaceIndices(surfaceSegments, widthSegments) {
  const indices = new Uint32Array(surfaceSegments * widthSegments * 6);
  const row = widthSegments + 1;
  let offset = 0;
  for (let uIndex = 0; uIndex < surfaceSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex < widthSegments; vIndex += 1) {
      const topLeft = uIndex * row + vIndex;
      const topRight = topLeft + 1;
      const bottomLeft = (uIndex + 1) * row + vIndex;
      const bottomRight = bottomLeft + 1;
      indices[offset] = topLeft;
      indices[offset + 1] = bottomLeft;
      indices[offset + 2] = topRight;
      indices[offset + 3] = bottomLeft;
      indices[offset + 4] = bottomRight;
      indices[offset + 5] = topRight;
      offset += 6;
    }
  }
  return indices;
}

export function createMobiusVolumeIndices(surfaceSegments, widthSegments) {
  const layerVertexCount = (surfaceSegments + 1) * (widthSegments + 1);
  const surfaceIndices = createMobiusSurfaceIndices(surfaceSegments, widthSegments);
  const indices = new Uint32Array(surfaceIndices.length * 2 + surfaceSegments * 12);
  let offset = 0;
  for (let index = 0; index < surfaceIndices.length; index += 3) {
    const a = surfaceIndices[index];
    const b = surfaceIndices[index + 1];
    const c = surfaceIndices[index + 2];
    indices[offset] = a;
    indices[offset + 1] = b;
    indices[offset + 2] = c;
    indices[offset + 3] = layerVertexCount + a;
    indices[offset + 4] = layerVertexCount + c;
    indices[offset + 5] = layerVertexCount + b;
    offset += 6;
  }
  const row = widthSegments + 1;
  for (let uIndex = 0; uIndex < surfaceSegments; uIndex += 1) {
    const nextU = uIndex + 1;
    for (const edgeV of [0, widthSegments]) {
      const top = uIndex * row + edgeV;
      const nextTop = nextU * row + edgeV;
      const bottom = layerVertexCount + top;
      const nextBottom = layerVertexCount + nextTop;
      if (edgeV === 0) {
        indices[offset] = top;
        indices[offset + 1] = bottom;
        indices[offset + 2] = nextTop;
        indices[offset + 3] = bottom;
        indices[offset + 4] = nextBottom;
        indices[offset + 5] = nextTop;
      } else {
        indices[offset] = top;
        indices[offset + 1] = nextTop;
        indices[offset + 2] = bottom;
        indices[offset + 3] = bottom;
        indices[offset + 4] = nextTop;
        indices[offset + 5] = nextBottom;
      }
      offset += 6;
    }
  }
  return indices;
}

export function writeMobiusSurfacePositions(
  target,
  frame,
  cycle,
  shape = mobiusShape(frame),
  tessellation = mobiusTessellation(frame, shape)
) {
  let offset = 0;
  for (let uIndex = 0; uIndex <= tessellation.surfaceSegments; uIndex += 1) {
    const u = Math.PI * 2 * uIndex / tessellation.surfaceSegments;
    const motion = motionSample(frame, u, cycle, shape);
    for (let vIndex = 0; vIndex <= tessellation.widthSegments; vIndex += 1) {
      const normalizedV = -1 + 2 * vIndex / tessellation.widthSegments;
      writeAnimatedMobiusPoint(
        target,
        offset,
        frame,
        u,
        normalizedV,
        cycle,
        shape,
        motion
      );
      offset += 3;
    }
  }
  return target;
}

function smoothstep(minimum, maximum, value) {
  const normalized = Math.max(
    0,
    Math.min(1, (value - minimum) / Math.max(0.0001, maximum - minimum))
  );
  return normalized * normalized * (3 - 2 * normalized);
}

export function writeMobiusVolumePositions(
  target,
  centers,
  frame,
  cycle,
  shape = mobiusShape(frame),
  tessellation = mobiusTessellation(frame, shape)
) {
  writeMobiusSurfacePositions(centers, frame, cycle, shape, tessellation);
  const layerVertexCount = tessellation.vertexCount;
  const layerFloatCount = layerVertexCount * 3;
  const row = tessellation.widthSegments + 1;

  for (let uIndex = 0; uIndex <= tessellation.surfaceSegments; uIndex += 1) {
    for (let vIndex = 0; vIndex <= tessellation.widthSegments; vIndex += 1) {
      const vertex = uIndex * row + vIndex;
      const offset = vertex * 3;
      const mirroredV = tessellation.widthSegments - vIndex;
      const previousU = uIndex === 0
        ? (tessellation.surfaceSegments - 1) * row + mirroredV
        : (uIndex - 1) * row + vIndex;
      const nextU = uIndex === tessellation.surfaceSegments
        ? row + mirroredV
        : (uIndex + 1) * row + vIndex;
      const previousV = uIndex * row + Math.max(0, vIndex - 1);
      const nextV = uIndex * row + Math.min(tessellation.widthSegments, vIndex + 1);
      const tangentUX = centers[nextU * 3] - centers[previousU * 3];
      const tangentUY = centers[nextU * 3 + 1] - centers[previousU * 3 + 1];
      const tangentUZ = centers[nextU * 3 + 2] - centers[previousU * 3 + 2];
      const tangentVX = centers[nextV * 3] - centers[previousV * 3];
      const tangentVY = centers[nextV * 3 + 1] - centers[previousV * 3 + 1];
      const tangentVZ = centers[nextV * 3 + 2] - centers[previousV * 3 + 2];
      let normalX = tangentUY * tangentVZ - tangentUZ * tangentVY;
      let normalY = tangentUZ * tangentVX - tangentUX * tangentVZ;
      let normalZ = tangentUX * tangentVY - tangentUY * tangentVX;
      const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
      normalX /= normalLength;
      normalY /= normalLength;
      normalZ /= normalLength;
      const normalizedV = -1 + 2 * vIndex / tessellation.widthSegments;
      const roundedEdge = 1 - shape.edgeRoundness * 0.88 * smoothstep(
        0.72,
        1,
        Math.abs(normalizedV)
      );
      const halfThickness = shape.thickness * 0.5 * roundedEdge;
      target[offset] = centers[offset] + normalX * halfThickness;
      target[offset + 1] = centers[offset + 1] + normalY * halfThickness;
      target[offset + 2] = centers[offset + 2] + normalZ * halfThickness;
      const backOffset = layerFloatCount + offset;
      target[backOffset] = centers[offset] - normalX * halfThickness;
      target[backOffset + 1] = centers[offset + 1] - normalY * halfThickness;
      target[backOffset + 2] = centers[offset + 2] - normalZ * halfThickness;
    }
  }
  return target;
}
