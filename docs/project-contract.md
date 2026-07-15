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
- Three.js — `backend: "three"` y `createRenderer(canvas)`.

`createRenderer` puede ser asíncrono y devuelve un objeto con este ciclo de vida:

- `resize(viewport)`: actualiza resolución, pixel ratio y rectángulo útil.
- `render(frame)`: dibuja exactamente el tiempo recibido, sin reloj propio.
- `dispose()`: libera geometrías, materiales y contexto del renderer.

Studio conserva un canvas por backend y destruye el renderer 3D al volver a un proyecto 2D. Vídeo y Web Component crean instancias independientes mediante el mismo contrato. `toSvg` sigue siendo obligatorio también para proyectos 3D y actúa como representación vectorial compatible.

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
- `frame.palette` incluye `background`, `foreground` y `accent`.
- `frame.view` es parte del estado determinista, no un ajuste local de la previsualización.
- `time = 0` y `time = 1` deben producir el mismo fotograma.
- Toda aleatoriedad debe derivar de `frame.seed` mediante `createRandom`.
- No usar `Math.random()`, `Date.now()` ni `performance.now()` dentro del renderer.
- No iniciar `requestAnimationFrame`, `setAnimationLoop` ni un reloj de Three.js dentro del proyecto.
- El fondo sólo se dibuja cuando `frame.transparent` es falso.
- Canvas 2D debe restaurar `globalAlpha` y cualquier estado mutable que modifique.
- Three.js debe derivar animación, cámara y deformación únicamente de `frame.time` y liberar todos sus recursos en `dispose()`.

## Rendimiento

La geometría debe escalar con el formato sin asignaciones ilimitadas. Los parámetros importados se normalizan contra `min` y `max` antes de llegar al motor.

## Validación

```bash
npm run build
```

Además, verificar SVG en varios puntos del bucle y comparar de forma exacta los resultados de `time = 0` y `time = 1`. Para Three.js se debe probar también el cambio 2D → 3D → 2D, la exportación WebM alpha y el ZIP servido por HTTP.
