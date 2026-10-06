# Diseño: Laboratorio de calibración

Pixel art hecho en código (skill `pixelart-canvas`). Lienzo lógico de 480x270, escala entera (x4 en 1920x1080), sin suavizado.

## Tesis

**¿Cumplen lo que prometen?** Todo se cuenta con cuadrículas de 100 casillas:

- **Borde amarillo** = casilla prometida ("si dice 86 %, promete 86 de 100").
- **Verde con marca** = acertó. **Roja con cruz** = falló.
- **Roja con borde amarillo** = prometida y fallada: ahí se ve lo que promete de más.

Sin ejes, tramos ni fórmulas. Una idea por pantalla, letra grande.

## Mundo

Un laboratorio de noche, contraste bajo. Laya (azul) y Jev (naranja) aparecen como personajes y reaccionan: leen mientras se llenan las casillas, sellan si cumplen y ponen ojos en cruz si prometen de más.

## Paleta y roles

| Token | Uso aquí |
|---|---|
| night `#1a1c2c` | Fondo, bordes, contorno del texto, velo de entrada |
| slate `#333c57` | Juntas de la pared, casillas aún vacías, bordes de las hojas |
| stone `#566c86` | Notas al pie, marcas de la regla |
| stone-light `#94b0c2` | Subtítulos y explicaciones |
| parchment `#f4f4f4` | Texto principal, hojas con las notas publicadas |
| green `#38b764` | Casilla acertada (con marca) y "acierta N de 100" cuando cumple |
| red `#b13e53` | Sólo error: casilla fallada (con cruz) y "acierta N de 100" cuando promete de más |
| blue `#41a6f6` | Laya: nombre, barras, placa del resumen |
| fire `#ef7d57` | Jev: nombre, barras, rango medido en la regla, placa del resumen |
| yellow `#ffcd75` | Borde de las casillas prometidas, el nivel de seguridad de cada pantalla y la frase que hay que llevarse |
| navy `#29366f` | Barra superior |

Jev conserva sus colores originales (`#0b222e`, `#fdd17a`, `#ff7331`, `#ffffff`, `#c44a16`). Laya es un monigote a juego hecho con la paleta: misma rejilla, azul, antena en aro. No es el logotipo de nadie.

El color nunca va solo: acierto = verde **y** marca; fallo = rojo **y** cruz; prometida = **borde** amarillo; Laya y Jev llevan siempre el nombre escrito.

## Pantallas y tiempos

| # | Pantalla | Duración | Qué se ve |
|---|---|---|---|
| 1 | La pregunta | 8 s | Cuadrícula de ejemplo con 90 casillas prometidas (sin resultados) y la leyenda |
| 2 | La prueba | 5 s | Laya y Jev; "las mismas 2.000 preguntas para las dos" |
| 3-5 | Un nivel por pantalla | 11 / 9,5 / 9,5 s | "Cuando dicen estar seguras al 80 % o más / entre 60 y 80 % / entre 40 y 60 %": dos cuadrículas de 10x10 (casillas de 8 px). Promesa en 1 s desde 0,5 s; llenado desde 2 s, una casilla cada 40 ms; veredicto a los 6,4 s |
| 6 | ¿Se puede arreglar a Laya? | 12 s | Cuadrícula "antes" llena; en "corregida" la promesa encoge de 54 a 39 y luego se llena |
| 7 | La noticia | 12 s | Las dos notas publicadas de Jev como hojas y la regla con lo que nos sale según la fórmula |
| 8 | Las tres pruebas juntas | 10 s | Seis cuadrículas pequeñas (casillas de 4 px): filas = niveles, columnas = Laya y Jev |
| 9 | En resumen | hasta el final | Dos placas con la conclusión y la fuente de los datos |

Cada pantalla entra desde el velo en 250 ms. Los personajes leen mientras se llenan las casillas, sellan si cumplen y ponen ojos en cruz si prometen de más.

## Reglas

- Las cifras salen de las respuestas reales. La cuadrícula es la proporción real escalada a 100; debajo va el número real de respuestas.
- Las cifras publicadas por terceros van siempre marcadas como publicadas y separadas de las medidas.
- Con `?mock` o sin `src/data/medidas.json`, la escena muestra la etiqueta SIMULADO en la barra superior y en el resumen.
- Coma decimal y punto de miles en todas las cifras.
