// Low-poly rounded particle used by the original Flow renderer. Keeping the
// primitive outside either project lets consumers share the faithful shape
// without coupling their cameras, materials or render lifecycle.
export function createFlowRoundedBoxGeometry(THREE, width = 0.7, height = 0.7, depth = 3, radius = 0.1) {
  const geometry = new THREE.BoxGeometry(
    width - radius * 2,
    height - radius * 2,
    depth - radius * 2
  );
  const epsilon = Math.min(width, height, depth) * 0.01;
  const positionArray = geometry.attributes.position.array;
  const normalArray = geometry.attributes.normal.array;
  const indices = [...geometry.getIndex().array];
  const vertices = [];
  const positionMap = {};
  const edgeMap = {};

  for (let index = 0; index < positionArray.length / 3; index += 1) {
    const offset = index * 3;
    const originalPosition = new THREE.Vector3(
      positionArray[offset],
      positionArray[offset + 1],
      positionArray[offset + 2]
    );
    positionArray[offset] += normalArray[offset] * radius;
    positionArray[offset + 1] += normalArray[offset + 1] * radius;
    positionArray[offset + 2] += normalArray[offset + 2] * radius;
    const vertex = new THREE.Vector3(
      positionArray[offset],
      positionArray[offset + 1],
      positionArray[offset + 2]
    );
    vertex.flowNormal = new THREE.Vector3(
      normalArray[offset],
      normalArray[offset + 1],
      normalArray[offset + 2]
    );
    vertex.flowIndex = index;
    vertex.flowFaces = [];
    vertex.flowHash = originalPosition
      .toArray()
      .map((value) => Math.round(value / epsilon))
      .join("_");
    positionMap[vertex.flowHash] = [...(positionMap[vertex.flowHash] ?? []), vertex];
    vertices.push(vertex);
  }

  for (const vertex of vertices) {
    const face = vertex.flowNormal.toArray().map((value) => Math.round(value)).join("_");
    vertex.flowFace = face;
    for (const sibling of positionMap[vertex.flowHash]) sibling.flowFaces.push(face);
  }

  for (const vertex of vertices) {
    const addToEdge = (entry) => {
      edgeMap[entry] = [...(edgeMap[entry] ?? []), vertex];
    };
    vertex.flowFaces.sort();
    const [face0, face1, face2] = vertex.flowFaces;
    if (face0 === vertex.flowFace || face1 === vertex.flowFace) addToEdge(`${face0}_${face1}`);
    if (face0 === vertex.flowFace || face2 === vertex.flowFace) addToEdge(`${face0}_${face2}`);
    if (face1 === vertex.flowFace || face2 === vertex.flowFace) addToEdge(`${face1}_${face2}`);
  }

  const addFace = (vertex0, vertex1, vertex2) => {
    const sideA = vertex1.clone().sub(vertex0);
    const sideB = vertex2.clone().sub(vertex0);
    if (sideA.cross(sideB).dot(vertex0) > 0) {
      indices.push(vertex0.flowIndex, vertex1.flowIndex, vertex2.flowIndex);
    } else {
      indices.push(vertex0.flowIndex, vertex2.flowIndex, vertex1.flowIndex);
    }
  };

  for (const siblings of Object.values(positionMap)) addFace(...siblings);
  for (const edgeVertices of Object.values(edgeMap)) {
    const first = edgeVertices[0];
    edgeVertices.sort((left, right) => left.distanceTo(first) - right.distanceTo(first));
    addFace(...edgeVertices.slice(0, 3));
    addFace(...edgeVertices.slice(1, 4));
  }

  geometry.setIndex(indices);
  return geometry;
}
