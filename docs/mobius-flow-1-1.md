# 05.1 · Möbius Flow 1.1

## Contrato actual

05.1 mantiene un renderer Three.js/WebGL independiente del resto de proyectos. La parametrización vive en `src/projects/mobius-core.js` para que la forma y el movimiento puedan crecer sin duplicar la fórmula en el renderer.

La cinta usa la identificación Möbius `(u = 0, v) ≡ (u = 2π, -v)`. La propia parametrización aplica esa identificación: la fila final conserva el mismo `v` que la anterior y llega físicamente a la fila inicial en orden inverso. Invertir `v` otra vez en el renderer cruza la anchura de la cinta y crea una cremallera. Cualquier movimiento nuevo debe conservar esta condición:

- la fase debe ser periódica en `u`;
- los desplazamientos transversales deben ser periódicos o anti-periódicos según su canal;
- nunca se debe aplicar una deformación acumulativa sobre la geometría ya animada.

## Forma

Los controles de forma actuales son:

- radio central y anchura;
- medias torsiones impares `1 / 3 / 5 / 7`;
- lateralidad derecha/izquierda;
- fase, posición y concentración de torsión;
- elipticidad, profundidad y variación de anchura.

Las torsiones pares y las topologías no Möbius quedan fuera de esta versión.

## Representación

`Marca plana` usa una sola tinta y oculta las corrientes. `Sólido` conserva la iluminación de la superficie. `Material` usa `MeshPhysicalMaterial` con rugosidad, metalness y clearcoat.

El grosor volumétrico real todavía requiere un generador de sección cerrada independiente; no debe implementarse extruyendo las normales de esta superficie no orientable.

## Movimiento

Los modos disponibles son circulación, onda viajera, contracción localizada y deriva orgánica. Cada modo se evalúa desde el tiempo absoluto del frame, la semilla, la velocidad y la intensidad. La circulación y la respiración existentes se mantienen como parámetros compatibles.

Los sets de movimiento se guardan separados de los presets de cámara y tienen los mismos ámbitos: sistema, compartido y proyecto. Los sets compartidos se reutilizan entre proyectos compatibles dentro de la biblioteca local; los de proyecto sólo aparecen en 05.1.

La prueba comprueba cierre, continuidad local de la malla, ausencia de saltos en las corrientes y finitud con:

```sh
npm run test:mobius
```
