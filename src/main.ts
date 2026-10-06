import { cargarDatos } from './data';
import { RunRecorder } from './recorder';
import { LH, LW } from './render/px/palette';
import { Escena } from './scene';
import { Sound } from './sound';

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = LW;
canvas.height = LH;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

function resize() {
  const fit = Math.min(window.innerWidth / LW, window.innerHeight / LH);
  const s = fit >= 1 ? Math.floor(fit) : fit;
  canvas.style.width = `${LW * s}px`;
  canvas.style.height = `${LH * s}px`;
}
window.addEventListener('resize', resize);
resize();

const params = new URLSearchParams(location.search);
const datos = cargarDatos();
const sound = new Sound();
sound.muted = params.has('muted');

const escena = new Escena(datos, {
  cartel: () => sound.announce(0),
  tick: (lane, wrong) => sound.tick(lane, wrong),
  knob: (lane) => sound.knob(lane),
  fin: () => {
    sound.end();
    onEnd();
  },
});

// ---- Grabación (el aviso va fuera del lienzo para no salir en el vídeo) ----
const recorder = new RunRecorder(canvas, () => sound.stream());
const recOn = !params.has('norec');
const recBadge = document.getElementById('rec')!;
let uploading = false;
const badge = (txt: string, live = false) => {
  recBadge.textContent = txt;
  recBadge.className = live ? 'live' : txt ? 'info' : '';
};

function onEnd(tailMs = 12000) {
  if (!recorder.recording) return;
  // Temporizador, no requestAnimationFrame: si la pestaña pasa a segundo plano, el vídeo se cierra igual
  window.setTimeout(async () => {
    uploading = true;
    badge('GUARDANDO VÍDEO…');
    const file = await recorder.stop();
    uploading = false;
    badge(file ? `VÍDEO RECIBIDO: CONVIRTIENDO A ${file}` : 'NO SE PUDO GUARDAR EL VÍDEO');
    setTimeout(() => badge(''), 8000);
  }, tailMs);
}

function arrancar() {
  if (escena.running) return;
  sound.unlock();
  escena.start();
  sound.startMusic();
  if (recOn) {
    recorder.start(`calibracion-${datos.simulado ? 'simulado' : 'typed-decisions'}-${Date.now()}`);
    if (recorder.recording) badge('● REC', true);
  }
}

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.key === ' ') arrancar();
  if (e.key === 'r' || e.key === 'R') location.reload();
  if (e.key === 'a' || e.key === 'A') sound.toggleMute();
});
canvas.addEventListener('click', arrancar);
window.addEventListener('beforeunload', (e) => {
  if (recorder.recording || uploading) e.preventDefault();
});
// ?auto arranca solo (sin gesto el navegador no deja sonar el audio: el vídeo sale mudo)
if (params.has('auto')) arrancar();
// ?t=SEGUNDOS salta a ese instante (sin sonido ni grabación) y ?freeze lo deja quieto: para revisar fotogramas
if (params.has('t')) {
  escena.start();
  escena.t = Number(params.get('t')) || 0;
}
const freeze = params.has('freeze');

let prev = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(now - prev, 100) / 1000;
  prev = now;
  if (escena.running && !freeze) escena.t += dt;
  escena.update();
  escena.draw(ctx);
  recorder.frame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
