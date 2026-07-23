# Cauce Studio

Motor modular para proyectos generativos inspirados en corrientes de agua.

## Desarrollo

```bash
npm install
npm run dev
```

Abre siempre `http://localhost:5173`. Studio sincroniza una vez los guardados que pudieran existir en `http://127.0.0.1:5173` y redirige después al origen canónico `localhost`.

`npm run dev` conserva además una copia de la biblioteca en `.cauce/library.json`. Este archivo es local y está excluido de Git.

## Netlify

El repositorio incluye `netlify.toml` y una Function en `/api/library`. El deploy continúa siendo local-first: sin configuración remota, proyectos y apariencias viven en `localStorage` y pueden exportarse como backup.

Para activar la sincronización privada entre dispositivos:

1. Genera una clave larga, por ejemplo con `openssl rand -base64 32`.
2. Crea `CAUCE_LIBRARY_KEY` en las variables de entorno de Netlify con alcance de Functions. No uses el prefijo `VITE_`.
3. Despliega de nuevo el sitio.
4. Abre **Proyectos → Sincronización Netlify**, introduce la misma clave y pulsa **Conectar**.

La clave se conserva en `sessionStorage`, nunca en el repositorio ni en el bundle. La biblioteca se almacena en Netlify Blobs mediante un store global con consistencia fuerte. Consulta [`docs/library-sync.md`](docs/library-sync.md) para el contrato y las limitaciones.

## Verificación

```bash
npm run build
```

Con `npm run dev` abierto, la matriz WebGPU se ejecuta mediante
`npm run benchmark:fluid`. `npm run benchmark:fluid -- reuse` verifica el
cambio Flow Cauce → Chromatic Fluid → Flow Cauce y los perfiles compartidos
32k/64k/128k. `npm run test:fluid-reuse` valida además el contrato estático del
segundo consumidor. `npm run benchmark:fluid -- chromatic` mide compute y
render GPU de las dos formas de 08.5 en esos perfiles.

## Arquitectura

- `src/core/`: estado compartido, protocolo del worker y reloj de render.
- `src/engine/fluid/`: solver MLS-MPM reutilizable, buffers, scheduler y diagnóstico.
- `src/projects/`: módulos de proyecto y registro único compartido.
- `src/main.ts`: shell de autor, controles y comunicación con el worker.
- `src/styles.css`: layout y sistema visual del estudio.

La vista previa usa un contrato multi-backend dentro de un Web Worker: Canvas 2D directo y Three.js/WebGL para las piezas con geometría 3D. Ambos backends reciben el mismo estado y reloj determinista. SVG es una capacidad opcional por proyecto; PNG, vídeo y web reutilizan el renderer nativo.

## Estado actual

