# Cauce Fluid Engine

`Cauce Fluid Engine 0.2` extrae de `08.4 · Flow Cauce` el estado físico,
los buffers WebGPU, el grafo compute y el scheduler de paso fijo. El objetivo
es que Flow Cauce, Chromatic Fluid y proyectos posteriores compartan una sola
simulación sin compartir cámara, material, iluminación ni postprocesado.

## Límite actual

El motor separa el buffer físico (`position`, `density`, `velocity`, `mass` y
`C`) del buffer visual opcional (`direction` y `color`). G2P sigue preparando
el color HSV/mineral y la dirección en el mismo dispatch, por lo que no se ha
añadido una sexta pasada ni se ha cambiado el movimiento. Flow Cauce solicita
el modo visual `flow`; otros proyectos pueden usar `visualMode: "none"`.

La capacidad se selecciona por perfiles de 32k, 64k y 128k. Una promoción se
realiza recreando explícitamente el renderer; la reducción se deja para la
siguiente creación para evitar reasignaciones mientras se mueve el control.
El reset `legacy-cpu` conserva las semillas existentes. `gpu-v2` solo se activa
con `?fluid-reset=gpu-v2` y usa una distribución determinista nueva.

## Contrato

```js
const fluid = createCauceFluidEngine({ THREE, TSL, renderer });

fluid.setParticleCount(32768);
fluid.advance({
  seed,
  elapsedTime,
  speed,
  beforeStep,
  onReset
});

const particleBuffer = fluid.particleBuffer;
const visualBuffer = fluid.visualBuffer;
const diagnostics = fluid.getDiagnostics();

fluid.dispose();
```

El proyecto puede leer `particleBuffer` directamente desde un material TSL y,
si solicita `visualMode: "flow"`, `visualBuffer` para dirección y color. No
existe transferencia GPU→CPU entre simulación y representación.

## Estado físico y scheduler

- Capacidad: perfiles de 32.768, 65.536 y 131.072 partículas.
- Rejilla: `64³`, 262.144 celdas.
- Paso fijo: 60 Hz.
- Recuperación máxima: cuatro pasos por frame.
- Base MLS-MPM/APIC: cinco dispatches.
- Superficie CSF opcional: tres dispatches adicionales.
- Reinicio sembrado cuando cambia la semilla, el tiempo retrocede o aparece un
  salto superior a 0,5 segundos.

## Memoria teórica de buffers

| Buffer | Memoria |
| --- | ---: |
| Partículas físicas, capacidad máxima | 10 MiB |
| Partículas visuales Flow, capacidad máxima | 4 MiB |
| Rejilla atómica | 4 MiB |
| Velocidad y masa de rejilla | 4 MiB |
| Masa suavizada CSF | 1 MiB |
| Normal y gradiente CSF | 4 MiB |
| Total base con buffer visual | 22 MiB |
| Total con CSF | 27 MiB |

En un proyecto sin buffer visual, el total base máximo baja a 18 MiB. Estas
cifras no incluyen staging interno del backend, geometrías, sombras,
texturas, HDRI ni postprocesado.

## Diagnóstico y benchmark

Con el servidor de desarrollo abierto en el origen canónico
`http://localhost:5173`, ejecutar:

```bash
npm run benchmark:fluid
npm run benchmark:fluid -- physics
npm run benchmark:fluid -- render
npm run benchmark:fluid -- reset
npm run benchmark:fluid -- switch
```

El benchmark abre Chrome headless con WebGPU/Metal. La suite `physics` recorre
32k, 64k y 128k partículas con Flow original y CSF. La suite `render` aísla
raster base, luz directa, HDRI, sombras, partícula esférica o vectorial y los
dos materiales PBR. Cada perfil visual se repite en orden inverso y se informa
su mediana. La suite `reset` compara los perfiles de capacidad y el coste de
reiniciar tres semillas. Sin argumento se ejecutan esas tres suites. La suite
`switch` comprueba por separado la transición WebGPU → WebGL → WebGPU → WebGL
sobre los canvases persistentes del Studio. El benchmark informa:

- pasos simulados por segundo;
- dispatches activos;
- frames de recuperación descartados;
- coste CPU de enviar los comandos;
- tiempo GPU de compute, render y total;
- techo de FPS estimado a partir del tiempo GPU;
- capacidad elegida y memoria teórica física/visual del solver;
- coste CPU y bytes subidos de cada reinicio.

