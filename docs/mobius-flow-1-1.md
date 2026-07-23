# 05.1 · Möbius Flow 1.1

## Contrato actual

05.1 mantiene un renderer Three.js/WebGL independiente del resto de proyectos. La parametrización vive en `src/projects/mobius-core.js` y la teselación compartida en `src/projects/mobius-geometry.js`; preview y SVG consumen así la misma forma y el mismo nivel de detalle.

La cinta usa la identificación Möbius `(u = 0, v) ≡ (u = 2π, -v)`. La propia parametrización aplica esa identificación: la fila final conserva el mismo `v` que la anterior y llega físicamente a la fila inicial en orden inverso. Invertir `v` otra vez en el renderer cruza la anchura de la cinta y crea una cremallera. Cualquier movimiento nuevo debe conservar esta condición:

- la fase debe ser periódica en `u`;
- los desplazamientos transversales deben ser periódicos o anti-periódicos según su canal;
- nunca se debe aplicar una deformación acumulativa sobre la geometría ya animada.

## Forma

Los controles de forma se organizan en cuatro grupos:

- **Forma básica:** radio (`0.55–1.90`), anchura total (`0.24–1.60`), ovalado (`0.60–1.55`) y profundidad (`0.35–1.75`).
- **Torsión:** medias torsiones impares de `1` a `15`, lateralidad y distribución.
- **Perfil de cinta:** plano, abombado, plegado o corrugado.
- **Acabado geométrico:** grosor 3D y redondeo del borde.

Las torsiones pares y las topologías no Möbius quedan fuera de esta versión.

Los extremos ampliados de forma básica abren una zona creativa: cuando la anchura supera el radio, la cinta puede plegarse y solaparse sobre su centro. Esa combinación sigue siendo finita y renderizable, pero deja de representar una banda regular y produce siluetas florales o más tensas de forma deliberada.

La distribución de torsión puede ser uniforme, localizada, doble u ondulada. Las tres últimas exponen posición, extensión e intensidad. Internamente todas producen una progresión normalizada, monótona y con la misma torsión total: cambiar la distribución modifica dónde gira la cinta, no su topología.

El inicio del bucle se puede fijar en cualquier posición de la línea de tiempo con el icono de bandera del footer. El valor se guarda como `loopPhase`, se aplica al preview 3D y a las dos variantes SVG, y los guardados anteriores mantienen el inicio original (`0%`) si no lo tenían.

`Fase`, `Posición` y `Concentración` dejan de ser el modelo público anterior. Los proyectos guardados siguen cargando: `width` se migra a anchura total y `twistConcentration` se traduce a distribución localizada e intensidad. Los parámetros heredados necesarios para reproducir el resultado permanecen ocultos.

## Representación

`Marca plana` usa una sola tinta y oculta las corrientes. `Sólido` conserva la iluminación de la superficie. `Material` usa `MeshPhysicalMaterial` con rugosidad, metalness y clearcoat.

El grosor se construye desde la superficie central en cada frame con dos capas y paredes laterales. En la identificación Möbius, ambas capas intercambian su papel; no se acumulan deformaciones ni se trata la cinta como una superficie orientable. El redondeo reduce progresivamente el espesor en los bordes. Es un acabado exclusivo del preview 3D: el SVG mantiene la superficie central sin volumen ni sombra.

## Calidad y exportación

La teselación es automática. Parte de `192 × 24` y aumenta según:

- número y concentración de torsiones;
- frecuencia del perfil corrugado;
- grosor activo;
- resolución de salida, con un máximo de `1024` tramos longitudinales para mantener el editor y el SVG manejables.

El preview exacto y las dos exportaciones SVG usan la misma parametrización y conservan la resolución longitudinal de `mobiusTessellation()`. `mobiusVectorTessellation()` adapta únicamente la anchura: `1` tramo para plano, `8` para abombado, `2` para plegado y `max(12, frecuencia × 6)` para corrugado. La malla de color conserva los polígonos y gradientes que cada perfil necesita. El SVG plano emite las celdas como rutas independientes ordenadas por profundidad, sin strokes internos, corrientes ni gradientes: así evita que las auto-intersecciones de la proyección cancelen el relleno y generen huecos falsos.

La comparación SVG tiene dos estados. En pausa genera el fotograma SVG exacto con la teselación de descarga. Durante la reproducción, el renderer Three cambia a un material vectorial sin iluminación, grosor ni sombras y conserva la misma geometría central, cámara y colores. Esta representación se mantiene en GPU a la cadencia normal del proyecto, sin reconstruir miles de nodos DOM en cada frame. La descarga nunca utiliza el material de preview.

En `Exportar > Vídeo`, la fuente `SVG plano` rasteriza ese `toSvg()` exacto para cada fotograma del loop y lo codifica como MP4, WebM alpha o MOV alpha según el perfil elegido. El vídeo conserva una sola tinta, bordes limpios y ausencia de iluminación, grosor y malla visible; no es una grabación del canvas 3D.

## Movimiento

Los modos disponibles son circulación, onda viajera, contracción localizada y deriva orgánica. Cada modo se evalúa desde el tiempo absoluto del frame, la semilla, la velocidad y la intensidad. La circulación y la respiración existentes se mantienen como parámetros compatibles.

Los sets de movimiento se guardan separados de los presets de cámara y tienen los mismos ámbitos: sistema, compartido y proyecto. Los sets compartidos se reutilizan entre proyectos compatibles dentro de la biblioteca local; los de proyecto sólo aparecen en 05.1.

La prueba comprueba las torsiones impares de `1` a `15`, monotonicidad de las cuatro distribuciones, cierre de todos los perfiles y movimientos, detalle adaptativo, compatibilidad heredada y paridad de la malla SVG con:

```sh
npm run test:mobius
```
