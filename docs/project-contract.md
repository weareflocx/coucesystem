# Contrato de proyectos

Cada proyecto es un módulo JavaScript autocontenido dentro de `src/projects/`. El mismo objeto alimenta Studio, el Web Worker, las exportaciones compatibles y el Web Component exportado.

Un proyecto puede componer renderers internos compartidos, pero sólo el objeto registrado representa una pieza visible en Studio.

## Campos comunes

- `id`, `index`, `name`, `label` y `description`.
- `preferredFps`.
- `controls` y `defaults`.
- `exportCapabilities` declara las salidas disponibles.

Los campos opcionales `preferredFormatKey`, `preferredLoopSeconds` y `preferredPlaybackMode` permiten seleccionar una presentación inicial coherente con la pieza. `supportsContinuousTime: true` habilita el tiempo continuo. Un proyecto continuo que declare `supportsLoopTime: false` oculta el selector y evita presentar como loop una fórmula que no cierra. `supportsUnboundedPreviewTime: true` mantiene un reloj absoluto durante la previsualización: la duración configurada pasa a ser únicamente la ventana finita de exportación.

`toSvg(frame)` es opcional. Un proyecto que no pueda conservar su lenguaje visual como vector declara `exportCapabilities: { svg: false }` y no implementa un sustituto 2D. Si una capacidad no se declara, PNG, vídeo y web se consideran disponibles y SVG se deduce de la presencia de `toSvg`.

## Backend gráfico

Cada proyecto elige uno de estos contratos:

- Canvas 2D — `backend` omitido o `"canvas2d"` y `render(context, frame)`.
- Three.js — `backend: "three"` y `createRenderer(canvas)`.
- WebGPU — `backend: "webgpu"` y `createRenderer(canvas)`; puede ofrecer un fallback interno sin cambiar su contrato de proyecto.

`createRenderer` puede ser asíncrono y devuelve un objeto con este ciclo de vida:

- `resize(viewport)`: actualiza resolución, pixel ratio y rectángulo útil.
- `render(frame)`: dibuja exactamente el tiempo recibido, sin reloj propio.
- `flush()`: espera opcionalmente a que la GPU termine; PNG y vídeo lo usan antes de leer el canvas.
- `dispose()`: detiene el renderer y libera sus geometrías, materiales y
  recursos propios.

Studio conserva tres canvases separados: Canvas 2D, WebGL2 y WebGPU. Un canvas
que ya obtuvo un contexto `webgpu` no se reutiliza como `webgl2`, ni al revés.
El renderer administrado se destruye al cambiar de proyecto. PNG, vídeo y Web
Component crean instancias independientes mediante el mismo contrato. Cuando
existe, `toSvg` actúa como representación vectorial compatible, pero no
condiciona las demás salidas.

`viewControls: true` activa el HUD compartido. El proyecto debe entonces aplicar `frame.view`:

- `zoom`: escala o distancia de cámara.
- `panX` y `panY`: desplazamiento normalizado.
- `orbitYaw` y `orbitPitch`: órbita horizontal y vertical en grados.

Los controles de fórmula se distribuyen en el inspector compacto `Principal`, `Movimiento` y `Forma`. Por defecto, los cuatro primeros parámetros relevantes forman la sección principal; las claves dinámicas se clasifican como movimiento y los parámetros técnicos conocidos quedan en `Avanzados`. Un proyecto puede evitar esa heurística declarando `inspectorSection: "essential" | "motion" | "shape" | "appearance" | "advanced"`; `advanced: true` es el atajo para el último caso.

Los controles con `group: "appearance"` se muestran en Apariencia. Las claves canónicas de gradiente, material y textura se absorben en el editor compartido; los ajustes específicos del renderer permanecen disponibles en `group: "color3d"`. Un control numérico puede declarar `options` para representarse como selector sin cambiar el formato serializable de `parameters`; `timeMode` permite mostrarlo únicamente en Loop o Continuo.

`appearanceCapabilities` es opcional y describe qué decisiones del contrato común tienen efecto real:

```ts
appearanceCapabilities: {
  paint: true,
  gradientMapping: ["screen"] | ["surface"] | ["screen", "surface"],
  materials: ["matte", "satin", "metal", "glass"],
  proceduralTextures: ["flow", "grain", "mineral"]
}
```

Si no se declara mapeado, Canvas 2D usa `screen` y Three/WebGPU usan `surface`. El editor no debe mostrar material en un backend que no lo represente.

## Alta de un proyecto

