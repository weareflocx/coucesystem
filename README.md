# Cauce Studio

Motor modular para proyectos generativos inspirados en corrientes de agua.

## Desarrollo

```bash
npm install
npm run dev
```

## Verificación

```bash
npm run build
```

## Arquitectura

- `src/core/`: estado compartido, protocolo del worker y reloj de render.
- `src/projects/`: módulos de proyecto y registro único compartido.
- `src/main.ts`: shell de autor, controles y comunicación con el worker.
- `src/styles.css`: layout y sistema visual del estudio.

La vista previa usa un contrato multi-backend dentro de un Web Worker: Canvas 2D directo, Two.js/Canvas para el prototipo vectorial retained-mode y Three.js/WebGL para las piezas con geometría 3D. Los tres backends reciben el mismo estado y reloj determinista; cada proyecto mantiene además una salida SVG.

## Estado actual

- `01 · Compression Field`: líneas ordenadas moduladas por focos móviles.
- `02 · Vector Currents`: motor Flow Advection con masas periódicas sobre una retícula fija, calibrado contra la referencia de 5,63 s a 60 fps.
- `03 · Scalar Drift`: píxeles cuadrados con relleno escalar por niveles, calibrados contra la referencia de 4,5 s a 20 fps.
- `04 · Orbital Basin`: órbitas cerradas sobre una cuenca planar con dos tangencias compartidas.
- `05 · Möbius Flow`: corrientes cerradas sobre una banda de Möbius paramétrica, con una cara y un único borde.
- `05.1 · Möbius Flow 1.1`: malla Three.js de doble cara con depth buffer, iluminación y corrientes 3D.
- `05.2 · Möbius Flow Vector`: prototipo paralelo con scene graph Two.js sobre la misma geometría y parámetros de 05.
- Apariencia Möbius compartida: color de acento, gradiente orientable y texturas procedurales `Lisa`, `Flujo` y `Grano`.
- HUD de vista dentro del canvas: órbita, paneo, zoom, gestos táctiles, teclado y reencuadre; el estado se conserva en guardados y exportaciones.
- `06 · Confluence Weave`: cauces orbitales convertidos en un campo de densidad cuyos contactos forman puentes y membranas vectoriales.
- Guardados locales v2 con migración de v1 e intercambio mediante `.cauce.json`.
- Exportación SVG del fotograma actual.
- Exportación WebM VP9 con canal alpha, FPS configurable, progreso y cancelación.
- Exportación web en ZIP con `<cauce-flow>`, configuración JSON y ejemplo HTML.

## Compatibilidad de vídeo

La exportación transparente verifica en tiempo de ejecución que el navegador pueda codificar VP9 conservando el canal alpha. El Web Component reutiliza los renderers de Studio, es responsive, se pausa fuera de pantalla y no tiene dependencias externas. HEVC alpha y secuencia PNG siguen documentados en [`docs/export-roadmap.md`](docs/export-roadmap.md).

El contrato para añadir proyectos está documentado en [`docs/project-contract.md`](docs/project-contract.md).
Las decisiones de apariencia y navegación están documentadas en [`docs/appearance-and-view.md`](docs/appearance-and-view.md).
La arquitectura y las mediciones de 05.2 están documentadas en [`docs/two-prototype.md`](docs/two-prototype.md).