`GPU fps max` no representa el framerate observado por la interfaz: es el
techo aproximado que permite la suma de compute y render de esa muestra.
`CPU submit ms` tampoco es tiempo GPU; solo mide cuánto tarda JavaScript en
codificar y enviar los comandos.

Las timestamp queries se solicitan únicamente en modo diagnóstico. Si el
adaptador no expone `timestamp-query`, el benchmark lo indica expresamente y
mantiene solo las métricas CPU; no presenta estas últimas como tiempo GPU. La
resolución de queries es asíncrona y se agrupa cada 30 frames para no bloquear
el loop ni desbordar el pool del backend.

La API de depuración solo se publica al abrir Studio con
`?debug-engine=1` y queda disponible como `window.__CAUCE_DEBUG__`.

### Medición 0.2

Muestra corta del 21 de julio de 2026, Chrome/WebGPU sobre Metal, sin frames
de recuperación descartados en la suite física:

| Capacidad | Solver | Pasos/s | Compute GPU | Memoria física | Memoria visual |
| ---: | --- | ---: | ---: | ---: | ---: |
| 32k | original | 59,8 | 2,74 ms | 2,5 MiB | 1 MiB |
| 32k | CSF | 61,9 | 2,74 ms | 2,5 MiB | 1 MiB |
| 64k | original | 59,9 | 2,93 ms | 5 MiB | 2 MiB |
| 64k | CSF | 61,9 | 2,37 ms | 5 MiB | 2 MiB |
| 128k | original | 60,0 | 3,78 ms | 10 MiB | 4 MiB |
| 128k | CSF | 59,8 | 4,70 ms | 10 MiB | 4 MiB |

En 128k, el perfil PBR completo midió 12,29 ms de frame GPU total en esta
pasada. El reset compatible `legacy-cpu` preparó y subió 3,5/7/14 MiB en
32k/64k/128k, con 4,6/12,8/21,9 ms de CPU. `gpu-v2` bajó la preparación CPU a
0,1 ms y subió 0 bytes; el kernel escribe directamente los buffers físicos y
visuales. Son medidas de una GPU concreta, no un objetivo universal.

## Primera medición y optimización

En la ejecución de referencia del 21 de julio de 2026, con 131.072
partículas, el solver no era el coste dominante. Compute necesitaba
aproximadamente 2–5 ms por frame, mientras el render esférico PBR con sombras
necesitaba unos 25 ms.

La esfera visible usa un icosaedro de detalle 1, 80 triángulos. Inicialmente
esa misma geometría se repetía en el shadow pass. Se añadió un proxy de sombra
de detalle 0, 20 triángulos, mediante un segundo draw range dentro de la misma
geometría instanciada. El material y la geometría visibles no cambiaron.

Resultados aproximados, tomando dos muestras en órdenes opuestos:

| Caso, 131.072 partículas | Antes | Después |
| --- | ---: | ---: |
| Render esférico PBR con sombras | 25,0 ms | 18,3 ms |
| Sobrecoste de las sombras sobre PBR | 10,2 ms | 2,1 ms |
| Render esférico directo con sombras | 12,2 ms | 5,9 ms |

La mejora reduce cerca de un 79 % el sobrecoste de sombra dentro del perfil
PBR y alrededor de un 27 % el render PBR completo con sombras. Son mediciones
del equipo actual, no una promesa de rendimiento universal.

En la medición siguiente se aplicó además la indexación de la esfera visible.
Con 131.072 partículas, timestamp queries activas y el mismo perfil de Chrome
con WebGPU/Metal, el resultado fue:

| Perfil | Render GPU | Frame GPU total |
| --- | ---: | ---: |
| Esfera, raster base | 5,6 ms | 8,8 ms |
| Esfera, HDRI + luz | 6,2 ms | 9,5 ms |
| Esfera PBR completa, con sombras | 8,4 ms | 11,6 ms |
| Esfera mineral completa | 8,4 ms | 11,3 ms |

La esfera conserva 80 triángulos, pero pasa a 42 vértices únicos y 240 índices;
el proxy de sombra conserva 20 triángulos, 60 vértices y 60 índices. La
comparación es de una GPU concreta y debe repetirse en las máquinas objetivo.

## Renderer PBR directo

