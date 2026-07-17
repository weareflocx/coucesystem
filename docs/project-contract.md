# Contrato de proyectos

Cada proyecto es un módulo JavaScript autocontenido dentro de `src/projects/`. El mismo objeto alimenta Studio, el Web Worker, SVG, vídeo y el Web Component exportado.

Un proyecto puede componer renderers internos compartidos, pero sólo el objeto registrado representa una pieza visible en Studio.

## Campos comunes

- `id`, `index`, `name`, `label` y `description`.
- `preferredFps`.
- `controls` y `defaults`.
- `toSvg(frame)`.

Los campos opcionales `preferredFormatKey` y `preferredLoopSeconds` permiten seleccionar una presentación inicial coherente con la pieza.

## Backend gráfico

Cada proyecto elige uno de estos contratos:

- Canvas 2D — `backend` omitido o `"canvas2d"` y `render(context, frame)`.
- Two.js — `backend: "two"` y `createRenderer(canvas)`.
- Three.js — `backend: "three"` y `createRenderer(canvas)`.

`createRenderer` puede ser asíncrono y devuelve un objeto con este ciclo de vida:

- `resize(viewport)`: actualiza resolución, pixel ratio y rectángulo útil.
- `render(frame)`: dibuja exactamente el tiempo recibido, sin reloj propio.
- `dispose()`: libera geometrías, materiales y contexto del renderer.

Studio conserva canvases separados para la superficie 2D y la superficie WebGL, y destruye cualquier renderer administrado al cambiar de proyecto. Vídeo y Web Component crean instancias independientes mediante el mismo contrato. `toSvg` sigue siendo obligatorio para todos los backends y actúa como representación vectorial compatible.

`viewControls: true` activa el HUD compartido. El proyecto debe entonces aplicar `frame.view`:

- `zoom`: escala o distancia de cámara.
- `panX` y `panY`: desplazamiento normalizado.
- `orbitYaw` y `orbitPitch`: órbita horizontal y vertical en grados.

Los controles con `group: "appearance"` se muestran en la sección Apariencia. Un control numérico puede declarar `options` para representarse como selector sin cambiar el formato serializable de `parameters`.

## Alta de un proyecto

1. Crear `src/projects/<project-id>.js`.
2. Exportar un único objeto que cumpla el contrato.
3. Añadirlo a `src/projects/registry.js`.

El exportador web empaqueta automáticamente todos los módulos JavaScript de `src/projects/`; no requiere mantener una segunda lista de archivos. No deben crearse implementaciones alternativas para el worker o el embed.

## Determinismo

- `frame.time` está normalizado entre `0` y `1`.
- `frame.palette` incluye `background`, `foreground`, `accent` y el color final opcional `secondary`. Los presets antiguos sin `secondary` heredan `accent`.
- `frame.view` es parte del estado determinista, no un ajuste local de la previsualización.
- `frame.imageField`, cuando existe, contiene una matriz de luminancia temporal. Los proyectos deben convertirla en geometría; no incrustar el raster en el SVG.
- `time = 0` y `time = 1` deben producir el mismo fotograma.
- Toda aleatoriedad debe derivar de `frame.seed` mediante `createRandom`.
- No usar `Math.random()`, `Date.now()` ni `performance.now()` dentro del renderer.
- No iniciar `requestAnimationFrame`, `setAnimationLoop` ni un reloj de Three.js dentro del proyecto.
- El fondo sólo se dibuja cuando `frame.transparent` es falso.
- Canvas 2D debe restaurar `globalAlpha` y cualquier estado mutable que modifique.
- Two.js debe usar render manual, sin `play()` ni `autostart`, y liberar la escena en `dispose()`.
- Three.js debe derivar animación, cámara y deformación únicamente de `frame.time` y liberar todos sus recursos en `dispose()`.

## Rendimiento

La geometría debe escalar con el formato sin asignaciones ilimitadas. Los parámetros importados se normalizan contra `min` y `max` antes de llegar al motor.

## Composición entre formatos

Un cambio de formato no debe estirar el espacio matemático de la pieza. `composition.js` deriva un espacio común donde una unidad equivale siempre al eje corto del artboard:

- Cuadrado conserva el dominio canónico `[0, 1] × [0, 1]`.
- Horizontal revela más campo a izquierda y derecha.
- Vertical revela más campo arriba y abajo.
- `createFieldGrid()` mantiene celdas aproximadamente cuadradas y una densidad estable sobre el eje corto.
- `shortSideScale()` mantiene trazos y detalles proporcionales sin ligarlos al ancho.

Los proyectos de campo completo deben evaluar su fórmula en las coordenadas de mundo de esa composición y dibujar en las coordenadas de pantalla correspondientes. `01`, `02` y `03` siguen esta política.

Los proyectos contenidos —órbitas, bandas o símbolos— usan `adaptiveAxisScale()` para responder suavemente a la orientación y `fitBoundsToArtboard()` para encajar su envolvente con margen seguro. El ajuste debe calcularse con límites estables para todo el bucle, nunca con los límites del fotograma actual: de lo contrario se cancela la respiración de la fórmula y aparece un zoom automático. `04` y `05` muestrean y almacenan la envolvente completa del bucle; `06` utiliza el dominio máximo estable de su campo.

## Validación

```bash
npm run build
```

Además, verificar SVG en vertical, cuadrado y horizontal, en varios puntos del bucle, y comparar de forma exacta los resultados de `time = 0` y `time = 1`. Para renderers administrados se debe probar también el cambio de backend, la exportación WebM alpha y el ZIP servido por HTTP.
