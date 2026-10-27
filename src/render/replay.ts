import { TICK } from '../sim/constants';
import type { Action, Match, SimPlayer } from '../sim/match';
import type { Fx } from '../sim/stats';
import type { Vec } from '../sim/vec';
import type { MatchView } from './pitchRenderer';

interface Frame {
  /** x, y, vx, vy for every player, by player id. */
  pl: Float32Array;
  actions: Action[];
  on: number[];
  ball: { x: number; y: number; vx: number; vy: number; h: number; owner: number | null; shot: boolean };
  fx: Fx[];
}

/**
 * Keeps the last few seconds of open play for instant replays. Recording restarts whenever play
 * stops for a set piece, so a clip never jumps across a restart; a goal's own frame (ball in the
 * net) is always kept.
 */
export class ReplayRecorder {
  private frames: Frame[] = [];
  private readonly max: number;

  constructor(seconds: number) {
    this.max = Math.round(seconds / TICK);
  }

  record(m: Match, fx: Fx[], force = false): void {
    if (m.phase !== 'play' && !force) {
      this.frames = [];
      return;
    }
    const pl = new Float32Array(m.players.length * 4);
    for (const p of m.players) pl.set([p.pos.x, p.pos.y, p.vel.x, p.vel.y], p.id * 4);
    const b = m.ball;
    this.frames.push({
      pl,
      actions: m.players.map((p) => p.action),
      on: m.onPitch.map((p) => p.id),
      ball: { x: b.pos.x, y: b.pos.y, vx: b.vel.x, vy: b.vel.y, h: b.height, owner: b.owner, shot: !!b.shot },
      fx: fx.filter((f) => f.type !== 'whistle'),
    });
    if (this.frames.length > this.max) this.frames.shift();
  }

  /** The recorded clip (oldest first). */
  clip(): Frame[] {
    return [...this.frames];
  }
}

/**
 * A stand-in for the match that the renderer can draw: the same teams and players, but with
 * positions from recorded frames. Players are thin overlays on the real ones (Object.create), so
 * names, kits and numbers come straight through.
 */
export class ReplayView implements MatchView {
  readonly teams: Match['teams'];
  readonly players: SimPlayer[];
  onPitch: SimPlayer[] = [];
  ball = { pos: { x: 0, y: 0 } as Vec, prevPos: { x: 0, y: 0 } as Vec, vel: { x: 0, y: 0 } as Vec, owner: null as number | null, height: 0, shot: false };
  fx: Fx[] = [];
  fxTotal = 0;
  private shown = -1;

  constructor(
    m: Match,
    private readonly frames: Frame[],
  ) {
    this.teams = m.teams;
    this.players = m.players.map((p) => {
      const ghost = Object.create(p) as SimPlayer;
      ghost.pos = { ...p.pos };
      ghost.prevPos = { ...p.pos };
      ghost.vel = { x: 0, y: 0 };
      return ghost;
    });
    this.show(0);
  }

  get length(): number {
    return this.frames.length;
  }

  /** Move to frame i (with i-1 as the interpolation start), releasing the effects in between. */
  show(i: number): void {
    i = Math.max(0, Math.min(this.frames.length - 1, i));
    for (let k = this.shown + 1; k <= i; k++) {
      for (const f of this.frames[k].fx) {
        this.fx.push(f);
        this.fxTotal++;
      }
    }
    if (this.fx.length > 200) this.fx.splice(0, this.fx.length - 200);
    this.shown = Math.max(this.shown, i);
    const cur = this.frames[i];
    const prev = this.frames[Math.max(0, i - 1)];
    for (const g of this.players) {
      const o = g.id * 4;
      g.prevPos = { x: prev.pl[o], y: prev.pl[o + 1] };
      g.pos = { x: cur.pl[o], y: cur.pl[o + 1] };
      g.vel = { x: cur.pl[o + 2], y: cur.pl[o + 3] };
      g.action = cur.actions[g.id];
    }
    this.onPitch = cur.on.map((id) => this.players[id]);
    this.ball.prevPos = { x: prev.ball.x, y: prev.ball.y };
    this.ball.pos = { x: cur.ball.x, y: cur.ball.y };
    this.ball.vel = { x: cur.ball.vx, y: cur.ball.vy };
    this.ball.height = cur.ball.h;
    this.ball.owner = cur.ball.owner;
    this.ball.shot = cur.ball.shot;
  }
}
