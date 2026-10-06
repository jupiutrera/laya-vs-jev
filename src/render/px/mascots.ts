import { P } from './palette';

// Monigotes. Jev es el personaje naranja del autor (rejilla 12x16, colores originales).
// Laya está hecha a juego: misma rejilla y visera, azul de la paleta y una antena en aro en vez de
// la chispa. Es un monigote genérico, no el logotipo de nadie.
// Se dibujan a escala x3, con el centro de la base en el punto que se indica.

export type MascotKind = 'jev' | 'laya' | 'laya_td';
export type MascotState = 'idle' | 'reading' | 'stamping' | 'error';

// a contorno, c cuerpo, e sombra del cuerpo, b chispa / agua, d blanco
const JEV_COLORS: Record<string, string> = { a: '#0b222e', b: '#fdd17a', c: '#ff7331', d: '#ffffff', e: '#c44a16' };
const LAYA_COLORS: Record<string, string> = { a: P.night, b: P.cyan, c: P.blue, d: P.parchment, e: P.navy };
// Laya especializada: la misma, en cian
const LAYA_TD_COLORS: Record<string, string> = { a: P.night, b: P.parchment, c: P.cyan, d: P.parchment, e: P.blue };

// Cuerpo sin ojos ni boca (se dibujan aparte para animarlos). Filas 0-4: antena; 5-11: cabeza
// con visera en las filas 7-9; 12-14: base; la fila 15 (propulsión o salpicadura) se anima aparte.
const JEV_BODY = [
  '......aa....',
  '.....aba....',
  '....abbaa...',
  '.....abba...',
  '......aa....',
  '..aaaaaaaa..',
  '.acccccccca.',
  'acaaaaaaaaca',
  'acaaaaaaaaca',
  'acaaaaaaaaca',
  'aeccccccccea',
  '.aeeeeeeeea.',
  '..aaccccaa..',
  '...aeccea...',
  '....aaaa....',
];

const LAYA_BODY = [
  '....aaaa....',
  '...abbbba...',
  '...ab..ba...',
  '....abba....',
  '.....aa.....',
  '..aaaaaaaa..',
  '.acccccccca.',
  'acaaaaaaaaca',
  'acaaaaaaaaca',
  'acaaaaaaaaca',
  'aeccccccccea',
  '.aeeeeeeeea.',
  '..aaccccaa..',
  '...aeccea...',
  '....aaaa....',
];

const BODIES: Record<MascotKind, string[]> = { jev: JEV_BODY, laya: LAYA_BODY, laya_td: LAYA_BODY };
const COLORS: Record<MascotKind, Record<string, string>> = { jev: JEV_COLORS, laya: LAYA_COLORS, laya_td: LAYA_TD_COLORS };

export interface MascotOpts {
  state: MascotState;
  t: number; // segundos (reloj de pantalla)
  since: number; // segundos desde que empezó el estado actual
  stressed: boolean;
  /** Color del sello que aparece bajo el monigote al golpear (rojo si no se indica). */
  sealColor?: string;
  scale?: number;
}

/** Dibuja el monigote centrado en cx y apoyado en bottom. */
export function drawMascot(ctx: CanvasRenderingContext2D, kind: MascotKind, cx: number, bottom: number, o: MascotOpts) {
  const s = o.scale ?? 3;
  const pal = COLORS[kind];
  // Posición según el estado: flota en reposo, salta y golpea al sellar, tiembla al fallar
  let dx = 0;
  let dy = 0;
  if (o.state === 'idle') dy = Math.round(Math.sin(o.t * 3.2) * 1);
  else if (o.state === 'reading') dy = Math.round(Math.sin(o.t * 6) * 0.6);
  else if (o.state === 'stamping') dy = o.since < 0.08 ? -4 : o.since < 0.16 ? 2 : 0;
  else if (o.state === 'error') dx = Math.floor(o.t * 24) % 2 ? 1 : -1;
  const ox = Math.round(cx - 6 * s + dx);
  const oy = Math.round(bottom - 16 * s + dy);
  const px = (cx: number, cy: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + cx * s, oy + cy * s, s, s);
  };

  // Antena: la chispa de Jev y el aro de Laya parpadean
  const flicker = Math.floor(o.t * 7) % 2;
  BODIES[kind].forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      let c = row[rx];
      if (c === '.') continue;
      if (c === 'b' && flicker && ry < 4) c = 'd';
      px(rx, ry, pal[c]);
    }
  });

  // Fila 15: propulsión, con chispas que cambian de sitio
  const pattern = [
    [2, 5, 6, 9],
    [3, 5, 6, 8],
    [2, 4, 7, 9],
  ][Math.floor(o.t * 10) % 3];
  const sparkRow = 15;
  if (o.state !== 'stamping' || o.since > 0.16) for (const sx of pattern) px(sx, sparkRow, pal.b);

  // Ojos y boca en la visera (filas 8 y 9)
  const blink = o.state === 'idle' && o.t % 3.1 < 0.12;
  if (o.state === 'error') {
    // Ojos en cruz y boca torcida
    for (const ex of [2, 8]) {
      px(ex, 7.5, P.red);
      px(ex + 1, 8.5, P.red);
      px(ex + 1, 7.5, P.red);
      px(ex, 8.5, P.red);
    }
    px(4, 9, pal.d);
    px(5, 9.5, pal.d);
    px(6, 9.5, pal.d);
    px(7, 9, pal.d);
  } else if (!blink) {
    // Leyendo: los ojos barren la visera de lado a lado
    const scan = o.state === 'reading' ? [-1, 0, 1, 0][Math.floor(o.t * 6) % 4] : 0;
    px(3 + scan, 8, pal.d);
    px(8 + scan, 8, pal.d);
    if (o.state === 'stamping') {
      px(4, 9, pal.d);
      px(5, 9, pal.d);
      px(6, 9, pal.d);
      px(7, 9, pal.d);
    } else {
      px(5, 9, pal.d);
      px(6, 9, pal.d);
    }
  } else {
    px(5, 9, pal.d);
    px(6, 9, pal.d);
  }

  // Agobio: gotas de sudor a los lados
  if (o.stressed) {
    const d = Math.floor(o.t * 7) % 4;
    ctx.fillStyle = P.cyan;
    ctx.fillRect(ox - 3, oy + 12 + d * 2, 2, 3);
    ctx.fillRect(ox + 12 * s + 1, oy + 16 + ((d + 2) % 4) * 2, 2, 3);
  }

  // Al sellar, el sello aparece bajo el monigote en el golpe
  if (o.state === 'stamping' && o.since >= 0.08 && o.since < 0.26) {
    const sc = o.sealColor ?? P.red;
    ctx.fillStyle = P.night;
    ctx.fillRect(ox + 3 * s - 1, oy + 15 * s - 1, 6 * s + 2, 2 * s + 2);
    ctx.fillStyle = sc;
    ctx.fillRect(ox + 3 * s, oy + 15 * s, 6 * s, 2 * s);
  }
}
