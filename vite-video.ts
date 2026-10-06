import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

// Recibe el vídeo de cada ejecución, lo guarda en `dir` y lo recodifica a MP4 para redes:
// H.264 a 60 fps constantes, AAC con el volumen normalizado a -16 LUFS e inicio rápido.
// Sin ffmpeg queda el archivo original del navegador.
// Uso en vite.config.ts: plugins: [videoUpload()]

const MAX_VIDEO_BYTES = 1_000_000_000;

function fail(res: ServerResponse, code: number, message: string) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: { message } }));
}

/** Sólo POST y sólo desde la propia página: otra web abierta no puede escribir en el disco. */
function allowed(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  let sameOrigin = !origin;
  try {
    sameOrigin ||= new URL(origin!).host === req.headers.host;
  } catch {}
  if (req.method !== 'POST') fail(res, 405, 'sólo POST');
  else if (!sameOrigin) fail(res, 403, 'origen no permitido');
  else return true;
  return false;
}

export function videoUpload({ route = '/api/video', dir = 'videos' } = {}): Plugin {
  return {
    name: 'video-upload',
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (!allowed(req, res)) return;
        const name = String(req.headers['x-name'] || `video-${Date.now()}`).replace(/[^\w-]/g, '_').slice(0, 100);
        const webm = String(req.headers['content-type'] || '').includes('webm');
        mkdirSync(dir, { recursive: true });
        const raw = `${dir}/${name}.${webm ? 'webm' : 'grabado.mp4'}`;
        const out = `${dir}/${name}.mp4`;
        const file = createWriteStream(raw);
        let bytes = 0;
        req.on('data', (c: Buffer) => {
          bytes += c.length;
          if (bytes <= MAX_VIDEO_BYTES) return;
          req.unpipe(file);
          file.destroy();
          file.on('close', () => rmSync(raw, { force: true }));
          fail(res, 413, 'vídeo demasiado grande');
          req.destroy();
        });
        req.pipe(file);
        file.on('finish', () => {
          const ff = spawn('ffmpeg', [
            '-y', '-loglevel', 'error', '-i', raw,
            // neighbor: sin suavizado al convertir; yuv420p y rango tv para que lo acepten todos los reproductores
            '-vf', 'scale=out_range=tv:flags=neighbor,format=yuv420p', '-color_range', 'tv',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-fps_mode', 'cfr', '-r', '60',
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
            '-movflags', '+faststart', out,
          ]);
          ff.on('error', () => server.config.logger.warn(`[video] sin ffmpeg: queda ${raw}`));
          ff.on('close', (code) => {
            if (code === 0) {
              unlinkSync(raw);
              server.config.logger.info(`[video] ${out}`);
            } else server.config.logger.warn(`[video] ffmpeg falló (${code}); queda ${raw}`);
          });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ file: out }));
        });
      });
    },
  };
}
