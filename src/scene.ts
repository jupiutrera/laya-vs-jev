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
// escalada a 100 y debajo va el número real de respuestas.

const MODELOS: Modelo[] = ['laya', 'jev'];
const NOMBRE: Record<Modelo, string> = { laya: 'LAYA', jev: 'JEV' };
const COLOR: Record<Modelo, string> = { laya: P.blue, jev: P.fire };

/** Niveles de seguridad declarada, de más a menos. */
const NIVELES = [
  { desde: 0.8, hasta: 1.01, titulo: 'AL 80 % O MÁS', corto: '80 % O MÁS' },
  { desde: 0.6, hasta: 0.8, titulo: 'ENTRE 60 Y 80 %', corto: 'ENTRE 60 Y 80 %' },
  { desde: 0.4, hasta: 0.6, titulo: 'ENTRE 40 Y 60 %', corto: 'ENTRE 40 Y 60 %' },
];

const pct = (x: number) => `${Math.round(x * 100)} %`;
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

const veredicto = (a: Tramo) =>
  Math.abs(a.dice - a.acierta) < 0.06 ? '✓ CUMPLE LO QUE PROMETE' : a.dice > a.acierta ? '✗ PROMETE DE MÁS' : 'PROMETE DE MENOS';

// ---- Pantallas y tiempos (s) ----
const PANTALLAS = [
  { id: 'pregunta', dur: 8 },
  { id: 'prueba', dur: 5 },
  { id: 'nivel0', dur: 11 },
  { id: 'nivel1', dur: 9.5 },
  { id: 'nivel2', dur: 9.5 },
  { id: 'arreglo', dur: 12 },
  { id: 'noticia', dur: 12 },
  { id: 'repaso', dur: 10 },
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
function muestra(ctx: CanvasRenderingContext2D, x: number, y: number, tipo: 'prometida' | 'acierta' | 'falla') {
  if (tipo === 'prometida') cuadricula1(ctx, x, y, P.slate, true);
  else cuadricula1(ctx, x, y, tipo === 'acierta' ? P.green : P.red, tipo === 'falla');
}
function cuadricula1(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, yellow: boolean) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, 8, 8);
  if (yellow) {
    ctx.fillStyle = P.yellow;
    ctx.fillRect(x, y, 8, 1);
    ctx.fillRect(x, y + 7, 8, 1);
    ctx.fillRect(x, y, 1, 8);
    ctx.fillRect(x + 7, y, 1, 8);
  }
}

export class Escena {
  t = 0;
  running = false;
  done = false;
  private last: Id | '' = '';
  private ticked = 0;
  private nivel: Record<Modelo, Tramo[]>;
  private media: Record<Modelo, Record<'de_serie' | 'reajustado', Tramo>>;

  constructor(private d: Datos, private ev: Eventos) {
    const sec = (m: Modelo, e: Estado) => d.secuencias[m][e]!;
    const niveles = (m: Modelo) => NIVELES.map((n) => resumen(sec(m, 'de_serie'), n.desde, n.hasta));
    this.nivel = { laya: niveles('laya'), jev: niveles('jev') };
    this.media = {
      laya: { de_serie: resumen(sec('laya', 'de_serie')), reajustado: resumen(sec('laya', 'reajustado')) },
      jev: { de_serie: resumen(sec('jev', 'de_serie')), reajustado: resumen(sec('jev', 'reajustado')) },
    };
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
        if (nivel >= 0)
          MODELOS.forEach((m, lane) => this.ev.tick(lane, k > Math.round(this.nivel[m][nivel].acierta * 100) ? 1 : 0));
        else this.ev.tick(0, k > Math.round(this.media.laya.reajustado.acierta * 100) ? 1 : 0);
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

  private mascota(ctx: CanvasRenderingContext2D, m: Modelo, cx: number, bottom: number, state: MascotState = 'idle', since = 1) {
    drawMascot(ctx, m, cx, bottom, { state, t: this.t + (m === 'jev' ? 0.7 : 0), since, stressed: false, sealColor: P.yellow });
  }

  private portada(ctx: CanvasRenderingContext2D) {
    bloque(ctx, 'SI UNA IA DICE QUE ESTÁ SEGURA AL 90 %, ¿ACIERTA 9 DE CADA 10?', 50, P.parchment, 3, LW - 60);
    this.mascota(ctx, 'laya', 190, 234);
    this.mascota(ctx, 'jev', 290, 234);
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
      muestra(ctx, 34, 70, 'prometida');
      text(ctx, 'PROMETIDA', 46, 71, P.yellow, { outline: P.night });
    }
    if (t > 4.2) {
      muestra(ctx, 34, 86, 'acierta');
      text(ctx, 'ACIERTA', 46, 87, P.green, { outline: P.night });
      muestra(ctx, 34, 102, 'falla');
      text(ctx, 'FALLA', 46, 103, P.red, { outline: P.night });
    }
    if (t > 5) bloque(ctx, '¿LO CUMPLE?', 158, P.yellow, 3);
    if (t > 6) text(ctx, 'SI LO CUMPLE, SE DICE QUE ESTÁ "CALIBRADA".', LW / 2, 196, P.stoneLight, { outline: P.night, align: 'center' });
  }

