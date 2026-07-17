# Sistema general de gradientes

## Estado

Primera versión implementada. El editor, la persistencia y la generación de la rampa son comunes; cada backend sigue consumiendo el resultado con sus primitivas nativas.

## Veredicto

El editor y los datos del gradiente deben ser comunes para 2D y 3D, pero no se creará una arquitectura de cuatro adaptadores formales. Para las necesidades actuales de Cauce sería sobreingeniería.

La parte compartida es la rampa de color. Parte de tres anclas —trazo, acento y final—, mezcla el efecto según la intensidad y genera 17 muestras en OKLab. Cada renderer consume directamente esos datos usando sus primitivas existentes.

```text
ColorEditor
      │
      ▼
paletteGradientStops()
      ├── Canvas2D: CanvasGradient.addColorStop()
      ├── Two.js: Two.Stop
      ├── SVG: <stop>
      └── Three.js: sampleGradient(stops, t)
```

## Diferencia entre Canvas2D, SVG y Two.js

### Canvas2D

Canvas2D es una API nativa de dibujo raster. Recibe órdenes inmediatas y escribe el resultado en píxeles. Es el backend adecuado para la previsualización animada, la captura de frames y el vídeo.

Los gradientes se crean mediante `createLinearGradient()` o `createRadialGradient()` y se alimentan con `addColorStop()`.

### SVG

SVG es un documento vectorial declarativo. Conserva paths, trazos, rellenos y gradientes como elementos editables y escalables. En Cauce se utiliza como formato de exportación e inserción web, no como motor principal de la animación.

Los gradientes se serializan en `<defs>` mediante `<linearGradient>` o `<radialGradient>` y elementos `<stop>`.

### Two.js

Two.js es una librería 2D con scene graph. No es un formato de salida adicional: traduce sus objetos `Path`, `Group`, `Gradient` y `Stop` a Canvas2D, SVG o WebGL.

`05.2 · Möbius Flow Vector` utiliza `Two.Types.canvas`, por lo que su cadena real es:

```text
Cauce → Two.js → Canvas2D
```

Su exportación SVG sigue usando el serializador determinista de Cauce. No se necesita activar `Two.SVGRenderer` para implementar el editor de gradientes.

## Modelo implementado

```ts
interface Palette {
  background: string;
  foreground: string;
  accent: string;
  secondary?: string;
}

interface SavedColorGradient {
  strength: number; // 0..1
  angle: number;    // -180..180 grados
  midpoint: number; // 0.08..0.92
}
```

La interfaz ofrece cuatro colores y tres decisiones de gradiente. No expone 17 puntos manuales: el motor los calcula para producir transiciones más suaves sin convertir el sidebar en un editor técnico. La dirección, el recorrido sobre la geometría y el destino —trazo, relleno o superficie— continúan siendo responsabilidad de cada proyecto.

No se incluirán inicialmente tipos de material, UV, shaders, coordenadas 3D ni un registro genérico de adaptadores.

## Implementación

La primera versión contiene:

1. Un editor compartido de color y gradiente.
2. Conversión sRGB ↔ OKLab e interpolación perceptual.
3. Tres anclas expandidas determinísticamente a 17 muestras.
4. Un adaptador funcional pequeño para `CanvasGradient`.
5. Conversión de las mismas muestras a `Two.Stop`.
6. Serialización compartida de `<linearGradient>` para SVG.
7. Muestreo de la rampa para los atributos de color de Three.js.
8. Biblioteca de paletas dentro del backup y archivo persistente común.

Estas piezas pueden comenzar como funciones pequeñas. Sólo se extraerá una capa de adaptadores si futuros proyectos demuestran que existe duplicación o comportamiento específico suficiente para justificarla.

## Compatibilidad

Si un preset antiguo no contiene `secondary`, se utiliza `accent`. Si un proyecto anterior no contiene parámetros de gradiente, se incorporan sus valores por defecto; en los proyectos originalmente sólidos la intensidad por defecto es cero.

Esto permite conservar guardados, presets `.cauce`, SVG, vídeo alpha, paquetes web y embeds.

## Alcance posterior

Quedan fuera de la primera implementación:

- Gradientes que siguen físicamente el cauce.
- Edición manual de puntos y opacidad por punto.
- Interpolación OKLCH seleccionable.
- Gradientes cónicos.
- Texturas LUT y shaders personalizados.
- Animación independiente de los puntos de color.

## Referencias

- [MDN CanvasGradient.addColorStop](https://developer.mozilla.org/en-US/docs/Web/API/CanvasGradient/addColorStop)
- [MDN SVG linearGradient](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/linearGradient)
- [Two.LinearGradient](https://two.js.org/docs/effects/linear-gradient/)
- [Two.Stop](https://two.js.org/docs/effects/stop/)
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [Three.js color management](https://threejs.org/manual/en/color-management.html)
