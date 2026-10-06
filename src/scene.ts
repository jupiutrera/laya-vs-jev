import type { Datos, Estado, Modelo, Secuencia } from './data';
import { measure, text, wrap } from './render/px/font';
import { cover, easeInOut, easeOut, plate, stepFrame, tag } from './render/px/kit';
import { drawMascot, type MascotState } from './render/px/mascots';
import { LH, LW, P } from './render/px/palette';

// Versión para público general, contada con cuadrículas de 100 casillas.
//   Borde amarillo  = casilla prometida ("si dice 86 %, promete 86 de 100").
//   Verde con marca = acertó.  Roja con cruz = falló.
//   Prometida y fallada = roja con borde amarillo: ahí se ve lo que promete de más.
// Todo sale de las respuestas reales (src/data/medidas.json); la cuadrícula es la proporción real
// escalada a 100 y debajo va el número real de respuestas. Funciona con dos modelos (Laya y Jev) o
// con tres si hay datos de Laya especializada.

const ORDEN: Modelo[] = ['laya', 'laya_td', 'jev'];
const NOMBRE: Record<Modelo, string> = { laya: 'LAYA', laya_td: 'LAYA', jev: 'JEV' };
const APELLIDO: Record<Modelo, string> = { laya: 'GENERAL', laya_td: 'ESPECIALIZADA', jev: 'GENERAL' };
const COLOR: Record<Modelo, string> = { laya: P.blue, laya_td: P.cyan, jev: P.fire };
const LANE: Record<Modelo, number> = { laya: 0, laya_td: 1, jev: 2 };

/** Niveles de seguridad declarada, de más a menos. */
const NIVELES = [
  { desde: 0.8, hasta: 1.01, titulo: 'AL 80 % O MÁS', corto: '80 % O MÁS' },
  { desde: 0.6, hasta: 0.8, titulo: 'ENTRE 60 Y 80 %', corto: 'ENTRE 60 Y 80 %' },
  { desde: 0.4, hasta: 0.6, titulo: 'ENTRE 40 Y 60 %', corto: 'ENTRE 40 Y 60 %' },
];

const pct = (x: number) => `${Math.round(x * 100)} %`;
const de100 = (x: number) => Math.round(x * 100);
const fmt3 = (x: number) => x.toFixed(3).replace('.', ',');
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

interface Tramo {
  n: number;
  dice: number;
  acierta: number;
}

function resumen(s: Secuencia, desde = 0, hasta = 1.01): Tramo {
  let n = 0;
  let dice = 0;
  let ok = 0;
  s.c.forEach((m, i) => {
    const x = m / 1000;
    if (x >= desde && x < hasta) {
      n++;
      dice += x;
      ok += +s.ok[i];
    }
  });
  return { n, dice: n ? dice / n : 0, acierta: n ? ok / n : 0 };
}

const cumple = (a: Tramo) => Math.abs(a.dice - a.acierta) < 0.06;
/** Verde si cumple; rojo (error) si promete de más; neutro si promete de menos. */
const colorAcierto = (a: Tramo) => (cumple(a) ? P.green : a.dice > a.acierta ? P.red : P.parchment);
const veredicto = (a: Tramo) => (cumple(a) ? '✓ CUMPLE LO QUE PROMETE' : a.dice > a.acierta ? '✗ PROMETE DE MÁS' : 'PROMETE DE MENOS');

// ---- Pantallas y tiempos (s) ----
const PANTALLAS = [
  { id: 'pregunta', dur: 8 },
  { id: 'prueba', dur: 6.5 },
  { id: 'nivel0', dur: 11 },
  { id: 'nivel1', dur: 9.5 },
  { id: 'nivel2', dur: 9.5 },
  { id: 'arreglo', dur: 12 },
  { id: 'noticia', dur: 12 },
  { id: 'repaso', dur: 11 },
  { id: 'final', dur: Infinity },
] as const;
type Id = (typeof PANTALLAS)[number]['id'];

