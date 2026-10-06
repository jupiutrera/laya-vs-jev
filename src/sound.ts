// Sonido sintetizado con Web Audio: sin archivos. Cada actor (carril) suena en su lado del estéreo
// (0 a la izquierda, 1 a la derecha) y a volumen moderado para que los dos a la vez no saturen.

// Laya a la izquierda, Laya especializada en el centro, Jev a la derecha
const PAN = [-0.6, 0, 0.6];
const BPM = [96, 112, 132, 156];
// Bajo y arpegio en la menor; ocho corcheas por compás
const BASS = [45, 45, 52, 52, 43, 43, 50, 50];
const ARP = [69, 72, 76, 72, 67, 71, 74, 71];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private nextBeat = 0;
  private beat = 0;
  private timer: number | null = null;
  tempo = BPM[0];
  muted = false;

  /** El navegador sólo deja crear el audio tras un gesto del usuario. */
  unlock() {
    if (this.ctx) return void this.ctx.resume();
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.32;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.12;
    this.music.connect(this.master);
  }

  private tap: MediaStreamAudioDestinationNode | null = null;

  /** Copia de la mezcla final para grabarla junto al vídeo (null hasta el primer gesto). */
  stream(): MediaStream | null {
    if (!this.ctx) return null;
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.master.connect(this.tap);
    }
    return this.tap.stream;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
  }

  private out(lane: number | null): AudioNode {
    if (lane === null || !this.ctx) return this.sfx;
    const p = this.ctx.createStereoPanner();
    p.pan.value = PAN[lane] ?? 0;
    p.connect(this.sfx);
    return p;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, at = 0, slideTo?: number) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private thump(dest: AudioNode, vol = 0.5) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(dest);
    src.start();
  }

  /** Acción acertada: golpe seco y tintineo. Fallida: golpe y nota grave que cae. */
  hit(lane: number, correct: boolean) {
    if (!this.ctx) return;
    const dest = this.out(lane);
    this.thump(dest);
    if (correct) this.tone(1568, 0.09, 'triangle', 0.18, dest, 0.02);
    else this.tone(110, 0.22, 'square', 0.12, dest, 0.02, 82);
  }

  /** Un puñado de fichas cae en la pizarra: clic corto, más grave si hay fallos. */
  tick(lane: number, wrongShare: number) {
    if (!this.ctx) return;
    const dest = this.out(lane);
    this.thump(dest, 0.18);
    this.tone(wrongShare > 0.4 ? 392 : 784, 0.05, 'triangle', 0.06, dest, 0.01);
  }

  /** Se gira el mando de temperatura: tres clics que suben. */
  knob(lane: number) {
    if (!this.ctx) return;
    const dest = this.out(lane);
    [0, 0.12, 0.24].forEach((at, i) => this.tone(330 * (1 + i * 0.25), 0.06, 'square', 0.07, dest, at));
    this.tone(220, 0.6, 'sine', 0.08, dest, 0.3, 440);
  }

  /** Algo se pierde: caída con eco. */
  fall(lane: number) {
    if (!this.ctx) return;
    const dest = this.out(lane);
    for (let i = 0; i < 3; i++) this.tone(440 / (i + 1), 0.28, 'sine', 0.16 / (i + 1), dest, i * 0.14, 110 / (i + 1));
  }

  /** Aviso tipo megafonía al cambiar de fase; la música acelera según BPM. */
  announce(n: number) {
    if (!this.ctx) return;
    this.tempo = BPM[n] ?? BPM[BPM.length - 1];
    for (const [f, v] of [[523, 0.2], [1046, 0.1], [1568, 0.06]] as const) this.tone(f, 1.4, 'sine', v, this.sfx);
  }

  /** Fanfarria final de cuatro notas. */
  end() {
    if (!this.ctx) return;
    this.stopMusic();
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'square', 0.08, this.sfx, i * 0.12));
  }

  startMusic() {
    if (!this.ctx || this.timer !== null) return;
    this.nextBeat = this.ctx.currentTime + 0.05;
    this.beat = 0;
    // Planificador con margen: programa las notas un poco antes de que suenen
    this.timer = window.setInterval(() => {
      const c = this.ctx!;
      while (this.nextBeat < c.currentTime + 0.12) {
        const at = this.nextBeat - c.currentTime;
        const i = this.beat % 8;
        const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
        const len = 60 / this.tempo / 2;
        this.tone(midi(BASS[i]), len * 0.9, 'triangle', 0.5, this.music, at);
        if (this.beat % 2 === 0 || this.tempo > 120) this.tone(midi(ARP[(this.beat + Math.floor(this.beat / 16)) % 8]), len * 0.5, 'square', 0.12, this.music, at);
        this.nextBeat += len;
        this.beat++;
      }
    }, 25);
  }

  stopMusic() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}
