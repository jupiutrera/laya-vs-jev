#!/usr/bin/env node
// Lista los colores del código que no pertenecen a la paleta de 16.
// Uso: node check-palette.mjs <carpeta> [#hex permitido extra ...]
// Acepta rgba() de night (velos) y de parchment (destellos).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const PALETTE = [
  '#1a1c2c', '#333c57', '#566c86', '#94b0c2', '#f4f4f4', '#5a3a2a', '#a0683a', '#ef7d57',
  '#38b764', '#b13e53', '#ffcd75', '#5d275d', '#41a6f6', '#73eff7', '#a7f070', '#29366f',
];
const [root = 'src', ...extra] = process.argv.slice(2);
const allowed = new Set([...PALETTE, ...extra.map((c) => c.toLowerCase())]);
const RGBA_OK = /^rgba\(\s*(26\s*,\s*28\s*,\s*44|244\s*,\s*244\s*,\s*244)\s*,/;
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html']);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(extname(p))) files.push(p);
  }
})(root);

let bad = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) {
      const c = m[0].toLowerCase();
      if (c.startsWith('#') ? allowed.has(c) : RGBA_OK.test(c)) continue;
      console.log(`${f}:${i + 1}  ${m[0]}`);
      bad++;
    }
  });
}
console.log(bad ? `\n${bad} color(es) fuera de paleta` : 'Paleta OK');
process.exit(bad ? 1 : 0);
