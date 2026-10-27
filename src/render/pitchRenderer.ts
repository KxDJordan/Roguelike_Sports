import * as C from '../sim/constants';
import type { Match, SimPlayer } from '../sim/match';
import type { Fx } from '../sim/stats';
import { Vec, clamp, lerp, lerpVec } from '../sim/vec';
import { inkFor, keeperKits } from '../data/kits';
import { WEATHER, Weather } from '../sim/weather';
import { SKILLS, SkillId } from '../data/skills';
import { skillGlyph } from '../ui/skillIcons';

/** Meters of stadium drawn around the pitch. */
const SURROUND = 14;
/** Resolution of the cached stadium layer, pixels per meter. */
const LAYER_PX = 10;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  spin?: number;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  color: string;
  max: number;
}

interface Floater {
  x: number;
  y: number;
  born: number;
  text: string;
  color: string;
  card?: 'yellow' | 'red';
  /** Skill callout: drawn as a pill in this team colour. */
  skill?: string;
  skillId?: SkillId;
}

interface Streak {
  x: number;
  y: number;
  tx: number;
  ty: number;
  born: number;
  color: string;
  /** Which way a curled pass swings (+1/-1), 0 for straight. */
  curve: number;
}

export type CameraMode = 'full' | 'follow';

/**
 * Broadcast-style match renderer. A cached stadium layer is drawn under a camera that either
 * frames the whole pitch or follows the ball. Landscape screens show the pitch left to right;
 * portrait screens rotate it so the home team attacks up the screen.
 */