Bloom no formaba parte de la iluminación física: era un postproceso que
alteraba contraste, color y silueta. MRT solo existía para producir su máscara
`bloomIntensity`. Ambos se retiraron del runtime y también se eliminó
`bloomMask` del contrato del motor compartido. Flow Cauce usa ahora render PBR
directo con luces, HDRI, sombras, exposición y tone mapping.

Perfil GPU posterior, con 131.072 partículas:

| Perfil | Render GPU |
| --- | ---: |
| Esfera, raster base | 5,6 ms |
| Esfera, luz directa | 5,8 ms |
| Esfera, HDRI + luz | 6,2 ms |
| Esfera PBR completa, con sombras | 8,4 ms |
| Esfera mineral, sin sombras | 6,0 ms |
| Esfera mineral completa | 8,4 ms |
| Vector, HDRI + luz | 7,7 ms |
| Vector PBR completo | 8,6 ms |

En esta ejecución, HDRI y luz directa quedaron en 6,2 ms; las sombras añadieron
aproximadamente 2,2 ms en el perfil PBR completo. La esfera y el vector quedan
en el mismo orden de coste después de indexar la geometría; la diferencia
depende más del material y del estado de sombras que de la forma sola.

El escalado del perfil esférico completo fue aproximadamente 7,1 ms en 32k,
7,9 ms en 64k y 11,6 ms en 128k en la medición indexada. Compute pasó de
1,5–3,9 ms según el caso. La geometría rasterizada sigue siendo el límite
principal del renderer actual, pero ya no justifica introducir LOD o impostores
como siguiente paso.

La geometría visible de esfera se construye ahora con vértices compartidos
mediante `mergeVertices()` después de eliminar el atributo UV. La topología no
cambia; se evitan únicamente ejecuciones duplicadas del vertex shader en las
esquinas coincidentes. El diagnóstico y el benchmark publican los vértices e
índices de superficie y sombra para comprobar el resultado en cada GPU.

El runtime también publica una instantánea `webgpu` con las features opcionales
del dispositivo (`timestamp-query`, `shader-f16`, `subgroups` e indirect draw)
y los límites relevantes. Esta información es diagnóstica: ninguna feature
opcional activa todavía una ruta física distinta ni elimina el fallback directo.

## Trabajo completado en 0.2

1. Perfiles de capacidad 32k/64k/128k para no reservar el máximo en todos los
   proyectos; el worker recrea el renderer solo cuando el control necesita
   promocionar la capacidad.
2. Reinicio sembrado en GPU opt-in (`?fluid-reset=gpu-v2`), con `legacy-cpu`
   como comportamiento compatible.
3. Separación de `direction` y `color` en un buffer visual opcional; no añade
   un dispatch y permite que otros proyectos consuman solo el estado físico.
4. Diagnóstico y benchmark de memoria, capacidad y reset.

## Siguiente fase

1. Comparar proxies de sombra esféricos más pequeños con el actual de veinte
   triángulos antes de modificar la resolución de los mapas de sombra.
2. Estudiar celdas activas y reducción de contención atómica.
3. Evaluar culling GPU/draw indirecto solo con dominios mayores o una cámara
   que deje una parte significativa de las partículas fuera de pantalla.

El culling GPU y el draw indirecto quedan deliberadamente como prototipo
condicional. En la medición actual, 128k partículas ya alcanzan 11,6 ms de
frame GPU con PBR y sombras, y el contenedor ocupa prácticamente el encuadre;
añadir un kernel de compactación en ese caso podría empeorar el resultado.
Se activarán cuando probemos dominios mayores o una cámara que deje una parte
significativa de las partículas fuera de pantalla.

Estas opciones pueden conservar la física. Una rejilla sparse,
precisión reducida o una acumulación distinta pueden alterar el orden numérico
y deben tratarse como variantes del solver, no como refactors invisibles.

## Capacidades previstas

Los módulos físicos se incorporarán sobre este núcleo en este orden:

1. vorticidad y confinamiento de curl;
2. colisionadores SDF;
3. fricción, deslizamiento y adhesión de paredes;
4. perfiles de resolución;
5. presión más incompresible;
6. reconstrucción visual de superficie.

Chromatic Fluid debería consumir un único `particleBuffer` y dibujarlo en
capas RGB. Tres fluidos independientes solo se justificarán cuando cada canal
necesite física diferente, porque triplicarían estado y cómputo.