1. Crear `src/projects/<project-id>.js`.
2. Exportar un único objeto que cumpla el contrato.
3. Añadirlo a `src/projects/registry.js`.

El exportador web empaqueta automáticamente los módulos JavaScript de primer nivel de `src/projects/`; no requiere mantener una segunda lista para proyectos autocontenidos. Un proyecto que dependa de runtimes anidados, binarios o assets importados debe declarar `exportCapabilities.web: false` hasta que esas dependencias formen parte explícita del paquete. No deben crearse implementaciones alternativas para el worker o el embed.

## Determinismo

- `frame.time` está normalizado entre `0` y `1` y representa la posición dentro de la ventana temporal visible.
- `frame.elapsedTime` contiene el reloj determinista en segundos. En una previsualización acotada deriva de la duración; con `supportsUnboundedPreviewTime` continúa creciendo aunque `frame.time` vuelva visualmente a cero.
- `frame.timeMode` vale `"loop"` o `"continuous"`. En continuo, la reproducción se detiene al final sin volver a cero.
- Un proyecto con `supportsUnboundedPreviewTime` no se detiene ni emite un final durante la previsualización. La exportación de vídeo sigue siendo finita y usa `playback.loopSeconds` como duración del clip.
- `frame.appearance` contiene `AppearanceStyle v1` y es la fuente común para color, gradiente, material y textura.
- `frame.palette` incluye `background`, `foreground`, `accent` y `secondary` como proyección compatible. Los proyectos nuevos deben preferir `frame.appearance`; los antiguos pueden seguir consumiendo `palette`.
- `frame.view` es parte del estado determinista, no un ajuste local de la previsualización.
- `frame.imageField`, cuando existe, contiene una matriz de luminancia temporal. Los proyectos deben convertirla en geometría; no incrustar el raster en el SVG.
- En modo loop, `time = 0` y `time = 1` deben producir el mismo fotograma. El modo continuo no impone esa igualdad.
- Toda aleatoriedad debe derivar de `frame.seed` mediante `createRandom`.
- No usar `Math.random()`, `Date.now()` ni `performance.now()` dentro del renderer.
- No iniciar `requestAnimationFrame`, `setAnimationLoop` ni un reloj de Three.js dentro del proyecto.
- El fondo sólo se dibuja cuando `frame.transparent` es falso.
- Canvas 2D debe restaurar `globalAlpha` y cualquier estado mutable que modifique.
- Three.js debe derivar animación, cámara y deformación únicamente del tiempo recibido en `frame` y liberar todos sus recursos en `dispose()`.

## Rendimiento

La geometría debe escalar con el formato sin asignaciones ilimitadas. Los parámetros importados se normalizan contra `min` y `max` antes de llegar al motor.

## Composición entre formatos

Un cambio de formato no debe estirar el espacio matemático de la pieza. `composition.js` deriva un espacio común donde una unidad equivale siempre al eje corto del artboard:

- Cuadrado conserva el dominio canónico `[0, 1] × [0, 1]`.
- Horizontal revela más campo a izquierda y derecha.
- Vertical revela más campo arriba y abajo.
- `createFieldGrid()` mantiene celdas aproximadamente cuadradas y una densidad estable sobre el eje corto.
- `shortSideScale()` mantiene trazos y detalles proporcionales sin ligarlos al ancho.

Los proyectos de campo completo deben evaluar su fórmula en las coordenadas de mundo de esa composición y dibujar en las coordenadas de pantalla correspondientes. `01`, `02`, `02.1` y `03` siguen esta política.

Los proyectos contenidos —órbitas, bandas o símbolos— usan `adaptiveAxisScale()` para responder suavemente a la orientación y `fitBoundsToArtboard()` para encajar su envolvente con margen seguro. El ajuste debe calcularse con límites estables para todo el bucle, nunca con los límites del fotograma actual: de lo contrario se cancela la respiración de la fórmula y aparece un zoom automático. `04` y `05` muestrean y almacenan la envolvente completa del bucle; `06` utiliza el dominio máximo estable de su campo.

## Validación

```bash
npm run build
```

Además, verificar las salidas declaradas en vertical, cuadrado y horizontal. En proyectos con SVG se valida el documento vectorial. En proyectos Loop se comparan de forma exacta `time = 0` y `time = 1`; en proyectos continuos se comprueban determinismo, evolución temporal y estabilidad de cobertura. Para renderers administrados se debe probar también el cambio de backend, PNG alpha, la exportación WebM alpha y el ZIP servido por HTTP.
