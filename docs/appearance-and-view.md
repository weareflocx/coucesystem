# Apariencia y vista compartidas

## Decisión

Möbius 05, 05.1 y 05.2 comparten un vocabulario visual y un estado de cámara, pero cada backend lo ejecuta con sus primitivas nativas. No se intenta forzar un único renderer ni convertir la versión Canvas en una escena 3D. 05.2 conserva la superficie paramétrica de 05.1 y separa de ella un sistema de partículas y estelas calculado en GPU.

## Inspector

El sidebar no presenta todos los parámetros en una única lista. Los distribuye entre `Principal`, `Movimiento`, `Forma` y `Apariencia`, recuerda la sección activa por proyecto y mantiene los ajustes técnicos dentro de `Avanzados`. Cada parámetro numérico ocupa una fila compacta con slider nativo y valor editable; así conserva precisión, teclado y tecnologías de asistencia sin duplicar verticalmente etiqueta y lectura.

Los presets de movimiento viven en un diálogo dedicado abierto desde la barra superior. Color y Composición 3D mantienen sus inspectores propios porque se usan mientras se observa y manipula el lienzo.

## Apariencia

`AppearanceStyle v1` es la fuente cromática común. Separa el fondo de la superficie y permite dos modos explícitos:

- `solid`: un único color real.
- `gradient`: entre dos y cuatro paradas editables, posición, ángulo y mapeado `screen` o `surface` según las capacidades del motor.

El mismo estado contiene un material (`matte`, `satin`, `metal` o `glass`) y una textura `none` o procedural (`flow`, `grain`, `mineral`) con escala, fuerza y movimiento. No se admiten imágenes externas en esta fase.

Cada backend consume esa descripción con primitivas nativas:

- Canvas 2D y SVG expanden las paradas a 17 muestras OKLab.
- Three.js clásico escribe la rampa en colores de vértice y la conserva en el SVG de malla mediante gradientes por banda.
- Flow Cauce mantiene cuatro colores y dos posiciones como uniforms TSL; material y textura actualizan uniforms sin recompilar el grafo.

`palette` se conserva dentro de `EngineState` como proyección compatible para proyectos antiguos. Al modificar una apariencia se deriva de forma determinista: fondo, primer color, color más próximo al centro y último color. Al cargar un preset o registro antiguo ocurre la migración inversa.

El editor Apariencia es un inspector modeless flotante en escritorio: puede desplazarse por el viewport, recuerda su posición mediante `cauce:workspace-layout:v1` y no bloquea el lienzo ni Undo. La biblioteca ofrece presets incluidos y permite aplicar la apariencia completa o sólo la superficie.

## Vista

`view` contiene zoom, paneo normalizado y órbita en grados. Vive en `EngineState`, llega a `ProjectFrame` y se serializa en guardados, presets y paquetes web.

Los controles de vista viven en el footer horizontal de la zona de trabajo, junto a los controles de tiempo, mientras que el canvas queda libre de overlays. El sistema gestiona puntero, rueda, teclado y dos dedos en el hilo principal. Esto es deliberado: `OrbitControls` necesita un elemento DOM, mientras que el renderer 3D de Studio usa un `OffscreenCanvas` dentro de un worker. 05 transforma un proyector 2.5D; 05.1 y 05.2 mueven una cámara perspectiva real alrededor de un objetivo.

En escritorio, `Composición 3D` es un panel no modal, fijo al viewport y arrastrable desde su cabecera. Su posición se limita a la ventana y se conserva en el layout local. En pantallas estrechas pasa a hoja inferior y deja de ser arrastrable para no competir con el scroll y los gestos del canvas.

El footer utiliza un único slider para la posición temporal. Velocidad, duración y zoom son valores numéricos editables con pasos `−/+`; el inicio del bucle aparece como marcador sobre la timeline. Esta representación mantiene precisión sin convertir la barra de transporte en otro panel de parámetros.

En 05 el zoom se aplica después de la proyección como una transformación uniforme del grupo gráfico. La forma, el grosor, las discontinuidades, la textura y el gradiente escalan juntos; el fondo permanece fijo. Canvas2D y SVG reproducen la misma matriz de escala y paneo.

El encuadre base de 05 se calcula contra una envolvente muestreada y estable del bucle completo. La orientación modifica suavemente la composición antes de encajarla con margen seguro, sin recalcular zoom por fotograma. En 05.1 y 05.2 la geometría permanece tridimensional; una compensación moderada de distancia de cámara evita el recorte en vertical y aprovecha mejor el horizontal.

## Referencias

- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [Three.js color management](https://threejs.org/manual/en/color-management.html)
- [MDN Canvas gradients](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createLinearGradient)
- [MDN Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
- [MDN SVG gradients](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorials/SVG_from_scratch/Gradients)
