# Prototipo Two.js — 05.2

## Objetivo

`05.2 · Möbius Flow Vector` prueba Two.js como scene graph vectorial sin sustituir 05 ni cambiar el estado, el reloj o las salidas públicas de Cauce.

05 y 05.2 llaman a la misma función geométrica. La diferencia está después de la proyección:

- 05 envía los segmentos directamente a `CanvasRenderingContext2D`.
- 05.2 actualiza paths manuales de Two.js y solicita un render explícito.

Two.js no inicia un reloj propio. Studio, vídeo y embed continúan enviando un `frame` determinista.

## Integración

El backend `two` implementa el mismo ciclo de vida administrado que Three.js:

- `createRenderer(canvas)` crea la escena sobre `HTMLCanvasElement` u `OffscreenCanvas`.
- `resize(viewport)` aplica tamaño, pixel ratio y rectángulo útil.
- `render(frame)` actualiza anchors, gradiente, opacidad y textura.
- `dispose()` libera listeners, escena e instancia.

Canvas de Studio y vídeo usan Two.js. El SVG conserva el serializador determinista de Cauce porque el renderer SVG de Two.js depende del DOM y el exportador actual vive dentro del worker. El paquete web reescribe el import dinámico e incluye `vendor/two.module.js` localmente.

## Comparación inicial

Medición de referencia realizada en Chrome headless a 1080 × 1080, 60 fotogramas y 15 corrientes:

| Renderer | Tiempo total | Tiempo por fotograma |
| --- | ---: | ---: |
| 05 Canvas directo | 21,4 ms | 0,36 ms |
| 05.2 Two.js | 86,7 ms | 1,45 ms |

Two.js fue 4,05 veces más lento en esta prueba aislada, pero permaneció por debajo de los 16,7 ms disponibles a 60 fps. La diferencia visual entre capturas equivalentes fue 0,0059 RMSE normalizado.

Estas cifras no son una garantía de rendimiento para todos los dispositivos. Antes de promover el backend deben repetirse con más corrientes, trazos gruesos, texturas, formatos verticales y hardware móvil.

## Resultado de compatibilidad

- Worker + `OffscreenCanvas`: aprobado.
- Controles de vista y apariencia: aprobado.
- SVG con gradiente y textura: aprobado.
- WebM VP9 1080 × 1080 con alpha: aprobado.
- ZIP y embed sin CDN: aprobado.
- Regresión 05 Canvas y 05.1 Three.js: aprobada.

## Decisión pendiente

05.2 sigue siendo un prototipo. Two.js aporta scene graph, paths reutilizables y una base común para curvas y grupos, pero no aporta campos de flujo, profundidad ni grosor variable. La decisión de adoptarlo debe basarse en los próximos proyectos y en una prueba de estrés, no sólo en la paridad de Möbius Flow.

## Referencias

- [Two.js](https://two.js.org/)
- [CanvasRenderer](https://two.js.org/docs/renderers/canvas/)
- [SVGRenderer](https://two.js.org/docs/renderers/svg/)
- [Two.Path](https://two.js.org/docs/path/)
