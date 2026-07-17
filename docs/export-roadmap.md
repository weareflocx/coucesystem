# Estrategia de exportación

## Embed web — implementado

La salida principal será un Web Component autónomo que reciba una configuración serializada:

```html
<cauce-flow src="/flows/liquidez-nocturna.json"></cauce-flow>
<script type="module" src="/cauce-embed.js"></script>
```

El embed reutiliza los mismos renderers deterministas de Studio y acepta fondo transparente. El ZIP contiene el Web Component autónomo, un archivo JSON versionado, un ejemplo HTML y documentación de la API. Paleta, apariencia y encuadre forman parte de esa configuración. Los proyectos Three.js y Two.js incorporan una copia local de su backend; no dependen de CDN ni de la aplicación de autor.

Los presets compartibles usan el esquema v2 y la extensión `.cauce.json`. Al importarlos, Studio valida el proyecto y formato y limita cada valor al rango declarado por sus controles.

La biblioteca local completa se puede respaldar en un único archivo `cauce-library-AAAA-MM-DD.json`. Al importarlo, Studio combina los registros por identificador, conserva los existentes y actualiza únicamente las versiones más recientes.

## Perfiles de vídeo

No existe una única salida transparente con compatibilidad universal. La exportación tendrá perfiles detectados por capacidad:

1. WebM VP9 con alpha para navegadores compatibles — implementado.
2. MOV ProRes 4444 con alpha para CapCut y edición — implementado en el servidor local.
3. MP4 H.264 con el fondo actual — implementado.
4. MP4 H.264 con croma verde como fallback de composición — implementado.
5. Secuencia PNG como salida sin pérdida y fallback interoperable.

La ruta del navegador usa Mediabunny sobre WebCodecs y renderiza en un `OffscreenCanvas` separado. Los perfiles transparentes solicitan `alpha: "keep"`; los MP4 opacos usan AVC con `alpha: "discard"`. No se asume compatibilidad: la interfaz comprueba el codec antes de empezar.

CapCut no interpreta de forma fiable el canal alpha del WebM VP9. Para ese destino, Studio reutiliza el WebM como intermedio y un endpoint local fijo lo convierte con FFmpeg a ProRes 4444 (`prores_ks`, perfil 4, `yuva444p10le`). El endpoint no admite argumentos arbitrarios, limita la entrada a 512 MB, usa archivos temporales aislados y los elimina al terminar. Esta conversión solo está disponible en el servidor de desarrollo local; el build estático conserva los otros tres perfiles.

## Estado de implementación

1. Fidelidad visual y cierre de bucle — aprobado.
2. Esquema de guardados locales — implementado.
3. WebM VP9 alpha — implementado.
4. MOV ProRes 4444 alpha para CapCut — implementado.
5. MP4 H.264 con fondo y croma verde — implementado.
6. Secuencia PNG transparente como fallback sin pérdida.
7. `cauce-embed.js` y Web Component — implementado.

## Referencias

- [WebCodecs](https://w3c.github.io/webcodecs/)
- [Mediabunny](https://mediabunny.dev/guide/quick-start/)
- [WebM alpha](https://wiki.webmproject.org/alpha-channel)
- [Apple ProRes](https://support.apple.com/en-us/102207)
