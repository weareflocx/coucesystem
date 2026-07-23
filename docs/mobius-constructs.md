# 05.3 · Möbius Constructs

05.3 es un consumidor vectorial del núcleo paramétrico de 05.1. No sustituye a `05.2 · Möbius Flow Dynamics`: mantiene separadas la construcción geométrica exportable y la simulación de partículas GPU.

La herramienta parte de una cinta base y aplica cinco operadores independientes. Cada operador tiene su propio interruptor y su propio módulo; apagado devuelve una transformación neutra. Por defecto solo está activo **Ritmo de anchura**, de modo que las funciones se pueden estudiar, activar y combinar una a una.

## Operaciones

- **Ritmo de anchura** modifica la sección longitudinal mediante una envolvente localizada, doble u ondulada. La fase puede circular durante el loop.
- **Corte longitudinal** divide el dominio transversal en uno a cinco carriles. En una Möbius impar, el final del carril `i` coincide con el inicio del carril reflejado `n − 1 − i`; la parametrización compartida conserva esa reconexión sin una costura especial dibujada.
- **Entrelazado vectorial** ordena las celdas de atrás hacia delante y separa únicamente los dos bordes longitudinales de la celda superior. No dibuja divisores transversales, por lo que no reaparece la retícula blanca.
- **Eco temporal** vuelve a muestrear el mismo sistema en tiempos anteriores del loop. Cada eco conserva cámara, morph, ritmo, color y costura.
- **Morph A/B** interpola posiciones de dos superficies completas que comparten torsión, lateralidad, distribución y perfil. No interpola `halfTwists` como un valor fraccionario, porque eso rompería el cierre durante la transición.

## Arquitectura

- `width-rhythm.js`: envolvente de anchura.
- `lane-cut.js`: intervalos y separación de carriles.
- `vector-weave.js`: separación visual de cruces en Canvas y SVG.
- `temporal-echo.js`: tiempos, cantidad y persistencia de ecos.
- `shape-morph.js`: forma B e interpolación A/B.

`mobius-constructs.js` solo compone esos operadores, construye la escena común y declara sus controles. Activar varios no crea motores alternativos: todos se aplican sobre el mismo muestreo paramétrico.

## Salidas

Canvas, PNG, SVG, vídeo del proyecto y vídeo SVG consumen `createMobiusConstructScene(frame)`. El SVG conserva el orden de profundidad, los carriles, el color longitudinal y los ecos. La separación de entrelazado usa el fondo actual; en una salida transparente se omite para no introducir un halo de color falso.

La teselación longitudinal se limita a 384 tramos en preview y exportación. Los perfiles subdividen cada carril de forma adaptativa, reutilizando `mobiusVectorTessellation()`.