// Tiempos dentro de una pantalla de cuadrícula
const T_PROMESA = 0.5; // empiezan a marcarse las prometidas (1 s en total)
const T_LLENADO = 2; // empiezan a llenarse (una casilla cada 40 ms)
const PASO = 0.04;

export interface Eventos {
  cartel(n: number): void;
  tick(lane: number, wrongShare: number): void;
  knob(lane: number): void;
  fin(): void;
}

// ---- Fondo: laboratorio de noche, contraste bajo ----
let fondo: HTMLCanvasElement | null = null;
function capaFondo(): HTMLCanvasElement {
  if (fondo) return fondo;
  const cv = document.createElement('canvas');
  cv.width = LW;
  cv.height = LH;
  const c = cv.getContext('2d')!;
  const r = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  };
  r(0, 0, LW, LH, P.night);
  for (let y = 14; y < 236; y += 20) r(0, y, LW, 1, P.slate);
  const floor = 236;
  for (let y = floor; y < LH; y += 12)
    for (let x = 0; x < LW; x += 16) {
      if ((x / 16 + (y - floor) / 12) % 2) r(x, y, 16, 12, P.slate);
      r(x, y, 16, 1, P.night);
    }
  r(0, floor, LW, 1, P.stone);
  r(0, 0, LW, 13, P.navy);
  r(0, 13, LW, 1, P.night);
  fondo = cv;
  return cv;
}

/** Texto centrado, partido en líneas si no cabe. Devuelve la y siguiente. */
function bloque(ctx: CanvasRenderingContext2D, str: string, y: number, col: string, scale = 2, maxW = LW - 40, x = LW / 2) {
  const lines = wrap(str, maxW, scale);
  lines.forEach((l, i) => text(ctx, l, x, y + i * (9 * scale + 3), col, { scale, outline: P.night, align: 'center' }));
  return y + lines.length * (9 * scale + 3);
}

/**
 * Cuadrícula de 100 casillas. `prometidas` llevan borde amarillo; las `llenas` primeras se pintan:
 * las `aciertos` primeras en verde con marca, el resto en rojo con cruz. Paso = tamaño + 1 px.
 */
function cuadricula(
  ctx: CanvasRenderingContext2D, gx: number, gy: number, celda: number,
  prometidas: number, aciertos: number, llenas: number,
) {
  const paso = celda + 1;
  plate(ctx, gx - 3, gy - 3, paso * 10 + 5, paso * 10 + 5, P.night, P.slate);
  for (let i = 0; i < 100; i++) {
    const x = gx + (i % 10) * paso;
    const y = gy + Math.floor(i / 10) * paso;
    const prom = i < prometidas;
    const borde = (col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, celda, 1);
      ctx.fillRect(x, y + celda - 1, celda, 1);
      ctx.fillRect(x, y, 1, celda);
      ctx.fillRect(x + celda - 1, y, 1, celda);
    };
    if (i >= llenas) {
      ctx.fillStyle = P.slate;
      ctx.fillRect(x, y, celda, celda);
      if (prom) borde(P.yellow);
      continue;
    }
    const bien = i < aciertos;
    ctx.fillStyle = bien ? P.green : P.red;
    ctx.fillRect(x, y, celda, celda);
    if (prom && !bien) borde(P.yellow);
    if (celda < 7) continue;
    // Icono: marca o cruz, centrado en la casilla
    ctx.fillStyle = P.night;
    const o = Math.floor((celda - 7) / 2);
    if (bien) [[1, 3], [2, 4], [3, 5], [4, 4], [5, 3], [5, 2]].forEach(([a, b]) => ctx.fillRect(x + o + a, y + o + b, 1, 1));
    else
      for (let d = 2; d <= 4; d++) {
        ctx.fillRect(x + o + d, y + o + d, 1, 1);
        ctx.fillRect(x + o + 6 - d, y + o + d, 1, 1);
      }
  }
}

