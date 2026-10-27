/**
 * Synthesised match audio (Web Audio, no asset files): a crowd bed that swells with the danger
 * on the pitch, weather ambience, and one-shot effects for kicks, whistles, goals, saves and so on.
 * The AudioContext is created lazily on the first call after a user gesture, as browsers require.
 */

const MUTE_KEY = 'rs.muted';

type Loop = { src: AudioBufferSourceNode; gain: GainNode };

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crowd: Loop | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private ambience: Loop[] = [];
  private lastKick = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // Storage unavailable: sound on.
    }
  }

  /** Create or wake the audio context. Call from a click/tap handler. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      // A gentle compressor keeps goal roars from clipping on phone speakers.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.makeNoise(2);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // Not persisted.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- building blocks

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Slightly pink noise: softer and more natural than white for crowds and rain.
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.06;
      b1 = 0.6 * b1 + w * 0.5;
      d[i] = (b0 + b1 + w * 0.3) * 0.5;
    }
    return buf;
  }

  private ready(): AudioContext | null {
    return this.ctx && this.master && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** A burst of filtered noise with an attack/decay envelope. */
  private noiseHit(opts: { type: BiquadFilterType; freq: number; q?: number; freqEnd?: number; gain: number; attack: number; decay: number; delay?: number; rate?: number }): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.attack + opts.decay);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.attack + opts.decay + 0.05);
  }

  private tone(opts: { type: OscillatorType; freq: number; freqEnd?: number; gain: number; attack: number; decay: number; delay?: number; vibrato?: number }): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.attack + opts.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    if (opts.vibrato) {
      // The pea in a referee's whistle: fast frequency warble.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = opts.vibrato;
      depth.gain.value = opts.freq * 0.04;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + opts.attack + opts.decay + 0.05);
    }
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + opts.attack + opts.decay + 0.05);
  }

  private loop(type: BiquadFilterType, freq: number, q: number, gain: number, rate = 1): Loop & { filter: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.8);
    src.connect(filter).connect(g).connect(this.master!);
    src.start();
    return { src, gain: g, filter };
  }

  // ---------------------------------------------------------------- match ambience

  /** Start the crowd and the weather beds for a match. */
  startMatch(weather: { rain: number; wind: { x: number; y: number }; heat: number }): void {
    this.unlock();
    if (!this.ctx) return;
    this.stopMatch();
    const crowd = this.loop('bandpass', 520, 0.7, 0.09, 0.9);
    this.crowd = crowd;
    this.crowdFilter = crowd.filter;
    if (weather.rain > 0) {
      this.ambience.push(this.loop('highpass', 2600, 0.5, 0.05 + 0.09 * weather.rain, 1.3));
      this.ambience.push(this.loop('lowpass', 900, 0.4, 0.02 + 0.04 * weather.rain));
    }
    const wind = Math.hypot(weather.wind.x, weather.wind.y);
    if (wind > 0.5) this.ambience.push(this.loop('bandpass', 380, 2.5, 0.025 * wind, 0.5));
    if (weather.heat > 0) this.ambience.push(this.loop('bandpass', 4200, 12, 0.006, 1)); // cicada hiss
  }

  stopMatch(): void {
    const ctx = this.ctx;
    for (const l of [this.crowd, ...this.ambience]) {
      if (!l || !ctx) continue;
      l.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      l.src.stop(ctx.currentTime + 1.5);
    }
    this.crowd = null;
    this.crowdFilter = null;
    this.ambience = [];
  }

  /** 0 = ball in midfield, 1 = attack in the box. The crowd gets louder and brighter. */
  excitement(level: number): void {
    const ctx = this.ready();
    if (!ctx || !this.crowd || !this.crowdFilter) return;
    this.crowd.gain.gain.setTargetAtTime(0.07 + 0.11 * level, ctx.currentTime, 0.6);
    this.crowdFilter.frequency.setTargetAtTime(480 + 380 * level, ctx.currentTime, 0.6);
  }

  // ---------------------------------------------------------------- one-shots

  /** A strike of the ball; power 0..1. Rate-limited so fast-forward doesn't machine-gun. */
  kick(power: number): void {
    const ctx = this.ready();
    if (!ctx || ctx.currentTime - this.lastKick < 0.06) return;
    this.lastKick = ctx.currentTime;
    this.tone({ type: 'sine', freq: 150 + 60 * power, freqEnd: 55, gain: 0.25 + 0.4 * power, attack: 0.003, decay: 0.09 + 0.06 * power });
    this.noiseHit({ type: 'bandpass', freq: 1800, q: 0.8, gain: 0.08 + 0.18 * power, attack: 0.002, decay: 0.05 });
  }

  header(): void {
    this.tone({ type: 'sine', freq: 230, freqEnd: 90, gain: 0.25, attack: 0.003, decay: 0.08 });
    this.noiseHit({ type: 'lowpass', freq: 900, gain: 0.12, attack: 0.002, decay: 0.06 });
  }

  tackle(): void {
    this.tone({ type: 'sine', freq: 110, freqEnd: 45, gain: 0.3, attack: 0.004, decay: 0.14 });
    this.noiseHit({ type: 'lowpass', freq: 600, gain: 0.16, attack: 0.005, decay: 0.16 });
  }

  /** Referee's whistle: short for fouls, two blasts for half-time, three for full-time. */
  whistle(blasts = 1, long = false): void {
    for (let i = 0; i < blasts; i++) {
      const delay = i * (long ? 0.55 : 0.3);
      const len = long && i === blasts - 1 ? 0.75 : 0.2;
      this.tone({ type: 'sine', freq: 2850, gain: 0.13, attack: 0.01, decay: len, delay, vibrato: 34 });
      this.tone({ type: 'sine', freq: 3240, gain: 0.05, attack: 0.01, decay: len, delay, vibrato: 34 });
    }
  }

  /** The crowd erupts. Home goals get the louder roar. */
  goal(home: boolean): void {
    const g = home ? 0.5 : 0.22;
    this.noiseHit({ type: 'bandpass', freq: 700, freqEnd: 1100, q: 0.6, gain: g, attack: 0.25, decay: 3.2 });
    this.noiseHit({ type: 'bandpass', freq: 1600, q: 0.8, gain: g * 0.45, attack: 0.3, decay: 2.6 });
    this.noiseHit({ type: 'lowpass', freq: 300, gain: g * 0.6, attack: 0.15, decay: 1.8 });
    // Net swish.
    this.noiseHit({ type: 'highpass', freq: 3000, gain: 0.1, attack: 0.01, decay: 0.25 });
  }

  /** "Ooh": a near miss or a big save. */
  ooh(strength = 1): void {
    this.noiseHit({ type: 'bandpass', freq: 380, freqEnd: 720, q: 3, gain: 0.18 * strength, attack: 0.2, decay: 1.1 });
    this.noiseHit({ type: 'bandpass', freq: 900, freqEnd: 650, q: 2, gain: 0.08 * strength, attack: 0.3, decay: 1 });
  }

  /** Gloves on ball. */
  save(): void {
    this.noiseHit({ type: 'bandpass', freq: 1200, q: 1.2, gain: 0.25, attack: 0.002, decay: 0.07 });
    this.tone({ type: 'sine', freq: 180, freqEnd: 80, gain: 0.2, attack: 0.002, decay: 0.08 });
    this.ooh(1.1);
  }

  block(): void {
    this.tackle();
    this.ooh(0.6);
  }

  /** Whistle plus the crowd's disapproval. */
  card(red: boolean): void {
    this.whistle(1);
    this.noiseHit({ type: 'bandpass', freq: 240, q: 2, gain: red ? 0.3 : 0.16, attack: 0.3, decay: red ? 1.8 : 1.1, delay: 0.25, rate: 0.7 });
  }

  /** A player's skill fires: a bright rising sparkle over a whoosh. */
  skill(): void {
    this.noiseHit({ type: 'bandpass', freq: 900, freqEnd: 3200, q: 1.5, gain: 0.12, attack: 0.04, decay: 0.3 });
    [988, 1319, 1760].forEach((f, i) => this.tone({ type: 'triangle', freq: f, gain: 0.07, attack: 0.005, decay: 0.25, delay: i * 0.05 }));
  }

  thunder(): void {
    this.noiseHit({ type: 'lowpass', freq: 400, freqEnd: 70, gain: 0.5, attack: 0.04, decay: 3.5, delay: 0.15 + Math.random() * 0.5, rate: 0.5 });
    this.noiseHit({ type: 'lowpass', freq: 1400, freqEnd: 200, gain: 0.25, attack: 0.01, decay: 0.6, delay: 0.1 });
  }

  // ---------------------------------------------------------------- menus

  click(): void {
    this.tone({ type: 'triangle', freq: 880, freqEnd: 660, gain: 0.08, attack: 0.002, decay: 0.05 });
  }

  /** A card turning over; better cards get a brighter chime. */
  reveal(rarity: 'bronze' | 'silver' | 'gold' | 'elite'): void {
    this.noiseHit({ type: 'highpass', freq: 2500, gain: 0.08, attack: 0.01, decay: 0.12 });
    const notes = { bronze: [392, 494], silver: [494, 587, 740], gold: [523, 659, 784, 1047], elite: [587, 740, 880, 1175, 1480] }[rarity];
    notes.forEach((f, i) => this.tone({ type: 'triangle', freq: f, gain: 0.12, attack: 0.01, decay: 0.5 + i * 0.08, delay: 0.06 + i * 0.07 }));
    if (rarity === 'gold' || rarity === 'elite') this.noiseHit({ type: 'bandpass', freq: 800, q: 0.7, gain: 0.15, attack: 0.15, decay: 1.4, delay: 0.2 });
  }

  /** Coins counting up after a match. */
  coin(): void {
    this.tone({ type: 'square', freq: 1320, gain: 0.04, attack: 0.002, decay: 0.06 });
    this.tone({ type: 'square', freq: 1760, gain: 0.04, attack: 0.002, decay: 0.12, delay: 0.05 });
  }
}

export const sound = new SoundEngine();