- `01 · Compression Field`: líneas ordenadas moduladas por focos móviles.
- `01.1 · Compression Field 2`: presión convertida en grosor vectorial variable, con familias vertical, horizontal o cruzada.
- `02 · Vector Currents`: motor Flow Advection con masas periódicas sobre una retícula fija, calibrado contra la referencia de 5,63 s a 60 fps.
- `02.1 · Vector Currents Advection`: advección continua y no periódica con curvas RK2, memoria finita y densidad retrotrazada.
- `03 · Scalar Drift`: píxeles cuadrados fijos con relleno escalar por niveles; conserva el loop original y añade masas continuas sembradas que se cruzan, se fusionan y abren vacíos.
- Composición adaptativa de campos en `01`, `02` y `03`: el eje corto mantiene escala, densidad y velocidad; formatos horizontales y verticales revelan más campo sin deformar la fórmula.
- `04 · Orbital Basin`: órbitas cerradas sobre una cuenca planar con dos tangencias compartidas.
- `04.1 · Orbital Basin Flow`: una onda de densidad modifica grosor, profundidad y tangencias mientras recorre la cuenca orbital.
- `05 · Möbius Flow`: corrientes cerradas sobre una banda de Möbius paramétrica, con una cara y un único borde.
- `05.1 · Möbius Flow 1.1`: cinta Möbius con 1–15 medias torsiones, distribuciones controlables, perfiles geométricos, grosor 3D y SVG adaptativo.
- `05.2 · Möbius Flow Dynamics`: flujo continuo de hasta 24.000 partículas con estelas GPU, velocidades independientes, circulación inversa y turbulencia sobre la superficie Möbius.
- `05.3 · Möbius Constructs`: compositor vectorial con ritmo de anchura, corte longitudinal, entrelazado, eco temporal y morph entre dos formas compatibles.
- Apariencia compartida: color único o gradiente perceptual OKLab de dos a cuatro colores, fondo independiente, materiales y texturas procedurales `Flujo`, `Grano` y `Mineral`.
- Biblioteca de apariencias persistente: conserva la configuración completa en el navegador y en el mismo archivo local `.cauce/library.json` que los proyectos guardados; las paletas antiguas se migran al abrirlas.
- Sincronización opcional con Netlify Blobs: combina proyectos, apariencias y eliminaciones entre dispositivos sin renunciar al funcionamiento offline.
- Adaptadores piloto: Canvas2D/SVG, Three.js clásico y WebGPU/TSL consumen el mismo `AppearanceStyle v1` mediante sus primitivas nativas.
- Footer de tiempo y vista: timeline, órbita, paneo, zoom, gestos táctiles, teclado y reencuadre; el estado se conserva en guardados y exportaciones.
- `06 · Confluence Weave`: cauces orbitales convertidos en un campo de densidad cuyos contactos forman puentes y membranas vectoriales.
- Encuadre adaptativo de `04`, `05`, `05.1` y `06`: envolvente estable durante todo el bucle, margen seguro y composición específica para vertical, cuadrado y horizontal.
- `07 · Image Currents`: prototipo de grabado vectorial que transforma la luminancia de una fotografía en corrientes moduladas. La imagen alimenta preview, SVG y vídeo durante la sesión; todavía no se incluye en guardados ni paquetes web.
- `08 · Chromatic Flux`: campo Three.js continuo de hasta 120.000 partículas con geometrías punto, vector y diamante; estructuras nube, toro, esfera y hélice; separación espacial RGB y mezcla en tiempo real con la paleta. Exporta PNG, vídeo y web, sin representación SVG alternativa.
- `08.1 · Tension Network`: vectores Three.js distribuidos sobre una envolvente elipsoidal con profundidad real, núcleo volumétrico y vista oblicua; ofrece recorrido estático o `Nacer → Llegar`, velocidades independientes, cabeza orientada y disolución progresiva. Exporta PNG, vídeo y web sin SVG.
- `08.2 · Chromatic Flux WebGPU`: primera pieza del backend Three.js WebGPU/TSL, con hasta 160.000 partículas esféricas por canal, campos analíticos deterministas, relieve iluminado y fallback WebGL2. Exporta PNG, vídeo y web sin SVG.
- `08.3 · Fluid Particles WebGPU`: prototipo WebGPU estricto con solver MLS-MPM stateful, 4.096–262.144 partículas, grid físico 48³/64³/96³, contenedores físicos cubo/rectángulo/pirámide/esfera y representaciones redonda, esfera, cubo o `Flow orgánica` sobre un único estado de simulación. Esta última alarga cada partícula, la orienta con la velocidad suavizada y modula su tamaño con la densidad para producir movimientos colectivos próximos a una bandada. Exporta PNG, vídeo y web sin SVG.
- `08.4 · Flow Cauce`: evolución Cauce de `holtsetio/flow` sobre Three.js r185. Conserva grid 64³, cinco kernels MLS-MPM, distribución esférica, ruido triangular, densidad, color HSV, partículas redondeadas alargadas e interacción. El renderer propio usa materiales PBR, sala opcional, HDRI, luces y sombras sin bloom ni MRT. Añade semilla determinista, formatos, cámara compartida, presets, PNG, vídeo, modo limpio con alpha y un modelo de superficie CSF opcional con tres kernels adicionales para masa suavizada, normal, curvatura y cohesión; no ofrece SVG, loop ni paquete web mientras su runtime y assets anidados no formen parte del ZIP.
- `08.5 · Chromatic Fluid`: segundo consumidor de Cauce Fluid Engine 0.2. Cada partícula física tiene una única representación opaca con `Flow original` o esfera; su color recorre continuamente el gradiente mediante densidad, velocidad, posición y tiempo, con el HSV original como alternativa. No duplica simulación ni reserva el buffer visual de Flow. Admite 32k/64k/128k, PNG y vídeo, pero todavía no SVG ni paquete web.
- `Cauce Fluid Engine 0.2`: núcleo compartido con perfiles físicos 32k/64k/128k, buffer visual opcional (`direction`/`color`), diagnóstico de memoria y reset CPU compatible o GPU v2 opt-in mediante `?fluid-reset=gpu-v2`. Las suites `reset` y `reuse` miden respectivamente los reinicios y el contrato entre consumidores.
- Guardados locales v2 con migración de v1, copia conjunta de proyectos y apariencias e intercambio mediante `.cauce.json`.
- Exportación SVG del fotograma actual.
- Exportación PNG RGBA del fotograma actual, con fondo o canal alpha.
- Exportación de vídeo por perfiles: MP4 H.264 con fondo, MOV ProRes 4444 con alpha para CapCut, WebM VP9 alpha para web y MP4 con croma verde.
- FPS, progreso y cancelación compartidos por todos los perfiles de vídeo.
- Exportación web en ZIP con `<cauce-flow>`, configuración JSON y ejemplo HTML.

## Compatibilidad de vídeo

Studio verifica en tiempo de ejecución que el navegador pueda codificar el codec del perfil elegido. Los perfiles MP4 usan H.264; WebM conserva el canal alpha mediante VP9. El perfil CapCut renderiza primero ese WebM transparente y el servidor local lo convierte a MOV ProRes 4444 mediante FFmpeg, por lo que requiere ejecutar `npm run dev` y tener `ffmpeg` disponible en `PATH`.

El Web Component reutiliza los renderers de Studio, es responsive, se pausa fuera de pantalla y no tiene dependencias externas. La secuencia PNG sigue documentada en [`docs/export-roadmap.md`](docs/export-roadmap.md); el fotograma PNG individual ya está implementado.

El contrato para añadir proyectos está documentado en [`docs/project-contract.md`](docs/project-contract.md).
Las decisiones de apariencia y navegación están documentadas en [`docs/appearance-and-view.md`](docs/appearance-and-view.md).
El núcleo WebGPU compartido está documentado en [`docs/cauce-fluid-engine.md`](docs/cauce-fluid-engine.md).
