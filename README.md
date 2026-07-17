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

El repositorio incluye `netlify.toml` y una Function en `/api/library`. El deploy continúa siendo local-first: sin configuración remota, proyectos y paletas viven en `localStorage` y pueden exportarse como backup.

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

## Arquitectura

- `src/core/`: estado compartido, protocolo del worker y reloj de render.
- `src/projects/`: módulos de proyecto y registro único compartido.
- `src/main.ts`: shell de autor, controles y comunicación con el worker.
- `src/styles.css`: layout y sistema visual del estudio.

La vista previa usa un contrato multi-backend dentro de un Web Worker: Canvas 2D directo, Two.js/Canvas para el prototipo vectorial retained-mode y Three.js/WebGL para las piezas con geometría 3D. Los tres backends reciben el mismo estado y reloj determinista; cada proyecto mantiene además una salida SVG.

## Estado actual

- `01 · Compression Field`: líneas ordenadas moduladas por focos móviles.
- `01.1 · Compression Field 2`: presión convertida en grosor vectorial variable, con familias vertical, horizontal o cruzada.
- `02 · Vector Currents`: motor Flow Advection con masas periódicas sobre una retícula fija, calibrado contra la referencia de 5,63 s a 60 fps.
- `03 · Scalar Drift`: píxeles cuadrados con relleno escalar por niveles, calibrados contra la referencia de 4,5 s a 20 fps.
- Composición adaptativa de campos en `01`, `02` y `03`: el eje corto mantiene escala, densidad y velocidad; formatos horizontales y verticales revelan más campo sin deformar la fórmula.
- `04 · Orbital Basin`: órbitas cerradas sobre una cuenca planar con dos tangencias compartidas.
- `05 · Möbius Flow`: corrientes cerradas sobre una banda de Möbius paramétrica, con una cara y un único borde.
- `05.1 · Möbius Flow 1.1`: malla Three.js de doble cara con depth buffer, iluminación y corrientes 3D.
- `05.2 · Möbius Flow Vector`: prototipo paralelo con scene graph Two.js sobre la misma geometría y parámetros de 05.
- Color compartido en los diez proyectos: cuatro roles editables (`Fondo`, `Trazo`, `Acento` y `Final`), gradiente perceptual OKLab orientable y exportación sólida real con intensidad cero.
- Biblioteca de paletas persistente: conserva color y gradiente en el navegador y en el mismo archivo local `.cauce/library.json` que los proyectos guardados.
- Sincronización opcional con Netlify Blobs: combina proyectos, paletas y eliminaciones entre dispositivos sin renunciar al funcionamiento offline.
- Apariencia Möbius compartida: gradiente y texturas procedurales `Lisa`, `Flujo` y `Grano` entre Canvas2D, SVG, Two.js y Three.js.
- Footer de tiempo y vista: timeline, órbita, paneo, zoom, gestos táctiles, teclado y reencuadre; el estado se conserva en guardados y exportaciones.
- `06 · Confluence Weave`: cauces orbitales convertidos en un campo de densidad cuyos contactos forman puentes y membranas vectoriales.
- Encuadre adaptativo de `04`, `05`, `05.1`, `05.2` y `06`: envolvente estable durante todo el bucle, margen seguro y composición específica para vertical, cuadrado y horizontal.
- `07 · Image Currents`: prototipo de grabado vectorial que transforma la luminancia de una fotografía en corrientes moduladas. La imagen alimenta preview, SVG y vídeo durante la sesión; todavía no se incluye en guardados ni paquetes web.
- Guardados locales v2 con migración de v1, copia conjunta de proyectos y paletas e intercambio mediante `.cauce.json`.
- Exportación SVG del fotograma actual.
- Exportación de vídeo por perfiles: MP4 H.264 con fondo, MOV ProRes 4444 con alpha para CapCut, WebM VP9 alpha para web y MP4 con croma verde.
- FPS, progreso y cancelación compartidos por todos los perfiles de vídeo.
- Exportación web en ZIP con `<cauce-flow>`, configuración JSON y ejemplo HTML.

## Compatibilidad de vídeo

Studio verifica en tiempo de ejecución que el navegador pueda codificar el codec del perfil elegido. Los perfiles MP4 usan H.264; WebM conserva el canal alpha mediante VP9. El perfil CapCut renderiza primero ese WebM transparente y el servidor local lo convierte a MOV ProRes 4444 mediante FFmpeg, por lo que requiere ejecutar `npm run dev` y tener `ffmpeg` disponible en `PATH`.

El Web Component reutiliza los renderers de Studio, es responsive, se pausa fuera de pantalla y no tiene dependencias externas. La secuencia PNG sigue documentada en [`docs/export-roadmap.md`](docs/export-roadmap.md).

El contrato para añadir proyectos está documentado en [`docs/project-contract.md`](docs/project-contract.md).
Las decisiones de apariencia y navegación están documentadas en [`docs/appearance-and-view.md`](docs/appearance-and-view.md).
La arquitectura y las mediciones de 05.2 están documentadas en [`docs/two-prototype.md`](docs/two-prototype.md).
