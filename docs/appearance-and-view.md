# Apariencia y vista compartidas

## Decisión

Möbius 05, 05.1 y 05.2 comparten un vocabulario visual y un estado de cámara, pero cada backend lo ejecuta con sus primitivas nativas. No se intenta forzar un único renderer ni convertir la versión Canvas en una escena 3D.

## Apariencia

La paleta tiene cuatro roles: fondo, trazo, acento y color final. Los tres colores de forma construyen una rampa perceptual; los parámetros compartidos controlan intensidad, dirección y punto medio del gradiente, además del modo, escala, intensidad y movimiento de textura cuando el proyecto los admite.

- Canvas 2D usa `CanvasGradient` con 17 muestras interpoladas en OKLab y patrones de trazo deterministas para `Flujo` y `Grano`.
- Two.js reproduce la misma rampa mediante `Two.Stop`, además de los paths y discontinuidades de su scene graph actualizable.
- SVG serializa las mismas muestras mediante `<linearGradient>` y las texturas mediante `stroke-dasharray`.
- Con **Gradiente = 0**, las variantes Möbius omiten `<linearGradient>` y exportan un `stroke` de color sólido real.
- Three.js muestrea la misma rampa y escribe color procedural en atributos dinámicos de vértice para superficie y corrientes. Los colores se mantienen en Linear-sRGB dentro del motor y el renderer entrega sRGB.

Los controles de color son generales: cada proyecto puede empezar en color sólido o con una intensidad propia, pero todos entienden la misma paleta y los mismos tres parámetros de gradiente. La biblioteca de color guarda esa apariencia sin sustituir fórmula, formato, vista ni tiempo del proyecto activo.

Se evitan imágenes bitmap en esta fase porque añadirían carga, resolución fija y diferencias entre canvas, SVG, vídeo alpha y embed. Una futura textura de marca puede añadirse como capa opcional sin sustituir el sistema procedural.

## Vista

`view` contiene zoom, paneo normalizado y órbita en grados. Vive en `EngineState`, llega a `ProjectFrame` y se serializa en guardados, presets y paquetes web.

Los controles de vista viven en el footer horizontal de la zona de trabajo, junto a los controles de tiempo, mientras que el canvas queda libre de overlays. El sistema gestiona puntero, rueda, teclado y dos dedos en el hilo principal. Esto es deliberado: `OrbitControls` necesita un elemento DOM, mientras que el renderer 3D de Studio usa un `OffscreenCanvas` dentro de un worker. 05 y 05.2 transforman el mismo proyector 2.5D; 05.1 mueve una cámara perspectiva real alrededor de un objetivo.

El footer utiliza un único slider para la posición temporal. Velocidad, duración y zoom son valores numéricos editables con pasos `−/+`; el inicio del bucle aparece como marcador sobre la timeline. Esta representación mantiene precisión sin convertir la barra de transporte en otro panel de parámetros.

En 05 y 05.2 el zoom se aplica después de la proyección como una transformación uniforme del grupo gráfico. La forma, el grosor, las discontinuidades, la textura y el gradiente escalan juntos; el fondo permanece fijo. Canvas2D, Two.js y SVG reproducen la misma matriz de escala y paneo.

El encuadre base de 05 y 05.2 se calcula contra una envolvente muestreada y estable del bucle completo. La orientación modifica suavemente la composición antes de encajarla con margen seguro, sin recalcular zoom por fotograma. En 05.1 la geometría permanece tridimensional y sin deformación; una compensación moderada de distancia de cámara evita el recorte en vertical y aprovecha mejor el horizontal.

## Referencias

- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [Three.js color management](https://threejs.org/manual/en/color-management.html)
- [MDN Canvas gradients](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createLinearGradient)
- [MDN Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
- [MDN SVG gradients](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorials/SVG_from_scratch/Gradients)
