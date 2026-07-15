# Contrato de proyectos

Cada proyecto es un módulo JavaScript autocontenido dentro de `src/projects/`. El mismo objeto alimenta Studio, el Web Worker, SVG, vídeo y el Web Component exportado.

Un proyecto puede componer renderers internos compartidos, pero sólo el objeto registrado representa una pieza visible en Studio.

## Campos obligatorios

- `id`, `index`, `name`, `label` y `description`.
- `preferredFps`.
- `controls` y `defaults`.
- `render(context, frame)`.
- `toSvg(frame)`.

Los campos opcionales `preferredFormatKey` y `preferredLoopSeconds` permiten seleccionar una presentación inicial coherente con la pieza.

## Alta de un proyecto

1. Crear `src/projects/<project-id>.js`.
2. Exportar un único objeto que cumpla el contrato.
3. Añadirlo a `src/projects/registry.js`.

El exportador web empaqueta automáticamente todos los módulos JavaScript de `src/projects/`; no requiere mantener una segunda lista de archivos. No deben crearse implementaciones alternativas para el worker o el embed.

## Determinismo

- `frame.time` está normalizado entre `0` y `1`.
- `time = 0` y `time = 1` deben producir el mismo fotograma.
- Toda aleatoriedad debe derivar de `frame.seed` mediante `createRandom`.
- No usar `Math.random()`, `Date.now()` ni `performance.now()` dentro del renderer.
- El fondo sólo se dibuja cuando `frame.transparent` es falso.
- El renderer debe restaurar `globalAlpha` y cualquier estado mutable que modifique.

## Rendimiento

La geometría debe escalar con el formato sin asignaciones ilimitadas. Los parámetros importados se normalizan contra `min` y `max` antes de llegar al motor.

## Validación

```bash
npm run build
```

Además, verificar SVG en varios puntos del bucle y comparar de forma exacta los resultados de `time = 0` y `time = 1`.
