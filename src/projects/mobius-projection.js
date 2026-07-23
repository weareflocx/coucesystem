import { clamp, parameter } from "./shared.js";
import { compositionMetrics } from "./composition.js";

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function createMobiusProjector(frame, cycle) {
  const tilt = parameter(frame, "tilt", 57) * Math.PI / 180;
  const yaw = (
    parameter(frame, "yaw", -14) +
    parameter(frame, "precession", 3.5) * Math.sin(cycle)
  ) * Math.PI / 180;
  const rotation = parameter(frame, "rotation", -30) * Math.PI / 180;
  const cosineTilt = Math.cos(tilt);
  const sineTilt = Math.sin(tilt);
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const cosineRotation = Math.cos(rotation);
  const sineRotation = Math.sin(rotation);

  const view = frame.view ?? {};
  const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
  const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
  const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
  const metrics = compositionMetrics(frame);
  const formatDistance = metrics.aspect < 1
    ? Math.pow(1 / metrics.aspect, 0.22)
    : Math.pow(metrics.aspect, -0.06);
  const distance = parameter(frame, "cameraDistance", 5.1) * formatDistance / zoom;
  const target = [
    -(Number.isFinite(view.panX) ? view.panX : 0) * 3,
    (Number.isFinite(view.panY) ? view.panY : 0) * 3,
    0
  ];
  const cosinePitch = Math.cos(orbitPitch);
  const position = [
    target[0] + Math.sin(orbitYaw) * cosinePitch * distance,
    target[1] + Math.sin(orbitPitch) * distance,
    target[2] + Math.cos(orbitYaw) * cosinePitch * distance
  ];
  const backward = normalizeVector(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2]
  );
  const right = normalizeVector(backward[2], 0, -backward[0]);
  const up = [
    backward[1] * right[2] - backward[2] * right[1],
    backward[2] * right[0] - backward[0] * right[2],
    backward[0] * right[1] - backward[1] * right[0]
  ];
  const perspectiveScale = 1 / Math.tan(parameter(frame, "fov", 38) * Math.PI / 360);
  const projection = Math.round(clamp(parameter(frame, "projection", 0), 0, 1));
  const orthographicHalfHeight = 2.9 / zoom;
  const orthographicHalfWidth = orthographicHalfHeight * metrics.aspect;

  return function project(point) {
    const [x, y, z] = point;
    const worldX = cosineYaw * cosineRotation * x - cosineYaw * sineRotation * y + sineYaw * z;
    const worldY = (
      (cosineTilt * sineRotation + sineTilt * cosineRotation * sineYaw) * x +
      (cosineTilt * cosineRotation - sineTilt * sineRotation * sineYaw) * y -
      sineTilt * cosineYaw * z
    );
    const worldZ = (
      (sineTilt * sineRotation - cosineTilt * cosineRotation * sineYaw) * x +
      (sineTilt * cosineRotation + cosineTilt * sineRotation * sineYaw) * y +
      cosineTilt * cosineYaw * z
    );
    const relativeX = worldX - position[0];
    const relativeY = worldY - position[1];
    const relativeZ = worldZ - position[2];
    const cameraX = relativeX * right[0] + relativeY * right[1] + relativeZ * right[2];
    const cameraY = relativeX * up[0] + relativeY * up[1] + relativeZ * up[2];
    const cameraZ = relativeX * backward[0] + relativeY * backward[1] + relativeZ * backward[2];
    const depth = -cameraZ;
    const projectedX = projection === 1
      ? cameraX / orthographicHalfWidth
      : perspectiveScale * cameraX / (Math.max(0.0001, depth) * metrics.aspect);
    const projectedY = projection === 1
      ? cameraY / orthographicHalfHeight
      : perspectiveScale * cameraY / Math.max(0.0001, depth);
    return {
      x: (projectedX + 1) * frame.width * 0.5,
      y: (1 - projectedY) * frame.height * 0.5,
      depth
    };
  };
}
