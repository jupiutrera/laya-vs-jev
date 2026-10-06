// Graba el lienzo en vídeo con el sonido del juego y lo sube al servidor, que lo deja en videos/
// como MP4 listo para redes. El lienzo se copia a 1920x1080 con escala entera y sin suavizado antes
// de codificar, para que el pixel art llegue nítido.

const OUT_W = 1920;
const OUT_H = 1080;
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];

export class RunRecorder {
  private big = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private name = '';
  recording = false;

  constructor(private source: HTMLCanvasElement, private audio: () => MediaStream | null = () => null, private endpoint = '/api/video') {
    this.big.width = OUT_W;
    this.big.height = OUT_H;
    this.bctx = this.big.getContext('2d')!;
    this.bctx.imageSmoothingEnabled = false;
  }

  start(name: string) {
    this.cancel();
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) return;
    const stream = this.big.captureStream(60);
    for (const track of this.audio()?.getAudioTracks() ?? []) stream.addTrack(track);
    this.chunks = [];
    this.name = name;
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 160_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.recording = true;
    this.frame();
  }

  /** Copia el fotograma actual al lienzo grande (llamar al final de cada fotograma del juego). */
  frame() {
    if (!this.recording) return;
    const { width: w, height: h } = this.source;
    // Mayor escala entera que cabe; si el lienzo ya es grande, se ajusta sin más
    const fit = Math.min(OUT_W / w, OUT_H / h);
    const s = fit >= 1 ? Math.floor(fit) : fit;
    const dw = Math.round(w * s);
    const dh = Math.round(h * s);
    if (dw !== OUT_W || dh !== OUT_H) {
      this.bctx.fillStyle = '#1a1c2c';
      this.bctx.fillRect(0, 0, OUT_W, OUT_H);
    }
    this.bctx.drawImage(this.source, Math.floor((OUT_W - dw) / 2), Math.floor((OUT_H - dh) / 2), dw, dh);
  }

  /** Para la grabación y sube el vídeo. Devuelve la ruta final en el servidor o null. */
  async stop(): Promise<string | null> {
    const rec = this.rec;
    if (!rec || !this.recording) return null;
    this.recording = false;
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await done;
    const blob = new Blob(this.chunks, { type: rec.mimeType });
    this.chunks = [];
    this.rec = null;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': rec.mimeType, 'X-Name': this.name },
      body: blob,
    }).catch(() => null);
    return res?.ok ? (await res.json()).file : null;
  }

  /** Descarta una grabación a medias (reinicio o cambio de semilla). */
  cancel() {
    if (!this.rec) return;
    this.recording = false;
    this.rec.ondataavailable = null;
    if (this.rec.state !== 'inactive') this.rec.stop();
    this.rec = null;
    this.chunks = [];
  }
}