  // 2. La prueba
  private prueba(ctx: CanvasRenderingContext2D, t: number) {
    const N = this.d.resultados.modelos.jev.estados.de_serie!.decisiones;
    bloque(ctx, 'LO HEMOS COMPROBADO CON DOS IA', 30, P.parchment, 2);
    bloque(ctx, `LAS MISMAS ${miles(N)} PREGUNTAS PARA LAS DOS`, 54, P.stoneLight, 2);
    const k = easeOut(Math.min(1, t / 0.6));
    MODELOS.forEach((m, i) => {
      const cx = i === 0 ? 140 : 340;
      text(ctx, NOMBRE[m], cx, 90, COLOR[m], { scale: 3, outline: P.night, align: 'center' });
      this.mascota(ctx, m, cx, 234 - Math.round((1 - k) * 20), t > 1 && t < 4 ? 'reading' : 'idle');
    });
    if (t > 1.5) {
      text(ctx, 'CADA RESPUESTA DICE', LW / 2, 140, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, 'CUÁN SEGURA ESTÁ.', LW / 2, 152, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, 'LUEGO MIRAMOS', LW / 2, 170, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, 'SI ACERTÓ.', LW / 2, 182, P.parchment, { outline: P.night, align: 'center' });
    }
  }

  // 3-5. Una pantalla por nivel de seguridad
  private nivelPantalla(ctx: CanvasRenderingContext2D, t: number, n: number) {
    const N = NIVELES[n];
    text(ctx, 'CUANDO DICEN ESTAR SEGURAS', LW / 2, 20, P.parchment, { scale: 1, outline: P.night, align: 'center' });
    text(ctx, N.titulo, LW / 2, 32, P.yellow, { scale: 3, outline: P.night, align: 'center' });
    const llenas = this.llenas(t);
    MODELOS.forEach((m, lane) => {
      const x0 = lane * 240;
      const a = this.nivel[m][n];
      const prometidas = Math.round(a.dice * 100);
      const ok = Math.round(a.acierta * 100);
      const prom = Math.min(prometidas, Math.floor(Math.max(0, t - T_PROMESA) / 0.012));
      text(ctx, NOMBRE[m], x0 + 75, 64, COLOR[m], { scale: 2, outline: P.night, align: 'center' });
      cuadricula(ctx, x0 + 30, 84, 8, prom, ok, llenas);
      const state: MascotState = llenas > 0 && llenas < 100 ? 'reading' : llenas >= 100 && t < T_LLENADO + 4.6 ? (Math.abs(a.dice - a.acierta) < 0.06 ? 'stamping' : 'error') : 'idle';
      this.mascota(ctx, m, x0 + 172, 166, state, t - (T_LLENADO + 4));
      if (t > T_PROMESA + 0.8) text(ctx, `PROMETE ${prometidas} DE 100`, x0 + 172, 64, P.yellow, { outline: P.night, align: 'center' });
      if (llenas >= 100) {
        const col = Math.abs(a.dice - a.acierta) < 0.06 ? P.green : P.red;
        text(ctx, `ACIERTA ${ok} DE 100`, x0 + 120, 186, col, { scale: 2, outline: P.night, align: 'center' });
        if (t > T_LLENADO + 4.4) text(ctx, veredicto(a), x0 + 120, 206, P.parchment, { outline: P.night, align: 'center' });
      }
      text(ctx, `(${miles(a.n)} RESPUESTAS ASÍ)`, x0 + 120, 220, P.stone, { outline: P.night, align: 'center' });
    });
  }