export class PitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private baseScale = 1;
  private layer: HTMLCanvasElement;
  private vignette: CanvasGradient | null = null;
  vertical = false;
  showIntent = false;
  camera: CameraMode = 'full';
  weather: Weather = WEATHER.clear;
  /** Called when lightning flashes, so the match screen can play thunder. */
  onLightning: (() => void) | null = null;
  private nextLightning = 0;

  private cam = { x: C.PITCH_L / 2, y: C.PITCH_W / 2, zoom: 1 };
  private s = 1;
  private shakeUntil = 0;
  private flashUntil = 0;
  private flashColor = '#fff';
  private netRipple: { side: 0 | 1; until: number } | null = null;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private streaks: Streak[] = [];
  private trail: Vec[] = [];
  private fxSeen = 0;
  private lastNow = performance.now();
  private ballRoll = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.layer = buildStadium();
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.vertical = this.h > this.w * 1.05;
    const along = C.PITCH_L + 8;
    const across = C.PITCH_W + 8;
    const [wSpan, hSpan] = this.vertical ? [across, along] : [along, across];
    this.baseScale = Math.min(this.w / wSpan, this.h / hSpan);
    this.vignette = this.ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  }

  // ---------------------------------------------------------------- transforms

  /** Pitch meters to CSS pixels. */
  private tx(p: Vec): Vec {
    const { s, cam } = this;
    return this.vertical
      ? { x: this.w / 2 + (p.y - cam.y) * s + this.shx, y: this.h / 2 - (p.x - cam.x) * s + this.shy }
      : { x: this.w / 2 + (p.x - cam.x) * s + this.shx, y: this.h / 2 + (p.y - cam.y) * s + this.shy };
  }

  private shx = 0;
  private shy = 0;

  private worldTransform(): void {
    const { s, cam, dpr } = this;
    const k = s * dpr;
    if (this.vertical) this.ctx.setTransform(0, -k, k, 0, (this.w / 2 - cam.y * s + this.shx) * dpr, (this.h / 2 + cam.x * s + this.shy) * dpr);
    else this.ctx.setTransform(k, 0, 0, k, (this.w / 2 - cam.x * s + this.shx) * dpr, (this.h / 2 - cam.y * s + this.shy) * dpr);
  }

  private screenTransform(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private updateCamera(m: Match, ball: Vec, dt: number): void {
    const follow = this.camera === 'follow';
    const zoomTarget = follow ? (this.vertical ? 1.75 : 2.1) : 1;
    this.cam.zoom = lerp(this.cam.zoom, zoomTarget, Math.min(1, dt * 3));
    this.s = this.baseScale * this.cam.zoom;
    let tx = C.PITCH_L / 2;
    let ty = C.PITCH_W / 2;
    if (follow) {
      const lead = m.ball.vel;
      tx = ball.x + clamp(lead.x * 0.35, -8, 8);
      ty = ball.y + clamp(lead.y * 0.35, -6, 6);
    }
    const k = Math.min(1, dt * (follow ? 2.6 : 4));
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
    // Keep the view inside the stadium.
    const halfX = (this.vertical ? this.h : this.w) / 2 / this.s;
    const halfY = (this.vertical ? this.w : this.h) / 2 / this.s;
    const mx = Math.max(0, C.PITCH_L / 2 + 4 - halfX);
    const my = Math.max(0, C.PITCH_W / 2 + 4 - halfY);
    this.cam.x = clamp(this.cam.x, C.PITCH_L / 2 - mx, C.PITCH_L / 2 + mx);
    this.cam.y = clamp(this.cam.y, C.PITCH_W / 2 - my, C.PITCH_W / 2 + my);
  }

  // ---------------------------------------------------------------- frame

  render(m: Match, alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const ctx = this.ctx;
    const ball = lerpVec(m.ball.prevPos, m.ball.pos, alpha);

    this.consumeFx(m, now);
    this.updateCamera(m, ball, dt);
    const shaking = now < this.shakeUntil;
    const amp = shaking ? ((this.shakeUntil - now) / 600) * 6 : 0;
    this.shx = shaking ? (Math.random() - 0.5) * amp : 0;
    this.shy = shaking ? (Math.random() - 0.5) * amp : 0;

    this.screenTransform();
    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, this.w, this.h);

    this.worldTransform();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer, -SURROUND, -SURROUND, C.PITCH_L + 2 * SURROUND, C.PITCH_W + 2 * SURROUND);
    this.drawGround(now);
    this.drawLines();
    this.drawGoals(now);
    this.drawStreaks(now);
    this.updateParticles(dt);
    this.drawRings(now);

    this.screenTransform();
    if (this.showIntent) this.drawIntent(m, alpha);
    const r = Math.max(5.5, 0.95 * this.s);
    const gk = keeperKits(m.teams[0].color, m.teams[1].color);
    const sorted = [...m.onPitch].sort((a, b) => (this.vertical ? b.pos.x - a.pos.x : a.pos.y - b.pos.y));
    for (const p of sorted) this.drawShadow(p, alpha, r);
    this.drawBall(m, ball, dt, true);
    for (const p of sorted) this.drawPlayer(m, p, alpha, r, p.isGK ? gk[p.team] : m.teams[p.team].color, now);
    this.drawBall(m, ball, dt, false);
    this.drawParticles();
    this.drawFloaters(now);
    if (m.ball.owner !== null) this.drawNameTag(m, m.players[m.ball.owner], alpha, r);

    // Screen-space finish: weather, vignette and flashes.
    this.screenTransform();
    this.drawSky(now);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (now < this.flashUntil) {
      ctx.globalAlpha = ((this.flashUntil - now) / 500) * 0.45;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- weather

  /** World-space surface effects under the lines: wet sheen, snow cover, cloud shadows, splashes. */
  private drawGround(now: number): void {
    const w = this.weather;
    const ctx = this.ctx;
    const t = now / 1000;
    if (w.rain > 0) {
      ctx.fillStyle = `rgba(40,70,110,${0.12 * w.rain})`;
      ctx.fillRect(0, 0, C.PITCH_L, C.PITCH_W);
      // Puddle sheen that catches the floodlights.
      for (let i = 0; i < 7; i++) {
        const x = hash(i * 3.1) * C.PITCH_L;
        const y = hash(i * 7.7) * C.PITCH_W;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 4 + hash(i) * 5);
        g.addColorStop(0, `rgba(190,215,255,${0.1 * w.rain})`);
        g.addColorStop(1, 'rgba(190,215,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 10, y - 10, 20, 20);
      }
      // Splashes: little rings that pop up all over the pitch.
      ctx.strokeStyle = `rgba(220,235,255,${0.35 * w.rain})`;
      ctx.lineWidth = 0.08;
      const n = Math.round(70 * w.rain);
      for (let i = 0; i < n; i++) {
        const cyc = t * 1.7 + hash(i * 1.3);
        const k = Math.floor(cyc);
        const ph = cyc - k;
        const x = hash(i * 9.1 + k * 0.37) * C.PITCH_L;
        const y = hash(i * 4.3 + k * 0.71) * C.PITCH_W;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath();
        ctx.ellipse(x, y, 0.15 + ph * 0.6, 0.1 + ph * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (w.snow > 0) {
      ctx.fillStyle = `rgba(236,242,250,${0.42 * w.snow})`;
      ctx.fillRect(-2, -2, C.PITCH_L + 4, C.PITCH_W + 4);
      // Drifts banked against the boards.
      for (let i = 0; i < 26; i++) {
        const along = hash(i * 2.9);
        const top = i % 2 === 0;
        const x = along * C.PITCH_L;
        const y = top ? -1.5 : C.PITCH_W + 1.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 3 + hash(i * 5.3) * 4);
        g.addColorStop(0, `rgba(250,252,255,${0.55 * w.snow})`);
        g.addColorStop(1, 'rgba(250,252,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 8, y - 8, 16, 16);
      }
    }
    if (w.clouds > 0) {
      // Soft cloud shadows sliding across the grass with the wind.
      const dx = w.wind.x || 1.2;
      const dy = w.wind.y || 0.4;
      for (let i = 0; i < 4; i++) {
        const span = C.PITCH_L + 60;
        const x = ((((hash(i * 6.1) * span + t * dx * 1.5) % span) + span) % span) - 30;
        const y = ((((hash(i * 2.2) * (C.PITCH_W + 40) + t * dy * 1.5) % (C.PITCH_W + 40)) + C.PITCH_W + 40) % (C.PITCH_W + 40)) - 20;
        const r = 16 + hash(i * 8.8) * 14;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,8,20,${0.16 * w.clouds})`);
        g.addColorStop(1, 'rgba(0,8,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }

  /** Screen-space weather over everything: rain, snow, wind, fog, heat haze, gloom and lightning. */
  private drawSky(now: number): void {
    const w = this.weather;
    const ctx = this.ctx;
    const t = now / 1000;
    const W = this.w;
    const H = this.h;
    // Wind direction on screen (the pitch may be rotated).
    const o = this.tx({ x: C.PITCH_L / 2, y: C.PITCH_W / 2 });
    const wp = this.tx({ x: C.PITCH_L / 2 + w.wind.x, y: C.PITCH_W / 2 + w.wind.y });
    const wx = (wp.x - o.x) / Math.max(1, this.s);
    const wy = (wp.y - o.y) / Math.max(1, this.s);

    if (w.gloom > 0) {
      ctx.fillStyle = `rgba(4,8,18,${w.gloom})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (w.heat > 0) {
      ctx.fillStyle = `rgba(255,150,60,${0.07 * w.heat})`;
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.85, -H * 0.1, 0, W * 0.85, -H * 0.1, Math.max(W, H) * 0.8);
      g.addColorStop(0, `rgba(255,230,170,${0.22 * w.heat})`);
      g.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (w.rain > 0) {
      const n = Math.round((W * H) / 2600 * w.rain);
      const fall = 900;
      const slantX = 60 + wx * 40;
      const slantY = fall + wy * 40;
      const len = 0.028;
      ctx.strokeStyle = `rgba(200,220,255,${0.22 + 0.18 * w.rain})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sp = 0.8 + hash(i * 1.9) * 0.5;
        const x = mod(hash(i * 3.7) * W + t * slantX * sp, W + 40) - 20;
        const y = mod(hash(i * 5.3) * H + t * slantY * sp, H + 40) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - slantX * len, y - slantY * len);
      }
      ctx.stroke();
    }
    if (w.snow > 0) {
      const n = Math.round((W * H) / 3200 * w.snow);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) {
        const depth = 0.4 + hash(i * 2.3) * 0.9;
        const x = mod(hash(i * 3.7) * W + t * (12 + wx * 20) * depth + Math.sin(t * 1.3 + i) * 14, W + 20) - 10;
        const y = mod(hash(i * 5.3) * H + t * (34 + wy * 20) * depth, H + 20) - 10;
        ctx.globalAlpha = 0.45 + 0.5 * (depth / 1.3);
        ctx.beginPath();
        ctx.arc(x, y, 0.9 + depth * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const windStr = Math.hypot(w.wind.x, w.wind.y);
    if (windStr > 0.5 && w.rain === 0) {
      // Gusts: faint streaks racing across the screen.
      const n = Math.round(14 * windStr);
      const dir = Math.atan2(wy, wx);
      const cx = Math.cos(dir);
      const cy = Math.sin(dir);
      ctx.strokeStyle = 'rgba(230,240,255,0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sp = 220 + hash(i * 4.1) * 260;
        const d = mod(hash(i * 2.7) * (W + H) + t * sp, W + H + 200) - 100;
        const off = (hash(i * 6.6) - 0.5) * (W + H);
        const x = W / 2 + cx * (d - (W + H) / 2) - cy * off;
        const y = H / 2 + cy * (d - (W + H) / 2) + cx * off;
        const l = 20 + hash(i * 9.2) * 40;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - cx * l * 0.5 + cy * 4, y - cy * l * 0.5 - cx * 4, x - cx * l, y - cy * l);
      }
      ctx.stroke();
    }
    if (w.fog > 0) {
      ctx.fillStyle = `rgba(190,198,208,${0.2 * w.fog})`;
      ctx.fillRect(0, 0, W, H);
      // Banks of mist drifting slowly; thicker towards the edges of the view.
      for (let i = 0; i < 6; i++) {
        const x = mod(hash(i * 3.3) * W * 1.6 + t * (8 + hash(i) * 10), W * 1.6) - W * 0.3;
        const y = hash(i * 7.1) * H;
        const r = Math.max(W, H) * (0.25 + hash(i * 1.7) * 0.25);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(205,212,220,${0.3 * w.fog})`);
        g.addColorStop(1, 'rgba(205,212,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const edge = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      edge.addColorStop(0, 'rgba(200,206,214,0)');
      edge.addColorStop(1, `rgba(200,206,214,${0.55 * w.fog})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, W, H);
    }
    if (w.lightning) {
      if (!this.nextLightning) this.nextLightning = now + 6000 + Math.random() * 10000;
      if (now > this.nextLightning) {
        this.nextLightning = now + 9000 + Math.random() * 16000;
        this.lightningAt = now;
        this.onLightning?.();
      }
      const since = now - this.lightningAt;
      if (since < 650) {
        // Two quick strobes then a fading afterglow.
        const a = since < 70 ? 0.75 : since < 140 ? 0.1 : since < 210 ? 0.55 : 0.4 * (1 - (since - 210) / 440);
        ctx.fillStyle = `rgba(225,232,255,${Math.max(0, a)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  private lightningAt = -1e9;

  // ---------------------------------------------------------------- pitch

  private drawLines(): void {
    const ctx = this.ctx;
    const L = C.PITCH_L;
    const W = C.PITCH_W;
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = Math.max(0.12, 1.4 / this.s);
    ctx.lineJoin = 'round';
    ctx.strokeRect(0, 0, L, W);
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);
    ctx.lineTo(L / 2, W);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(L / 2, W / 2, C.CIRCLE_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(L / 2, W / 2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [0, 1]) {
      const x0 = side ? L - C.BOX_DEPTH : 0;
      ctx.strokeRect(x0, (W - C.BOX_W) / 2, C.BOX_DEPTH, C.BOX_W);
      const x6 = side ? L - C.SIX_DEPTH : 0;
      ctx.strokeRect(x6, (W - C.SIX_W) / 2, C.SIX_DEPTH, C.SIX_W);
      const spot = side ? L - C.PEN_SPOT : C.PEN_SPOT;
      ctx.beginPath();
      ctx.arc(spot, W / 2, 0.25, 0, Math.PI * 2);
      ctx.fill();
      const a = Math.acos((C.BOX_DEPTH - C.PEN_SPOT) / C.CIRCLE_R);
      ctx.beginPath();
      if (side) ctx.arc(spot, W / 2, C.CIRCLE_R, Math.PI - a, Math.PI + a);
      else ctx.arc(spot, W / 2, C.CIRCLE_R, -a, a);
      ctx.stroke();
    }
    // Corner arcs and flags.
    for (const [cx, cy, a0] of [
      [0, 0, 0],
      [L, 0, Math.PI / 2],
      [L, W, Math.PI],
      [0, W, -Math.PI / 2],
    ] as [number, number, number][]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1, a0, a0 + Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd60a';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (cx ? -0.2 : 0.2), cy + (cy ? -1.4 : 1.4));
      ctx.lineTo(cx + (cx ? -1.1 : 1.1), cy + (cy ? -0.9 : 0.9));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
    }
  }

  private drawGoals(now: number): void {
    const ctx = this.ctx;
    const depth = 2;
    for (const side of [0, 1] as const) {
      const x = side ? C.PITCH_L : -depth;
      const ripple = this.netRipple && this.netRipple.side === side && now < this.netRipple.until ? (this.netRipple.until - now) / 900 : 0;
      // Net
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, C.GOAL_Y0, depth, C.GOAL_W);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(0.04, 0.6 / this.s);
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const y = C.GOAL_Y0 + (C.GOAL_W * i) / 8;
        const bulge = ripple * Math.sin(i * 1.3 + now / 40) * 0.5;
        ctx.moveTo(x + (side ? 0 : depth), y);
        ctx.lineTo(x + (side ? depth : 0) + (side ? bulge : -bulge), y);
      }
      for (let i = 0; i <= 3; i++) {
        const xx = x + (depth * i) / 3;
        ctx.moveTo(xx, C.GOAL_Y0);
        ctx.lineTo(xx, C.GOAL_Y1);
      }
      ctx.stroke();
      // Frame
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = Math.max(0.2, 2.2 / this.s);
      ctx.beginPath();
      const lineX = side ? C.PITCH_L : 0;
      const backX = side ? C.PITCH_L + depth : -depth;
      ctx.moveTo(lineX, C.GOAL_Y0);
      ctx.lineTo(backX, C.GOAL_Y0);
      ctx.lineTo(backX, C.GOAL_Y1);
      ctx.lineTo(lineX, C.GOAL_Y1);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (const y of [C.GOAL_Y0, C.GOAL_Y1]) {
        ctx.beginPath();
        ctx.arc(lineX, y, 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- players and ball

  private drawShadow(p: SimPlayer, alpha: number, r: number): void {
    const ctx = this.ctx;
    const c = this.tx(lerpVec(p.prevPos, p.pos, alpha));
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(c.x + r * 0.35, c.y + r * 0.45, r * 1.05, r * 0.8, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPlayer(m: Match, p: SimPlayer, alpha: number, r0: number, color: string, now: number): void {
    const ctx = this.ctx;
    const pos = lerpVec(p.prevPos, p.pos, alpha);
    const c = this.tx(pos);
    const speed = Math.hypot(p.vel.x, p.vel.y);
    const r = r0 * (1 + (speed > 1 ? 0.035 * Math.sin(now / 70 + p.id * 1.7) : 0));
    const carrier = m.ball.owner === p.id;

    if (carrier) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 3 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Facing: toward movement, or toward the ball when standing.
    let fx = p.vel.x;
    let fy = p.vel.y;
    if (speed < 0.6) {
      fx = m.ball.pos.x - p.pos.x;
      fy = m.ball.pos.y - p.pos.y;
    }
    const fl = Math.hypot(fx, fy) || 1;
    const fdir = this.vertical ? { x: fy / fl, y: -fx / fl } : { x: fx / fl, y: fy / fl };

    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r * 1.1);
    g.addColorStop(0, shade(color, 0.35));
    g.addColorStop(0.55, color);
    g.addColorStop(1, shade(color, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    // Facing notch.
    ctx.fillStyle = inkFor(color) === '#fff' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    const tip = { x: c.x + fdir.x * (r + 3.5), y: c.y + fdir.y * (r + 3.5) };
    const side = { x: -fdir.y, y: fdir.x };
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(c.x + fdir.x * r + side.x * r * 0.45, c.y + fdir.y * r + side.y * r * 0.45);
    ctx.lineTo(c.x + fdir.x * r - side.x * r * 0.45, c.y + fdir.y * r - side.y * r * 0.45);
    ctx.closePath();
    ctx.fill();

    if (r >= 7) {
      ctx.fillStyle = inkFor(color);
      ctx.font = `800 ${Math.round(r * 1.0)}px 'Barlow Condensed', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.data.number), c.x, c.y + 0.5);
    }
    if (p.yellows > 0) {
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(c.x + r * 0.55, c.y - r * 1.25, r * 0.42, r * 0.58);
    }
  }

  private drawNameTag(m: Match, p: SimPlayer, alpha: number, r: number): void {
    const ctx = this.ctx;
    const c = this.tx(lerpVec(p.prevPos, p.pos, alpha));
    const name = p.data.name.split(' ').slice(-1)[0].toUpperCase();
    ctx.font = `700 11px 'Barlow Condensed', system-ui, sans-serif`;
    const tw = ctx.measureText(name).width + 12;
    const x = c.x - tw / 2;
    const y = c.y - r - 22;
    ctx.fillStyle = 'rgba(8,12,18,0.82)';
    roundRect(ctx, x, y, tw, 16, 8);
    ctx.fill();
    ctx.fillStyle = m.teams[p.team].color;
    ctx.fillRect(x + 6, y + 13, tw - 12, 2);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, c.x, y + 7.5);
  }

  private drawBall(m: Match, ball: Vec, dt: number, shadowPass: boolean): void {
    const ctx = this.ctx;
    const b = m.ball;
    const h = b.height;
    const c = this.tx(ball);
    const r = Math.max(3.2, 0.5 * this.s) * (1 + h * 0.05);
    const lift = h * this.s * 0.55;
    if (shadowPass) {
      ctx.fillStyle = `rgba(0,0,0,${0.35 - Math.min(0.2, h * 0.025)})`;
      ctx.beginPath();
      ctx.ellipse(c.x + lift * 0.35, c.y + lift * 0.2, r * (1 + h * 0.06), r * 0.7 * (1 + h * 0.06), 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const speed = Math.hypot(b.vel.x, b.vel.y);
    this.ballRoll += (speed * dt) / 0.11;
    // Motion trail
    this.trail.push({ x: c.x, y: c.y - lift });
    if (this.trail.length > 10) this.trail.shift();
    if (speed > 9 && b.owner === null) {
      const shot = !!b.shot;
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1];
        const q = this.trail[i];
        ctx.strokeStyle = shot ? `rgba(255,220,120,${(i / this.trail.length) * 0.75})` : `rgba(255,255,255,${(i / this.trail.length) * 0.45})`;
        ctx.lineWidth = r * 1.6 * (i / this.trail.length);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
    const by = c.y - lift;
    const g = ctx.createRadialGradient(c.x - r * 0.3, by - r * 0.35, r * 0.1, c.x, by, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#cfd6de');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, by, r, 0, Math.PI * 2);
    ctx.fill();
    // Panels that roll with the ball.
    ctx.fillStyle = 'rgba(20,24,30,0.85)';
    for (let i = 0; i < 3; i++) {
      const a = this.ballRoll + (i * Math.PI * 2) / 3;
      const px = c.x + Math.cos(a) * r * 0.5;
      const py = by + Math.sin(a) * r * 0.5 * Math.cos(this.ballRoll * 0.5);
      ctx.beginPath();
      ctx.arc(px, py, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(c.x, by, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawIntent(m: Match, alpha: number): void {
    const ctx = this.ctx;
    for (const p of m.onPitch) {
      if (p.action !== 'run' && p.action !== 'press' && p.action !== 'dribble' && p.action !== 'block' && p.action !== 'box') continue;
      const a = this.tx(lerpVec(p.prevPos, p.pos, alpha));
      const b = this.tx(p.target);
      ctx.strokeStyle =
        p.action === 'press' ? 'rgba(255,90,90,0.9)' : p.action === 'block' ? 'rgba(96,165,250,0.9)' : p.action === 'box' ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.7)';
      ctx.setLineDash(p.action === 'run' || p.action === 'box' ? [5, 4] : []);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- effects

  private consumeFx(m: Match, now: number): void {
    for (const f of freshFx(m, this.fxSeen)) this.spawn(m, f, now);
    this.fxSeen = m.fxTotal;
  }

  private spawn(m: Match, f: Fx, now: number): void {
    const color = m.teams[f.team].color;
    switch (f.type) {
      case 'pass':
        if (f.tx !== undefined && f.ty !== undefined) this.streaks.push({ x: f.x, y: f.y, tx: f.tx, ty: f.ty, born: now, color, curve: f.curve ?? 0 });
        break;
      case 'shot':
        this.rings.push({ x: f.x, y: f.y, born: now, life: 350, color: 'rgba(255,220,120,0.9)', max: 2.5 });
        break;
      case 'tackle':
        this.burst(f.x, f.y, 10, ['#c8b48a', '#e7dcc0', '#ffffff'], 6, 0.12);
        break;
      case 'block':
        this.rings.push({ x: f.x, y: f.y, born: now, life: 450, color: 'rgba(255,255,255,0.95)', max: 3.5 });
        this.burst(f.x, f.y, 12, ['#ffffff', '#93c5fd'], 9, 0.12);
        this.floaters.push({ x: f.x, y: f.y, born: now, text: 'BLOCKED', color: '#93c5fd' });
        break;
      case 'save':
        this.rings.push({ x: f.x, y: f.y, born: now, life: 550, color: 'rgba(34,211,238,0.95)', max: 4 });
        this.floaters.push({ x: f.x, y: f.y, born: now, text: 'SAVE!', color: '#67e8f9' });
        break;
      case 'header':
        this.rings.push({ x: f.x, y: f.y, born: now, life: 300, color: 'rgba(255,255,255,0.7)', max: 2 });
        break;
      case 'foul':
        this.floaters.push({ x: f.x, y: f.y, born: now, text: 'FOUL', color: '#fca5a5' });
        break;
      case 'card':
        this.floaters.push({ x: f.x, y: f.y, born: now, text: '', color: '#fff', card: f.red ? 'red' : 'yellow' });
        break;
      case 'skill':
        this.rings.push({ x: f.x, y: f.y, born: now, life: 600, color: 'rgba(255,214,10,0.95)', max: 4.5 });
        this.burst(f.x, f.y, 18, ['#ffd60a', '#ffffff', color], 8, 0.14);
        this.floaters.push({ x: f.x, y: f.y, born: now, text: (f.label ?? '').toUpperCase(), color: '#fff', skill: color, skillId: f.skill });
        break;
      case 'goal': {
        this.burst(f.x, f.y, 140, [color, shade(color, 0.4), '#ffffff', '#ffd60a'], 22, 0.25, true);
        this.flashUntil = now + 500;
        this.flashColor = color;
        this.shakeUntil = now + 600;
        this.netRipple = { side: f.x > C.PITCH_L / 2 ? 1 : 0, until: now + 900 };
        break;
      }
      default:
        break;
    }
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, size: number, confetti = false): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        max: confetti ? 1.4 + Math.random() * 1.2 : 0.35 + Math.random() * 0.35,
        color: colors[i % colors.length],
        size: confetti ? 0.35 + Math.random() * 0.35 : size + Math.random() * size,
        spin: confetti ? Math.random() * 6 : undefined,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-3 * dt);
      p.vx *= drag;
      p.vy *= drag;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const c = this.tx(p);
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      const sz = p.size * this.s;
      if (p.spin !== undefined) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(p.spin * p.life * 3);
        ctx.fillRect(-sz, -sz * 0.5, sz * 2, sz);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(1, sz), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawRings(now: number): void {
    const ctx = this.ctx;
    this.rings = this.rings.filter((r) => now - r.born < r.life);
    for (const r of this.rings) {
      const t = (now - r.born) / r.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(0.1, (2.5 * (1 - t)) / this.s);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 0.4 + r.max * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawStreaks(now: number): void {
    const ctx = this.ctx;
    this.streaks = this.streaks.filter((s) => now - s.born < 500);
    for (const s of this.streaks) {
      const t = (now - s.born) / 500;
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(0.12, 2 / this.s);
      ctx.setLineDash([0.8, 0.6]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      if (s.curve) {
        // Bend the streak like the ball: the control point sits off the chord on the side it swings
        // out to (matches the sim's 0.35 rad launch angle).
        const dx = s.tx - s.x;
        const dy = s.ty - s.y;
        const k = 0.5 * Math.tan(0.35) * s.curve;
        ctx.globalAlpha = 0.6 * (1 - t);
        ctx.strokeStyle = '#ffd60a';
        ctx.quadraticCurveTo(s.x + dx / 2 - dy * k, s.y + dy / 2 + dx * k, s.tx, s.ty);
      } else ctx.lineTo(s.tx, s.ty);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawFloaters(now: number): void {
    const ctx = this.ctx;
    this.floaters = this.floaters.filter((f) => now - f.born < (f.skill ? 1900 : 1300));
    for (const f of this.floaters) {
      const t = (now - f.born) / (f.skill ? 1900 : 1300);
      const c = this.tx(f);
      const y = c.y - 18 - t * 26;
      ctx.globalAlpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      if (f.skill) {
        // Skill callout: a pill in the team's colour with a gold edge. The icon sits in its own
        // fixed-size badge on the left and only the plain name is measured, so emoji widths
        // (which canvas measures unreliably) can't push the text out of the pill.
        const pop = t < 0.08 ? 0.6 + (t / 0.08) * 0.55 : t < 0.14 ? 1.15 - ((t - 0.08) / 0.06) * 0.15 : 1;
        const H = 24;
        const badge = 18;
        const pad = 3;
        const gap = 6;
        ctx.save();
        ctx.translate(c.x, y - 8);
        ctx.scale(pop, pop);
        ctx.font = `900 13px 'Barlow Condensed', system-ui, sans-serif`;
        const w = pad + badge + gap + ctx.measureText(f.text).width + 10;
        const left = -w / 2;
        roundRect(ctx, left, -H / 2, w, H, H / 2);
        ctx.fillStyle = f.skill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd60a';
        ctx.stroke();
        // Icon badge.
        const bx = left + pad + badge / 2;
        ctx.beginPath();
        ctx.arc(bx, 0, badge / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,12,20,0.55)';
        ctx.fill();
        const glyph = f.skillId ? skillGlyph(f.skillId) : null;
        if (glyph) ctx.drawImage(glyph, bx - badge * 0.38, -badge * 0.38, badge * 0.76, badge * 0.76);
        else if (f.skillId) {
          ctx.font = `11px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText(SKILLS[f.skillId].icon, bx, 1);
          ctx.font = `900 13px 'Barlow Condensed', system-ui, sans-serif`;
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = inkFor(f.skill);
        ctx.fillText(f.text, left + pad + badge + gap, 1);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      } else if (f.card) {
        const pop = Math.min(1, t * 6);
        ctx.fillStyle = f.card === 'red' ? '#ef4444' : '#facc15';
        ctx.save();
        ctx.translate(c.x, y);
        ctx.rotate(-0.15);
        ctx.scale(pop, pop);
        roundRect(ctx, -7, -10, 14, 20, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.font = `800 14px 'Barlow Condensed', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(f.text, c.x, y);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, c.x, y);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- helpers

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => Math.round(clamp(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt), 0, 255));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Pre-render the static stadium: stands, crowd, advertising boards, apron and mown grass. */
function buildStadium(): HTMLCanvasElement {
  const Lt = C.PITCH_L + 2 * SURROUND;
  const Wt = C.PITCH_W + 2 * SURROUND;
  const cv = document.createElement('canvas');
  cv.width = Math.round(Lt * LAYER_PX);
  cv.height = Math.round(Wt * LAYER_PX);
  const ctx = cv.getContext('2d')!;
  ctx.scale(LAYER_PX, LAYER_PX);
  ctx.translate(SURROUND, SURROUND);
  // Deterministic speckle so the stadium looks the same every time.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Stands
  ctx.fillStyle = '#0d131b';
  ctx.fillRect(-SURROUND, -SURROUND, Lt, Wt);
  const crowd = ['#e63946', '#f1f5f9', '#3a86ff', '#ffbe0b', '#1f2937', '#94a3b8', '#06d6a0', '#f97316'];
  for (let i = 0; i < 9000; i++) {
    const x = -SURROUND + rnd() * Lt;
    const y = -SURROUND + rnd() * Wt;
    if (x > -6.5 && x < C.PITCH_L + 6.5 && y > -6.5 && y < C.PITCH_W + 6.5) continue;
    ctx.fillStyle = crowd[Math.floor(rnd() * crowd.length)];
    ctx.globalAlpha = 0.35 + rnd() * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, 0.22 + rnd() * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Stand tiers
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.15;
  for (let k = 7.5; k < SURROUND; k += 2) ctx.strokeRect(-k, -k, C.PITCH_L + 2 * k, C.PITCH_W + 2 * k);

  // Apron
  ctx.fillStyle = '#1f6b31';
  ctx.fillRect(-6, -6, C.PITCH_L + 12, C.PITCH_W + 12);

  // Advertising boards
  const boards = ['#e63946', '#0ea5e9', '#111827', '#ffbe0b', '#22c55e', '#8338ec'];
  const words = ['ROGUELIKE', 'SPORTS', 'TACTICS', 'MATCHDAY', 'PRESS', 'GEGEN'];
  const boardRun = (x0: number, y0: number, len: number, horizontal: boolean) => {
    const seg = 10;
    for (let s = 0; s * seg < len; s++) {
      const i = s % boards.length;
      ctx.fillStyle = boards[i];
      const l = Math.min(seg, len - s * seg);
      if (horizontal) ctx.fillRect(x0 + s * seg, y0, l, 0.9);
      else ctx.fillRect(x0, y0 + s * seg, 0.9, l);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 0.62px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (horizontal) ctx.fillText(words[i], x0 + s * seg + l / 2, y0 + 0.47);
      else {
        ctx.translate(x0 + 0.45, y0 + s * seg + l / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(words[i], 0, 0);
      }
      ctx.restore();
    }
  };
  boardRun(-5, -5, C.PITCH_L + 10, true);
  boardRun(-5, C.PITCH_W + 4.1, C.PITCH_L + 10, true);
  boardRun(-5, -5, C.PITCH_W + 10, false);
  boardRun(C.PITCH_L + 4.1, -5, C.PITCH_W + 10, false);

  // Grass: mown stripes along the length plus a faint cross-hatch.
  const pad = 3;
  ctx.fillStyle = '#2b8239';
  ctx.fillRect(-pad, -pad, C.PITCH_L + 2 * pad, C.PITCH_W + 2 * pad);
  const stripes = 18;
  const sw = (C.PITCH_L + 2 * pad) / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2f8c3e' : '#287a35';
    ctx.fillRect(-pad + i * sw, -pad, sw + 0.02, C.PITCH_W + 2 * pad);
  }
  ctx.globalAlpha = 0.05;
  const cross = 10;
  const ch = (C.PITCH_W + 2 * pad) / cross;
  for (let i = 0; i < cross; i += 2) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-pad, -pad + i * ch, C.PITCH_L + 2 * pad, ch);
  }
  ctx.globalAlpha = 1;
  // Turf speckle
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(-pad + rnd() * (C.PITCH_L + 2 * pad), -pad + rnd() * (C.PITCH_W + 2 * pad), 0.18, 0.18);
  }
  // Worn goalmouths
  for (const gx of [1.5, C.PITCH_L - 1.5]) {
    const g = ctx.createRadialGradient(gx, C.PITCH_W / 2, 0, gx, C.PITCH_W / 2, 7);
    g.addColorStop(0, 'rgba(120,100,60,0.35)');
    g.addColorStop(1, 'rgba(120,100,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - 7, C.PITCH_W / 2 - 7, 14, 14);
  }
  // Floodlight pools
  for (const [lx, ly] of [
    [0, 0],
    [C.PITCH_L, 0],
    [0, C.PITCH_W],
    [C.PITCH_L, C.PITCH_W],
  ]) {
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 55);
    g.addColorStop(0, 'rgba(255,255,230,0.08)');
    g.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-pad, -pad, C.PITCH_L + 2 * pad, C.PITCH_W + 2 * pad);
  }
  return cv;
}

/** Stable pseudo-random 0..1 from a number (for stateless weather particles). */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Effects the match has emitted since a consumer last saw `seen` of them in total. */
export function freshFx(m: Match, seen: number): Fx[] {
  const n = m.fxTotal < seen ? m.fx.length : Math.min(m.fx.length, m.fxTotal - seen);
  return n > 0 ? m.fx.slice(m.fx.length - n) : [];
}
