import { measure, text } from './font';
import { LH, LW, P, veil } from './palette';

// Piezas comunes de la interfaz: placas planas, formato de cifras, curvas y contador rodante.

// Decimales con coma en todas las cifras, como se escriben en español
export const comma = (s: string) => s.replace('.', ',');
export const fmtSec = (s: number) => comma(s.toFixed(1));
export const fmtMs = (ms: number | null) =>
  ms === null ? '-' : ms < 1000 ? `${Math.round(ms)} MS` : `${comma((ms / 1000).toFixed(ms < 10000 ? 2 : 1))} S`;
export const fmtUsd = (v: number) => (v === 0 ? '$0' : `$${comma(v.toFixed(v < 0.01 ? 5 : 3))}`);
export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Curvas: salida cúbica para lo que entra; entrada-salida para lo que viaja. */
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
export const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);
export const easeInOut = (p: number) => {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Fotograma discreto de una animación a `fps` con `n` fotogramas. */
export const stepFrame = (t: number, fps: number, n: number) => Math.floor(t * fps) % n;

/** Temblor de 1 px durante `durMs`, alternando cada 40 ms. */
export const shakeOffset = (sinceMs: number, durMs = 120) => (sinceMs < durMs ? (Math.floor(sinceMs / 40) % 2 ? 1 : -1) : 0);

/** Hit-stop: durante 34 ms tras un impacto, el tiempo visible se queda en el del impacto. */
export const hitStop = (nowMs: number, impactMs: number | null, durMs = 34) =>
  impactMs !== null && nowMs - impactMs < durMs ? impactMs : nowMs;

/** Placa plana con borde de 1 px. */
export function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge: string = P.night) {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

/** Velo night sobre toda la escena. */
export function cover(ctx: CanvasRenderingContext2D, a: number) {
  ctx.fillStyle = veil(a);
  ctx.fillRect(0, 0, LW, LH);
}

/** Etiqueta neutra: texto parchment sobre placa slate de 11 px (nunca roja). */
export function tag(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  const w = measure(label) + 6;
  plate(ctx, x - 3, y - 2, w, 11, P.slate);
  text(ctx, label, x, y, P.parchment);
}

/** Bocadillo de espera parchment con tres puntos que se encienden en ciclo. */
export function waitBubble(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  plate(ctx, x, y, 30, 13, P.parchment);
  const on = stepFrame(t, 4, 3);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i === on ? P.night : P.stoneLight;
    ctx.fillRect(x + 4 + i * 8, y + 5, 4, 4);
  }
}

/** Color de un tiempo de espera que escala con la urgencia. */
export const waitColor = (s: number) => (s < 1 ? P.parchment : s < 2 ? P.yellow : s < 3 ? P.fire : P.red);

/**
 * Contador con giro de dígitos en celdas de ancho fijo: las cifras se alinean y sólo rueda la que
 * cambia, en 80 ms, para que el número nunca se lea roto.
 */
export class Rolling {
  private shown = '';
  private prev = '';
  private since = -1;

  draw(ctx: CanvasRenderingContext2D, value: number | string, x: number, y: number, color: string, scale: number, t: number) {
    const now = String(value);
    if (!this.shown) this.shown = this.prev = now;
    else if (now !== this.shown) {
      this.prev = this.shown;
      this.shown = now;
      this.since = t;
    }
    const len = Math.max(now.length, this.prev.length);
    const cur = now.padStart(len, ' ');
    const old = this.prev.padStart(len, ' ');
    const cell = 6 * scale;
    const ch = 7 * scale;
    const p = Math.min(1, (t - this.since) / 0.08);
    const off = Math.round(easeOut(p) * (ch + 2));
    const skip = p >= 1 ? len - now.length : 0;
    let cx = x;
    for (let i = skip; i < len; i++) {
      const glyph = (c: string, yy: number) => {
        if (c === ' ') return;
        const dx = Math.round((5 * scale - measure(c, scale)) / 2);
        text(ctx, c, cx + dx, yy, color, { scale, outline: P.night });
      };
      if (p < 1 && old[i] !== cur[i]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - 1, y - 1, cell, ch + 2);
        ctx.clip();
        glyph(old[i], y - off);
        glyph(cur[i], y + ch + 2 - off);
        ctx.restore();
      } else glyph(cur[i], y);
      cx += cell;
    }
    return cx;
  }
}
