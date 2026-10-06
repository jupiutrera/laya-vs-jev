// Resolución lógica 480x270 (16:9). El navegador la escala sin suavizado (x4 en 1080p).
export const LW = 480;
export const LH = 270;

// Paleta cerrada de 16 colores (Sweetie 16 con dos marrones para la madera).
export const P = {
  night: '#1a1c2c',
  slate: '#333c57',
  stone: '#566c86',
  stoneLight: '#94b0c2',
  parchment: '#f4f4f4',
  woodDark: '#5a3a2a',
  wood: '#a0683a',
  fire: '#ef7d57',
  green: '#38b764',
  red: '#b13e53',
  yellow: '#ffcd75',
  purple: '#5d275d',
  blue: '#41a6f6',
  cyan: '#73eff7',
  lime: '#a7f070',
  navy: '#29366f',
};

/** Letras de las rejillas de sprites ('.' es transparente). */
export const PIX: Record<string, string> = {
  n: P.night, k: P.slate, s: P.stone, S: P.stoneLight, p: P.parchment, w: P.woodDark, W: P.wood,
  o: P.fire, g: P.green, r: P.red, y: P.yellow, v: P.purple, b: P.blue, c: P.cyan, l: P.lime, N: P.navy,
};

/** Velo que sólo oscurece (portada, pausa, resultados). */
export const veil = (a: number) => `rgba(26,28,44,${a})`;
