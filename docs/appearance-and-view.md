# Apariencia y vista compartidas

## Decisión

Möbius 05 y 05.1 comparten un vocabulario visual y un estado de cámara, pero cada backend lo ejecuta con sus primitivas nativas. No se intenta forzar un único renderer ni convertir la versión Canvas en una escena 3D.

## Apariencia

La paleta tiene tres colores: fondo, trazo y acento. Los parámetros compartidos controlan intensidad y dirección del gradiente, modo, escala, intensidad y movimiento de textura.

- Canvas 2D usa `CanvasGradient` para el color y patrones de trazo deterministas para `Flujo` y `Grano`.
- SVG reproduce el gradiente mediante `<linearGradient>` y las texturas mediante `stroke-dasharray`.
- Three.js escribe color procedural en atributos dinámicos de vértice para superficie y corrientes. Los colores se mantienen en Linear-sRGB dentro del motor y el renderer entrega sRGB.

Se evitan imágenes bitmap en esta fase porque añadirían carga, resolución fija y diferencias entre canvas, SVG, vídeo alpha y embed. Una futura textura de marca puede añadirse como capa opcional sin sustituir el sistema procedural.

## Vista

`view` contiene zoom, paneo normalizado y órbita en grados. Vive en `EngineState`, llega a `ProjectFrame` y se serializa en guardados, presets y paquetes web.

El HUD gestiona puntero, rueda, teclado y dos dedos en el hilo principal. Esto es deliberado: `OrbitControls` necesita un elemento DOM, mientras que el renderer 3D de Studio usa un `OffscreenCanvas` dentro de un worker. 05 transforma su proyector 2.5D; 05.1 mueve una cámara perspectiva real alrededor de un objetivo.

## Referencias

- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [Three.js color management](https://threejs.org/manual/en/color-management.html)
- [MDN Canvas gradients](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createLinearGradient)
- [MDN Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
- [MDN SVG gradients](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorials/SVG_from_scratch/Gradients)
