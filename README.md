# Laya y Jev: si dice 90 %, ¿acierta 9 de cada 10?

Laya publica un error de calibración (ECE) de 0,466 de fábrica que baja a 0,081 tras reajustar la temperatura. De Jev circulan dos cifras que no coinciden: 0,246 (comparativa de Laya) y 0,144 (tabla de typed-decisions). Este proyecto mide los dos con las mismas preguntas, lo cuenta con cuadrículas de 100 casillas en una escena pixel art y graba el vídeo.

## Qué se mide

- **Conjunto**: [typed-decisions](https://huggingface.co/datasets/LocalLLaMA/typed-decisions), split `test`: 400 casos, 5 preguntas cada uno (sí/no, elección y escala), 2.000 decisiones. Acierto = coincide con la etiqueta del oro.
- **Misma petición a los dos**: `state` + las cinco `questions` del caso, tal cual vienen en el conjunto.
  - Jev: API de TypeSafe, `jev-latest` (respondió `jev-1.13.0`).
  - Laya: `convaiinnovations/laya` con `laya` 0.3.28, en local por CPU.
- **Confianza** = probabilidad de la opción elegida. **ECE** = 10 tramos de igual anchura.
- **Reajuste**: una temperatura por tipo de pregunta y nº de opciones, ajustada en 200 casos de `train` (50 por flujo), nunca vistos en la medida.
- **Laya en tres estados**: sin temperatura, tal como sale (con las temperaturas que trae el modelo) y reajustada.

## Resultados (`datos/resultados.json`)

| | Laya | Jev |
|---|---|---|
| ECE sin temperatura | 0,266 | - |
| ECE tal como sale | 0,175 (IC 95 %: 0,152 a 0,199) | 0,036 (0,023 a 0,054) |
| ECE reajustado | 0,035 | 0,032 |
| Acierta | 36 % | 73 % |
| Dice de media (tal como sale) | 54 % | 75 % |
| Dice de media (reajustado) | 39 % | 74 % |
| Brier (tal como sale) | 0,750 | 0,366 |

La misma tanda de respuestas de Jev, calculada de 7 formas que se usan en la práctica, da un ECE de 0,021 a 0,169. Ninguna reproduce a la vez las tres cifras de la tabla de typed-decisions (uniforme, prior y Jev); el script con el que se calcularon no está publicado.

Limitaciones: un solo conjunto, sintético, cuyo oro sale de un modelo de unos 4B de parámetros. Laya base no está entrenada para este conjunto (su ficha la presenta como base para especializar; existe `laya-typed-decisions`, ajustada en `train`, que no se ha medido aquí). La latencia no es comparable: Laya corre en la CPU de un portátil y Jev por API.

## Cómo reproducirlo

```bash
# Python 3.12
python -m venv .py && .py/Scripts/python -m pip install -r requirements.txt
cp .env.example .env          # TYPESAFE_API_KEY o AI_GATEWAY_API_KEY
.py/Scripts/python medir/conjunto.py          # datos/test.jsonl y datos/ajuste.jsonl
.py/Scripts/python medir/preguntar.py jev     # reanudable
.py/Scripts/python medir/preguntar.py laya    # ~8 s por caso en CPU
.py/Scripts/python medir/analizar.py          # datos/resultados.json y src/data/medidas.json
.py/Scripts/python medir/analizar.py --prueba # comprueba el cálculo del ECE
```

## La escena

```bash
npm install
npm run dev     # http://localhost:5173
```

Espacio (o clic) arranca; R reinicia; A silencia. Dura algo más de un minuto.

Todo se cuenta con cuadrículas de 100 casillas: borde amarillo = lo que promete ("si dice 86 %, promete 86 de 100"), verde con marca = acierta, roja con cruz = falla. Una pantalla por nivel de seguridad declarada (80 % o más, 60-80 %, 40-60 %), el reajuste de Laya, las dos notas publicadas de Jev y un repaso con las seis cuadrículas.

- `?mock`: datos simulados (la escena muestra SIMULADO). Se usan también si falta `src/data/medidas.json`.
- `?norec`: no graba.
- `?t=30&freeze`: salta a un instante y lo congela (para revisar fotogramas).

Los scripts de npm llaman a `node node_modules/...` porque el `&` del nombre de la carpeta rompe los atajos `.cmd` de npm en Windows.

## Vídeo

Cada pasada se graba sola y queda en `videos/` como MP4 H.264 1920x1080 a 60 fps, con el audio normalizado a -16 LUFS (hace falta ffmpeg en el PATH). Arranca con espacio o clic: con `?auto` el navegador no deja sonar el audio y el vídeo sale mudo.

Diseño de la escena: [DESIGN.md](DESIGN.md).
