# Estrategia de exportación

## Embed web — implementado

La salida principal será un Web Component autónomo que reciba una configuración serializada:

```html
<cauce-flow src="/flows/liquidez-nocturna.json"></cauce-flow>
<script type="module" src="/cauce-embed.js"></script>
```

El embed reutiliza los mismos renderers deterministas de Studio y acepta fondo transparente. El ZIP contiene el Web Component autónomo, un archivo JSON versionado, un ejemplo HTML y documentación de la API. Los proyectos Three.js incorporan una copia local del motor; no dependen de CDN ni de la aplicación de autor.

Los presets compartibles usan el esquema v2 y la extensión `.cauce.json`. Al importarlos, Studio valida el proyecto y formato y limita cada valor al rango declarado por sus controles.

## Vídeo con alpha

No existe una única salida transparente con compatibilidad universal. La exportación tendrá perfiles detectados por capacidad:

1. WebM VP9 con alpha para navegadores compatibles — implementado.
2. HEVC con alpha para Safari y plataformas Apple mediante un exportador específico.
3. Secuencia PNG como salida sin pérdida y fallback interoperable.
4. Vídeo con fondo sólido cuando el destino no admita transparencia.

La ruta implementada usa Mediabunny sobre WebCodecs, solicita `alpha: "keep"` tanto al comprobar capacidad como al codificar y renderiza en un `OffscreenCanvas` separado con fondo transparente. No se asume compatibilidad: la interfaz bloquea la exportación si el navegador no puede codificar VP9 alpha.

## Estado de implementación

1. Fidelidad visual y cierre de bucle — aprobado.
2. Esquema de guardados locales — implementado.
3. WebM VP9 alpha — implementado.
4. Secuencia PNG transparente como fallback.
5. HEVC alpha para el ecosistema Apple.
6. `cauce-embed.js` y Web Component — implementado.

## Referencias

- [WebCodecs](https://w3c.github.io/webcodecs/)
- [Mediabunny](https://mediabunny.dev/guide/quick-start/)
- [WebM alpha](https://wiki.webmproject.org/alpha-channel)
- [HEVC con alpha](https://developer.apple.com/documentation/AVFoundation/using-hevc-video-with-alpha)
