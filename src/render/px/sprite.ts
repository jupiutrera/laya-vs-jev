import { P, PIX } from './palette';

// Sprites hechos en código: rejillas de letras (ver PIX) o primitivas de píxel. Todo se cachea.

const cache = new Map<string, HTMLCanvasElement>();

/** Convierte una rejilla de letras en un canvas. `recolor` pinta todo salvo el contorno `k`. */
export function fromGrid(key: string, rows: string[], recolor?: string, pix: Record<string, string> = PIX): HTMLCanvasElement {
  const ck = `${key}|${recolor ?? ''}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = rows.length;
  const ctx = cv.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.') continue;
      ctx.fillStyle = recolor && c !== 'k' ? recolor : pix[c];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  cache.set(ck, cv);
  return cv;
}

/** Dibuja un sprite apoyado en (cx, bottom). */
export function drawGrid(ctx: CanvasRenderingContext2D, key: string, rows: string[], cx: number, bottom: number, recolor?: string) {
  const cv = fromGrid(key, rows, recolor);
  ctx.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(bottom - cv.height));
}

/** Formas de 16x16 para categorías: color + forma + icono, para que se distingan sin color. */
export type Shape = 'circle' | 'square' | 'octagon' | 'triangle';

function inShape(s: Shape, x: number, y: number): boolean {
  const cx = x - 7.5;
  const cy = y - 7.5;
  if (s === 'circle') return cx * cx + cy * cy <= 7.6 * 7.6;
  if (s === 'square') return x >= 1 && x <= 14 && y >= 1 && y <= 14;
  if (s === 'octagon') return Math.abs(cx) + Math.abs(cy) <= 9.2 && Math.abs(cx) <= 7.5 && Math.abs(cy) <= 7.5;
  return y >= 1 && Math.abs(cx) <= (y + 1) / 2 + 0.6;
}

/** Iconos de 8x8 de ejemplo. */
export const ICONS = {
  check: ['........', '.......#', '......##', '#....##.', '##..##..', '.####...', '..##....', '........'],
  cross: ['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'],
  lens: ['.####...', '#....#..', '#....#..', '#....#..', '.####...', '....##..', '.....##.', '......##'],
  bang: ['...##...', '..####..', '..####..', '..####..', '...##...', '........', '...##...', '...##...'],
};

/** Insignia de 16x16 con aro stone-light de 1 px y el icono centrado. */
export function shapeBadge(shape: Shape, fill: string, icon: string[], iconColor: string = P.parchment): HTMLCanvasElement {
  const key = `badge:${shape}:${fill}:${icon.join('')}:${iconColor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inShape(shape, x, y)) continue;
      const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !inShape(shape, x + dx, y + dy));
      ctx.fillStyle = edge ? P.stoneLight : fill;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // El triángulo tiene el centro óptico más abajo
  const oy = shape === 'triangle' ? 6 : 4;
  ctx.fillStyle = iconColor;
  icon.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(4 + x, oy + y, 1, 1);
  });
  cache.set(key, cv);
  return cv;
}

/** Anillo de tinta al golpear: se abre en 4 fotogramas (p de 0 a 1). */
export function drawImpact(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: number, color: string) {
  const f = Math.min(3, Math.floor(p * 4));
  const rr = 4 + f * 3;
  const len = f === 3 ? 1 : 2;
  ctx.fillStyle = color;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + f * 0.2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * 0.7), len, len);
  }
}

/** Humo en abanico hacia arriba (p de 0 a 1). */
export function drawSmoke(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: number) {
  ctx.fillStyle = p < 0.5 ? P.stoneLight : P.stone;
  const s = p < 0.66 ? 3 : 2;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.5;
    const d = 2 + p * 10;
    ctx.fillRect(Math.round(cx + Math.cos(a) * d - s / 2), Math.round(cy + Math.sin(a) * d - s / 2), s, s);
  }
}

/** Gotas de sudor a los lados de una caja (x, y, w). */
export function drawSweat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, t: number) {
  const d = Math.floor(t * 7) % 4;
  ctx.fillStyle = P.cyan;
  ctx.fillRect(x - 3, y + 12 + d * 2, 2, 3);
  ctx.fillRect(x + w + 1, y + 16 + ((d + 2) % 4) * 2, 2, 3);
}