  // 6. ¿Se puede arreglar? Laya corregida promete menos, pero acierta lo mismo
  private arreglo(ctx: CanvasRenderingContext2D, t: number) {
    bloque(ctx, '¿SE PUEDE ARREGLAR A LAYA?', 20, P.parchment, 2);
    text(ctx, 'SÍ: SE LE ENSEÑA A NO PROMETER DE MÁS (CON 200 PREGUNTAS APARTE).', LW / 2, 40, P.stoneLight, { outline: P.night, align: 'center' });
    const A = this.media.laya.de_serie;
    const B = this.media.laya.reajustado;
    const pa = Math.round(A.dice * 100);
    const pb = Math.round(B.dice * 100);
    // Antes: ya conocida, llena desde el principio
    text(ctx, 'ANTES', 115, 58, P.blue, { scale: 2, outline: P.night, align: 'center' });
    cuadricula(ctx, 70, 80, 8, pa, Math.round(A.acierta * 100), 100);
    text(ctx, `PROMETE ${pa} · ACIERTA ${Math.round(A.acierta * 100)}`, 115, 178, P.parchment, { outline: P.night, align: 'center' });
    // Corregida: la promesa encoge de lo de antes a lo de ahora y luego se llena
    const mix = easeInOut(Math.min(1, Math.max(0, (t - 2) / 2)));
    const prom = Math.round(pa + (pb - pa) * mix);
    text(ctx, 'CORREGIDA', 365, 58, P.blue, { scale: 2, outline: P.night, align: 'center' });
    cuadricula(ctx, 320, 80, 8, prom, Math.round(B.acierta * 100), this.llenas(t, 4.5));
    if (t > 4.2) text(ctx, `PROMETE ${pb} · ACIERTA ${Math.round(B.acierta * 100)}`, 365, 178, P.parchment, { outline: P.night, align: 'center' });
    if (t > 2) text(ctx, '→', LW / 2, 120, P.yellow, { scale: 3, outline: P.night, align: 'center' });
    text(ctx, '(DE MEDIA, EN LAS 2.000 PREGUNTAS)', LW / 2, 192, P.stone, { outline: P.night, align: 'center' });
    if (t > 8.6) {
      text(ctx, 'YA NO PROMETE DE MÁS...', LW / 2, 204, P.parchment, { outline: P.night, align: 'center' });
      text(ctx, `PERO SIGUE ACERTANDO ${Math.round(B.acierta * 100)} DE 100`, LW / 2, 216, P.yellow, { scale: 2, outline: P.night, align: 'center' });
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

  // 8. Las seis cuadrículas juntas
  private repaso(ctx: CanvasRenderingContext2D, t: number) {
    text(ctx, 'LAS TRES PRUEBAS JUNTAS', LW / 2, 20, P.parchment, { scale: 2, outline: P.night, align: 'center' });
    const colX: Record<Modelo, number> = { laya: 168, jev: 318 };
    MODELOS.forEach((m) => text(ctx, NOMBRE[m], colX[m] + 48, 40, COLOR[m], { scale: 1, outline: P.night, align: 'center' }));
    NIVELES.forEach((nv, i) => {
      const y = 54 + i * 58;
      if (t < 0.3 + i * 0.4) return;
      text(ctx, 'DICE', 104, y + 14, P.stoneLight, { outline: P.night, align: 'right' });
      text(ctx, nv.corto, 104, y + 26, P.yellow, { outline: P.night, align: 'right' });
      MODELOS.forEach((m) => {
        const a = this.nivel[m][i];
        const ok = Math.round(a.acierta * 100);
        cuadricula(ctx, colX[m], y, 4, Math.round(a.dice * 100), ok, 100);
        const col = Math.abs(a.dice - a.acierta) < 0.06 ? P.green : P.red;
        text(ctx, `ACIERTA`, colX[m] + 56, y + 14, P.parchment, { outline: P.night });
        text(ctx, `${ok} DE 100`, colX[m] + 56, y + 26, col, { outline: P.night });
      });
    });
    if (t > 2) bloque(ctx, 'JEV: LO VERDE SIGUE A LO QUE PROMETE. LAYA: ACIERTA PARECIDO DIGA LO QUE DIGA.', 226, P.yellow, 1, LW - 40);
  }

  // 9. Conclusión
  private final(ctx: CanvasRenderingContext2D, t: number) {
    const L = this.nivel.laya[0];
    const J = this.nivel.jev[0];
    const ML = this.media.laya.reajustado;
    bloque(ctx, 'EN RESUMEN', 22, P.parchment, 2);
    const filas: [Modelo, string, string][] = [
      ['jev', 'JEV CUMPLE LO QUE PROMETE', `CUANDO DICE ESTAR SEGURO (80 % O MÁS), ACIERTA ${Math.round(J.acierta * 100)} DE CADA 100.`],
      ['laya', 'LAYA PROMETE DE MÁS', `CUANDO DICE ESTAR SEGURA, ACIERTA ${Math.round(L.acierta * 100)} DE CADA 100. CORREGIDA YA NO PROMETE DE MÁS, PERO SIGUE ACERTANDO ${Math.round(ML.acierta * 100)} DE CADA 100.`],
    ];
    filas.forEach(([m, titulo, sub], i) => {
      if (t < 0.4 + i * 0.6) return;
      const y = 46 + i * 56;
      plate(ctx, 50, y, 380, 48, P.night, COLOR[m]);
      text(ctx, titulo, 62, y + 7, COLOR[m], { scale: 2 });
      wrap(sub, 356).forEach((l, j) => text(ctx, l, 62, y + 26 + j * 10, P.parchment));
    });
    if (t > 2) bloque(ctx, 'ANTES DE FIARTE DE UNA NOTA DE CALIBRACIÓN, PREGUNTA CUÁNTO ACIERTA Y CÓMO SE HA CALCULADO.', 166, P.yellow, 1, LW - 80);
    const r = this.d.resultados;
    if (t > 3)
      wrap(`DATOS: TYPED-DECISIONS, ${r.test_casos} CASOS, ${miles(r.modelos.jev.estados.de_serie!.decisiones)} PREGUNTAS. JEV 1.13.0 POR API, LAYA EN LOCAL.`, LW - 60).forEach((l, i) =>
        text(ctx, l, LW / 2, 196 + i * 10, P.stone, { outline: P.night, align: 'center' }),
      );
    if (this.d.simulado) tag(ctx, 'SIMULADO', LW / 2 - measure('SIMULADO') / 2, 222);
  }
}
