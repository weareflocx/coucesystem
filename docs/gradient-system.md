# Sistema general de apariencia

## Estado

`AppearanceStyle v1` está implementado como contrato común para color, gradiente, material y textura procedural. `Palette` permanece como compatibilidad derivada, no como editor principal.

## Modelo

```ts
interface AppearanceStyle {
  schemaVersion: 1;
  background: { color: string };
  paint:
    | { type: "solid"; color: string }
    | {
        type: "gradient";
        stops: Array<{ color: string; position: number }>;
        mapping: "screen" | "surface";
        angle: number;
      };
  material: {
    preset: "matte" | "satin" | "metal" | "glass";
    roughness: number;
    metalness: number;
    clearcoat: number;
  };
  texture:
    | { type: "none" }
    | {
        type: "procedural";
        preset: "flow" | "grain" | "mineral";
        scale: number;
        strength: number;
        motion: number;
      };
}
```

Un gradiente contiene entre dos y cuatro paradas. Los extremos quedan fijados en `0` y `1`; las paradas interiores pueden moverse sin cruzarse. La interpolación compartida usa OKLab.

## Flujo de render

```text
AppearanceEditor
      │
      ▼
AppearanceStyle v1
      ├── Canvas2D: 17 muestras → CanvasGradient
      ├── SVG: 17 muestras → <linearGradient>
      ├── Three clásico: 17 muestras → atributos de vértice
      └── WebGPU/TSL: 4 colores + posiciones → uniforms
```

No se fuerza un renderer único. `appearanceCapabilities` declara el mapeado, materiales y texturas que tienen efecto real en cada proyecto. El editor oculta las decisiones que el backend activo no puede representar.

## Persistencia y migración

Los registros nuevos de biblioteca usan `schemaVersion: 2` y guardan `appearance`, además de `palette` y los tres valores de gradiente antiguos para interoperabilidad. Al leer un registro v1:

1. `gradientStrength = 0` se convierte en color sólido.
2. Un gradiente antiguo se convierte en tres paradas: inicio, punto medio y final.
3. Material y textura se derivan de los parámetros del proyecto cuando existen.

El estado completo viaja por worker, PNG, vídeo, preset, backup, paquete web y Web Component. Aplicar una apariencia guardada puede incluir su fondo o conservar el fondo actual.

## Alcance actual

- Máximo cuatro colores por gradiente.
- Texturas procedurales primero; no hay subida de bitmap.
- Mapeado de lienzo en Canvas/SVG y de superficie en los pilotos 3D.
- Pilotos verificados: Scalar Drift, Möbius Flow 1.1 y Flow Cauce.

## Validación

```bash
npm run test:appearance
npm run test:mobius
npm run benchmark:fluid -- switch
npm run build
```

## Referencias

- [Three.js TSL](https://threejs.org/manual/en/threejs-tsl.html)
- [Three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [MDN CanvasGradient.addColorStop](https://developer.mozilla.org/en-US/docs/Web/API/CanvasGradient/addColorStop)
- [MDN SVG linearGradient](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/linearGradient)