/** Una casilla suelta para las leyendas. */
function muestra(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, amarillo: boolean) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, 8, 8);
  if (!amarillo) return;
  ctx.fillStyle = P.yellow;
  ctx.fillRect(x, y, 8, 1);
  ctx.fillRect(x, y + 7, 8, 1);
  ctx.fillRect(x, y, 1, 8);
  ctx.fillRect(x + 7, y, 1, 8);
}

export class Escena {
  t = 0;
  running = false;
  done = false;
  private last: Id | '' = '';
  private ticked = 0;
  private modelos: Modelo[];
  private nivel: Partial<Record<Modelo, Tramo[]>> = {};
  private media: Partial<Record<Modelo, Record<'de_serie' | 'reajustado', Tramo>>> = {};

  constructor(private d: Datos, private ev: Eventos) {
    this.modelos = ORDEN.filter((m) => d.secuencias[m]?.de_serie && d.secuencias[m]?.reajustado);
    for (const m of this.modelos) {
      const sec = (e: Estado) => d.secuencias[m]![e]!;
      this.nivel[m] = NIVELES.map((n) => resumen(sec('de_serie'), n.desde, n.hasta));
      this.media[m] = { de_serie: resumen(sec('de_serie')), reajustado: resumen(sec('reajustado')) };
    }
  }

  private get lays() {
    return this.modelos.filter((m) => m !== 'jev');
  }

  /** Centro de la columna de cada modelo. */
  private cx(m: Modelo) {
    const w = LW / this.modelos.length;
    return Math.round(w * this.modelos.indexOf(m) + w / 2);
  }

  start() {
    this.running = true;
    this.t = 0;
  }

  private pantalla() {
    let t0 = 0;
    for (let i = 0; i < PANTALLAS.length; i++) {
      const p = PANTALLAS[i];
      if (this.t < t0 + p.dur) return { id: p.id as Id, i, t: this.t - t0 };
      t0 += p.dur;
    }
    return { id: 'final' as Id, i: PANTALLAS.length - 1, t: this.t - t0 };
  }

  /** Casillas llenas a los `t` s de una pantalla de cuadrícula. */
  private llenas(t: number, desde = T_LLENADO) {
    return Math.max(0, Math.min(100, Math.floor((t - desde) / PASO)));
  }

  update() {
    if (!this.running) return;
    const s = this.pantalla();
    if (s.id !== this.last) {
      this.last = s.id;
      this.ticked = 0;
      if (s.id === 'final') {
        this.done = true;
        this.ev.fin();
      } else this.ev.cartel(s.i);
    }
    const nivel = s.id.startsWith('nivel') ? +s.id.slice(5) : -1;
    if (nivel >= 0 || s.id === 'arreglo') {
      const k = this.llenas(s.t, s.id === 'arreglo' ? 4.5 : T_LLENADO);
      if (k >= this.ticked + 5) {
        this.ticked = k;
        const quienes = nivel >= 0 ? this.modelos : this.lays;
        for (const m of quienes) {
          const a = nivel >= 0 ? this.nivel[m]![nivel] : this.media[m]!.reajustado;
          if (a.n) this.ev.tick(LANE[m], k > de100(a.acierta) ? 1 : 0);
        }
      }
    }
    if (s.id === 'arreglo' && s.t >= 2 && this.ticked === 0) {
      this.ticked = 1;
      this.ev.knob(0);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.drawImage(capaFondo(), 0, 0);
    const s = this.pantalla();
    text(ctx, '¿CUMPLEN LO QUE PROMETEN?', 6, 3, P.parchment);
    if (this.d.simulado) tag(ctx, 'SIMULADO', LW - 6 - measure('SIMULADO'), 3);
    else if (this.running) text(ctx, `${s.i + 1} / ${PANTALLAS.length}`, LW - 6, 3, P.stoneLight, { align: 'right' });

    if (!this.running) return this.portada(ctx);
    if (s.id === 'pregunta') this.pregunta(ctx, s.t);
    if (s.id === 'prueba') this.prueba(ctx, s.t);
    if (s.id.startsWith('nivel')) this.nivelPantalla(ctx, s.t, +s.id.slice(5));
    if (s.id === 'arreglo') this.arreglo(ctx, s.t);
    if (s.id === 'noticia') this.noticia(ctx, s.t);
    if (s.id === 'repaso') this.repaso(ctx, s.t);
    if (s.id === 'final') this.final(ctx, s.t);
    // Cada pantalla entra desde el velo en 250 ms
    if (s.t < 0.25) cover(ctx, 1 - easeOut(s.t / 0.25));
  }

  private mascota(ctx: CanvasRenderingContext2D, m: Modelo, cx: number, bottom: number, state: MascotState = 'idle', since = 1, scale = 3) {
    drawMascot(ctx, m, cx, bottom, { state, t: this.t + LANE[m] * 0.7, since, stressed: false, sealColor: P.yellow, scale });
  }

  /** Nombre del modelo en dos líneas: "LAYA" grande y "ESPECIALIZADA" pequeño debajo. */
  private nombre(ctx: CanvasRenderingContext2D, m: Modelo, cx: number, y: number, scale = 2) {
    text(ctx, NOMBRE[m], cx, y, COLOR[m], { scale, outline: P.night, align: 'center' });
    if (this.lays.length > 1 || m !== 'jev') text(ctx, APELLIDO[m], cx, y + 9 * scale + 2, COLOR[m], { outline: P.night, align: 'center' });
  }

  private portada(ctx: CanvasRenderingContext2D) {
    bloque(ctx, 'SI UNA IA DICE QUE ESTÁ SEGURA AL 90 %, ¿ACIERTA 9 DE CADA 10?', 50, P.parchment, 3, LW - 60);
    this.modelos.forEach((m) => this.mascota(ctx, m, this.cx(m), 234));
    if (stepFrame(performance.now() / 1000, 2, 2)) text(ctx, 'PULSA ESPACIO', LW / 2, 150, P.yellow, { scale: 2, outline: P.night, align: 'center' });
  }

  // 1. La pregunta, y cómo se lee una cuadrícula (sólo promesa: aquí no hay resultados)
  private pregunta(ctx: CanvasRenderingContext2D, t: number) {
    bloque(ctx, 'SI UNA IA TE DICE "ESTOY SEGURA AL 90 %"...', 22, P.parchment, 2);
    const prom = Math.min(90, Math.floor(Math.max(0, t - 1) / 0.015));
    if (t > 1) cuadricula(ctx, LW / 2 - 44, 50, 8, prom, 0, 0);
    if (t > 2.6) {
      text(ctx, 'ESTÁ PROMETIENDO', 300, 70, P.parchment, { outline: P.night });
      text(ctx, 'QUE 90 DE 100', 300, 82, P.yellow, { scale: 2, outline: P.night });
      text(ctx, 'LE SALDRÁN BIEN', 300, 100, P.parchment, { outline: P.night });
      muestra(ctx, 34, 70, P.slate, true);
      text(ctx, 'PROMETIDA', 46, 71, P.yellow, { outline: P.night });
    }
    if (t > 4.2) {
      muestra(ctx, 34, 86, P.green, false);
      text(ctx, 'ACIERTA', 46, 87, P.green, { outline: P.night });
      muestra(ctx, 34, 102, P.red, true);
      text(ctx, 'FALLA', 46, 103, P.red, { outline: P.night });
    }
    if (t > 5) bloque(ctx, '¿LO CUMPLE?', 158, P.yellow, 3);
    if (t > 6) text(ctx, 'SI LO CUMPLE, SE DICE QUE ESTÁ "CALIBRADA".', LW / 2, 196, P.stoneLight, { outline: P.night, align: 'center' });
  }

  // 2. La prueba
  private prueba(ctx: CanvasRenderingContext2D, t: number) {
    const N = this.d.resultados.modelos.jev.estados.de_serie!.decisiones;
    const n = this.modelos.length;
    bloque(ctx, `LO HEMOS COMPROBADO CON ${n === 3 ? 'TRES' : 'DOS'} IA`, 24, P.parchment, 2);
    bloque(ctx, `LAS MISMAS ${miles(N)} PREGUNTAS`, 46, P.stoneLight, 2);
    const k = easeOut(Math.min(1, t / 0.6));
    this.modelos.forEach((m) => {
      this.nombre(ctx, m, this.cx(m), 80);
      this.mascota(ctx, m, this.cx(m), 234 - Math.round((1 - k) * 20), t > 1 && t < 4 ? 'reading' : 'idle');
    });
    if (t > 1.5) {
      text(ctx, 'CADA RESPUESTA DICE CUÁN SEGURA ESTÁ.', LW / 2, 120, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, 'LUEGO MIRAMOS SI ACERTÓ.', LW / 2, 132, P.parchment, { outline: P.night, align: 'center' });
    }
    if (t > 3 && this.modelos.includes('laya_td')) {
      text(ctx, 'LAYA ESPECIALIZADA SE ENTRENÓ CON PREGUNTAS', LW / 2, 152, P.cyan, { outline: P.night, align: 'center' });
      text(ctx, 'DE ESTE MISMO TIPO (NO CON ESTAS).', LW / 2, 164, P.cyan, { outline: P.night, align: 'center' });
    }
  }

  // 3-5. Una pantalla por nivel de seguridad
  private nivelPantalla(ctx: CanvasRenderingContext2D, t: number, n: number) {
    const N = NIVELES[n];
    text(ctx, 'CUANDO DICEN ESTAR SEGURAS', LW / 2, 18, P.parchment, { outline: P.night, align: 'center' });
    text(ctx, N.titulo, LW / 2, 28, P.yellow, { scale: 3, outline: P.night, align: 'center' });
    const llenas = this.llenas(t);
    const tres = this.modelos.length === 3;
    this.modelos.forEach((m) => {
      const cx = this.cx(m);
      const a = this.nivel[m]![n];
      const prometidas = de100(a.dice);
      const ok = de100(a.acierta);
      // Con dos modelos, personaje al lado de la cuadrícula; con tres no cabe y va sin él
      const gx = tres ? cx - 44 : cx - 90;
      this.nombre(ctx, m, tres ? cx : cx - 45, 54);
      if (!a.n) {
        bloque(ctx, 'NUNCA DICE ESTAR TAN SEGURA', 130, P.stoneLight, 1, 110, tres ? cx : cx - 45);
        return;
      }
      const prom = Math.min(prometidas, Math.floor(Math.max(0, t - T_PROMESA) / 0.012));
      cuadricula(ctx, gx, 94, 8, prom, ok, llenas);
      if (!tres) {
        const state: MascotState = llenas > 0 && llenas < 100 ? 'reading' : llenas >= 100 && t < T_LLENADO + 4.6 ? (cumple(a) ? 'stamping' : 'error') : 'idle';
        this.mascota(ctx, m, cx + 50, 172, state, t - (T_LLENADO + 4));
      }
      if (t > T_PROMESA + 0.8) text(ctx, `PROMETE ${prometidas} DE 100`, tres ? cx : cx + 50, tres ? 83 : 70, P.yellow, { outline: P.night, align: 'center' });
      if (llenas >= 100) {
        const col = colorAcierto(a);
        text(ctx, 'ACIERTA', cx, 198, P.parchment, { outline: P.night, align: 'center' });
        text(ctx, `${ok} DE 100`, cx, 208, col, { scale: 2, outline: P.night, align: 'center' });
        if (t > T_LLENADO + 4.4) text(ctx, veredicto(a), cx, 226, P.parchment, { outline: P.night, align: 'center' });
      }
      text(ctx, `(${miles(a.n)} RESPUESTAS)`, cx, 188, P.stone, { outline: P.night, align: 'center' });
    });
  }

  // 6. ¿Se puede arreglar? Cada Laya, antes y corregida: promete menos, ¿acierta más?
  private arreglo(ctx: CanvasRenderingContext2D, t: number) {
    const varias = this.lays.length > 1;
    bloque(ctx, varias ? '¿SE PUEDE ARREGLAR A LAYA?' : '¿SE PUEDE ARREGLAR A LAYA?', 20, P.parchment, 2);
    text(ctx, varias ? 'SE AJUSTA CUÁNTO PROMETE, CON 200 PREGUNTAS APARTE.' : 'SÍ: SE LE ENSEÑA A NO PROMETER DE MÁS (CON 200 PREGUNTAS APARTE).', LW / 2, 40, P.stoneLight, { outline: P.night, align: 'center' });
    const mix = easeInOut(Math.min(1, Math.max(0, (t - 2) / 2)));
    const celda = varias ? 6 : 8;
    const lado = (celda + 1) * 10;
    const filaH = lado + 14;
    this.lays.forEach((m, i) => {
      const A = this.media[m]!.de_serie;
      const B = this.media[m]!.reajustado;
      const pa = de100(A.dice);
      const pb = de100(B.dice);
      const y = 56 + i * filaH;
      const x1 = varias ? 130 : 70;
      const x2 = varias ? 250 : 320;
      if (varias) this.nombre(ctx, m, 60, y + lado / 2 - 12, 2);
      else {
        text(ctx, 'ANTES', x1 + lado / 2, y, COLOR[m], { scale: 2, outline: P.night, align: 'center' });
        text(ctx, 'CORREGIDA', x2 + lado / 2, y, COLOR[m], { scale: 2, outline: P.night, align: 'center' });
      }
      const gy = varias ? y : y + 22;
      cuadricula(ctx, x1, gy, celda, pa, de100(A.acierta), 100);
      cuadricula(ctx, x2, gy, celda, Math.round(pa + (pb - pa) * mix), de100(B.acierta), this.llenas(t, 4.5));
      if (t > 2) text(ctx, '→', (x1 + lado + x2) / 2, gy + lado / 2 - 10, P.yellow, { scale: 3, outline: P.night, align: 'center' });
      if (varias) {
        const tx = x2 + lado + 14;
        text(ctx, `PROMETE ${pa} → ${t > 4 ? pb : '…'}`, tx, gy + 16, P.yellow, { outline: P.night });
        text(ctx, `ACIERTA ${de100(A.acierta)} → ${t > 8.5 ? de100(B.acierta) : '…'}`, tx, gy + 30, P.parchment, { outline: P.night });
        if (t > 8.6) {
          const gap = Math.abs(B.dice - B.acierta);
          text(ctx, gap < 0.05 ? 'AHORA CUMPLE' : gap < 0.1 ? 'AHORA CASI CUMPLE' : 'SIGUE SIN CUMPLIR', tx, gy + 46, gap < 0.1 ? P.green : P.red, { outline: P.night });
        }
      } else {
        text(ctx, `PROMETE ${pa} · ACIERTA ${de100(A.acierta)}`, x1 + lado / 2, gy + lado + 8, P.parchment, { outline: P.night, align: 'center' });
        if (t > 4.2) text(ctx, `PROMETE ${pb} · ACIERTA ${de100(B.acierta)}`, x2 + lado / 2, gy + lado + 8, P.parchment, { outline: P.night, align: 'center' });
      }
    });
    if (t > 8.6) {
      text(ctx, 'CORREGIR CAMBIA LO QUE PROMETE...', LW / 2, 214, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, 'LO QUE ACIERTA SIGUE IGUAL', LW / 2, 224, P.yellow, { scale: 1, outline: P.night, align: 'center' });
    }
  }

  // 7. La noticia: dos notas publicadas para Jev que no coinciden
  private noticia(ctx: CanvasRenderingContext2D, t: number) {
    const r = this.d.resultados;
    const v = r.modelos.jev.variantes_de_medida.de_serie!;
    const vals = [v['10_tramos'], v['15_tramos'], v['10_tramos_igual_masa'], v.todas_las_opciones, v.media_por_pregunta_10_tramos, v.media_por_pregunta_15_tramos, v.contra_oro_blando];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pub = r.publicado.jev.map((x) => x.ece);
    bloque(ctx, '¿Y LA NOTICIA?', 20, P.parchment, 2);
    bloque(ctx, 'TODO ESTO SE RESUME EN UNA "NOTA DE ERROR": CUANTO MÁS CERCA DE 0, MÁS CUMPLE LO QUE PROMETE. A JEV LE HAN PUBLICADO DOS QUE NO COINCIDEN.', 40, P.stoneLight, 1, LW - 80);

    pub.forEach((x, i) => {
      if (t < 1.5 + i * 0.3) return;
      const px = i === 0 ? 150 : 270;
      const k = easeOut(Math.min(1, (t - 1.5 - i * 0.3) / 0.3));
      const py = 74 + Math.round((1 - k) * 10);
      plate(ctx, px, py, 60, 34, P.parchment, P.slate);
      text(ctx, 'NOTA', px + 30, py + 5, P.slate, { align: 'center' });
      text(ctx, fmt3(x), px + 30, py + 17, P.night, { scale: 2, align: 'center' });
    });
    if (t > 2.4) text(ctx, 'PUBLICADAS', LW / 2, 88, P.stoneLight, { outline: P.night, align: 'center' });

    if (t > 4) {
      const X0 = 60;
      const W = 360;
      const MAX = 0.3;
      const sx = (x: number) => X0 + Math.round((Math.min(x, MAX) / MAX) * W);
      const y = 156;
      ctx.fillStyle = P.stone;
      ctx.fillRect(X0, y, W + 1, 1);
      for (let i = 0; i <= 6; i++) {
        ctx.fillRect(X0 + (i * W) / 6, y - 2, 1, 5);
        text(ctx, (i * 0.05).toFixed(2).replace('.', ','), X0 + (i * W) / 6, y + 6, P.stone, { align: 'center' });
      }
      const k = easeOut(Math.min(1, (t - 4) / 1.2));
      const a = sx(lo);
      const b = a + Math.round((sx(hi) - a) * k);
      ctx.fillStyle = P.fire;
      ctx.fillRect(a, y - 7, Math.max(1, b - a), 6);
      if (k >= 1) {
        text(ctx, `CON SUS MISMAS RESPUESTAS NOS SALE DE ${fmt3(lo)} A ${fmt3(hi)}`, (a + b) / 2, y - 28, P.fire, { outline: P.night, align: 'center' });
        text(ctx, 'SEGÚN LA FÓRMULA QUE SE USE', (a + b) / 2, y - 18, P.fire, { outline: P.night, align: 'center' });
        pub.forEach((x) => {
          const px = sx(x);
          ctx.fillStyle = P.parchment;
          ctx.fillRect(px, y - 10, 1, 14);
          ctx.fillRect(px - 1, y - 10, 3, 1);
          text(ctx, `NOTA ${fmt3(x)}`, px, y + 17, P.parchment, { outline: P.night, align: 'center' });
        });
      }
    }
    if (t > 7) bloque(ctx, 'LA NOTA CAMBIA SEGÚN CÓMO SE CALCULE. LAS CASILLAS, NO.', 194, P.yellow, 2, LW - 40);
  }

  // 8. Todas las cuadrículas juntas: filas = niveles, columnas = modelos
  private repaso(ctx: CanvasRenderingContext2D, t: number) {
    text(ctx, 'LAS TRES PRUEBAS JUNTAS', LW / 2, 20, P.parchment, { scale: 2, outline: P.night, align: 'center' });
    const n = this.modelos.length;
    const ancho = n === 3 ? 112 : 150;
    const x0 = n === 3 ? 128 : 168;
    const colX = (i: number) => x0 + i * ancho;
    this.modelos.forEach((m, i) => {
      text(ctx, n === 3 && m !== 'jev' ? `${NOMBRE[m]} ${m === 'laya' ? 'GEN.' : 'ESPEC.'}` : NOMBRE[m], colX(i) + 25, 40, COLOR[m], { outline: P.night, align: 'center' });
    });
    NIVELES.forEach((nv, j) => {
      const y = 52 + j * 54;
      if (t < 0.3 + j * 0.4) return;
      text(ctx, 'DICE', x0 - 8, y + 14, P.stoneLight, { outline: P.night, align: 'right' });
      text(ctx, nv.corto, x0 - 8, y + 26, P.yellow, { outline: P.night, align: 'right' });
      this.modelos.forEach((m, i) => {
        const a = this.nivel[m]![j];
        if (!a.n) {
          text(ctx, 'NUNCA', colX(i) + 25, y + 14, P.stone, { outline: P.night, align: 'center' });
          text(ctx, 'TAN SEGURA', colX(i) + 25, y + 26, P.stone, { outline: P.night, align: 'center' });
          return;
        }
        const ok = de100(a.acierta);
        cuadricula(ctx, colX(i), y, 4, de100(a.dice), ok, 100);
        text(ctx, 'ACIERTA', colX(i) + 54, y + 14, P.parchment, { outline: P.night });
        text(ctx, `${ok} DE 100`, colX(i) + 54, y + 26, colorAcierto(a), { outline: P.night });
      });
    });
    if (t > 2) {
      const lineas = ['JEV: LO VERDE SIGUE A LO QUE PROMETE.'];
      lineas.push(this.modelos.includes('laya_td')
        ? 'LAYA GENERAL ACIERTA MENOS DE LO QUE PROMETE. LA ESPECIALIZADA, MÁS.'
        : 'LAYA: ACIERTA PARECIDO DIGA LO QUE DIGA.');
      lineas.forEach((l, i) => text(ctx, l, LW / 2, 214 + i * 10, P.yellow, { outline: P.night, align: 'center' }));
    }
  }

  // 9. Conclusión: una placa por modelo, con frases sacadas de los datos
  private final(ctx: CanvasRenderingContext2D, t: number) {
    bloque(ctx, 'EN RESUMEN', 20, P.parchment, 2);
    const n = this.modelos.length;
    const h = n === 3 ? 44 : 50;
    this.modelos.forEach((m, i) => {
      if (t < 0.4 + i * 0.6) return;
      const alto = this.nivel[m]![0];
      const med = this.media[m]!;
      const titulo = `${NOMBRE[m]}${n === 3 || m !== 'jev' ? ' ' + APELLIDO[m] : ''}: ${alto.n ? (cumple(alto) ? 'CUMPLE LO QUE PROMETE' : alto.dice > alto.acierta ? 'PROMETE DE MÁS' : 'PROMETE DE MENOS') : 'NUNCA SE CREE MUY SEGURA'}`;
      let sub = alto.n ? `CUANDO DICE ESTAR SEGURA (80 % O MÁS), ACIERTA ${de100(alto.acierta)} DE 100. ` : '';
      sub += `EN TOTAL ACIERTA EL ${pct(med.de_serie.acierta)}.`;
      if (m !== 'jev') sub += ` CORREGIDA PASA DE PROMETER ${pct(med.de_serie.dice)} A ${pct(med.reajustado.dice)}.`;
      const y = 40 + i * (h + 6);
      plate(ctx, 30, y, 420, h, P.night, COLOR[m]);
      text(ctx, titulo, 40, y + 6, COLOR[m], { scale: 1 });
      wrap(sub, 400).forEach((l, j) => text(ctx, l, 40, y + 20 + j * 10, P.parchment));
    });
    const yb = 40 + n * (h + 6) + 4;
    if (t > 2) bloque(ctx, 'ANTES DE FIARTE DE UNA NOTA DE CALIBRACIÓN, PREGUNTA CUÁNTO ACIERTA Y CÓMO SE HA CALCULADO.', yb, P.yellow, 1, LW - 80);
    const r = this.d.resultados;
    if (t > 3)
      text(ctx, `DATOS: TYPED-DECISIONS, ${r.test_casos} CASOS, ${miles(r.modelos.jev.estados.de_serie!.decisiones)} PREGUNTAS.`, LW / 2, 224, P.stone, { outline: P.night, align: 'center' });
    
  }
}
