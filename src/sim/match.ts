import * as C from './constants';
import { Rng } from './rng';
import { Vec, add, clamp, dist, dot, len, norm, rotate, scale, sub, vec } from './vec';
import { TeamSide, formationTarget, fromUV, keeperTarget, toU, toV } from './positioning';
import { WEATHER, Weather } from './weather';
import { SKILLS, SkillId } from '../data/skills';
import { EventType, Fx, FxType, MatchEvent, PlayerMatchStats, TeamStats, emptyPlayerStats, emptyStats } from './stats';
import { AttrKey, Player, familiarity, formMultiplier } from '../data/player';
import type { TeamSetup } from '../data/generator';
import { FORMATIONS, Formation } from '../tactics/formations';
import { ROLES, Role } from '../tactics/roles';
import type { PlayerInstructions, Tactics, TeamInstructions } from '../tactics/instructions';

export type { TeamSide };

export type Action = 'position' | 'press' | 'chase' | 'run' | 'dribble' | 'hold' | 'mark' | 'block' | 'support' | 'box';

export interface SimPlayer {
  id: number;
  team: TeamSide;
  slot: number;
  data: Player;
  role: Role;
  instr: PlayerInstructions;
  /** Familiarity with the slot's position; scales technical attributes. */
  fam: number;
  /** Recent-form modifier on technical attributes. */
  boost: number;
  isGK: boolean;
  active: boolean;
  sentOff: boolean;
  pos: Vec;
  prevPos: Vec;
  vel: Vec;
  target: Vec;
  urgency: number;
  action: Action;
  stamina: number;
  decisionCd: number;
  tackleCd: number;
  runTimer: number;
  runTarget: Vec | null;
  supportTarget: Vec | null;
  supportTimer: number;
  dribbleTarget: Vec | null;
  /** Set for restarts where the taker has to play the ball on (throw-ins, goal kicks, corners). */
  mustPass: boolean;
  yellows: number;
  /** Who last passed to this player, and when (for assists and key passes). */
  receivedFrom: number | null;
  receivedAt: number;
  /** When the player last took possession; dwelling on the ball gets pressed and stops being an option. */
  gotBallAt: number;
  skills: Set<SkillId>;
  /** Speed Burst runs until this sim time. */
  burstUntil: number;
  /** Just cut inside with the Cut Inside skill: shots until this sim time get extra accuracy. */
  cutUntil: number;
  /** Callout skills can't fire again until this sim time. */
  skillReadyAt: number;
  /** Sim time the player came on, and went off (null while on the pitch). */
  onAt: number;
  offAt: number | null;
  ps: PlayerMatchStats;
}

interface Shot {
  team: TeamSide;
  shooter: number;
  outcome: 'goal' | 'saved' | 'miss';
  /** Defenders that have already had their chance to block this shot. */
  checked: number[];
}

export interface Ball {
  pos: Vec;
  prevPos: Vec;
  vel: Vec;
  height: number;
  owner: number | null;
  lastTeam: TeamSide;
  receiver: number | null;
  passer: number | null;
  noTouchTimer: number;
  /** Player whose heavy touch just knocked the ball loose (can't touch it again until noTouchTimer runs out). */
  fumbler: number | null;
  lofted: boolean;
  loftFrom: Vec;
  loftDist: number;
  cross: boolean;
  /** Delivery quality of the cross in flight (crosser's crossing / 99). */
  crossQuality: number;
  /** Played with Precision Pass or bent with Curved Pass: defenders read it late. */
  threaded: boolean;
  /** Curvature of a curled pass (radians per meter, signed; 0 = straight) and where it is bending to. */
  curl: number;
  curlTarget: Vec;
  shot: Shot | null;
}

export type RestartType = 'kickoff' | 'throwin' | 'goalkick' | 'corner' | 'freekick' | 'penalty';

interface Restart {
  type: RestartType;
  team: TeamSide;
  pos: Vec;
  taker: number;
  timer: number;
  teleported: boolean;
}

export type Phase = 'play' | 'restart' | 'halftime' | 'fulltime';

const RESTART_TIME: Record<RestartType, number> = {
  kickoff: 1.5,
  throwin: 1.2,
  goalkick: 1.6,
  corner: 1.8,
  freekick: 1.6,
  penalty: 2.2,
};

/** Candidate spots (meters) an attacker considers when moving to get open. */
/** Sim seconds before a player's triggered skill can fire again (about 7.5 match minutes). */
const SKILL_REST = 70;
/** How long after a turnover the tempo setting drives sprinting forward or back (sim seconds). */
const TRANSITION_SECONDS = 5;
/** How far further upfield players aim when breaking at a fast tempo (meters). */
const TRANSITION_SURGE = 7;
/** How far off the straight line a curled pass sets off (radians). */
const CURL_ANGLE = 0.35;
/** How long (sim seconds) a keeper holds the ball after winning it, while play resets. */
const KEEPER_HOLD_MIN = 1.2;
const KEEPER_HOLD_MAX = 4;

const SUPPORT_OFFSETS: [number, number][] = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
  [4, 4],
  [4, -4],
  [-4, 4],
  [-4, -4],
];

interface Option {
  score: number;
  run: () => void;
}

export class Match {
  readonly rng: Rng;
  readonly teams: [TeamSetup, TeamSetup];
  players: SimPlayer[] = [];
  onPitch: SimPlayer[] = [];
  ball: Ball;
  time = 0;
  half: 1 | 2 = 1;
  score: [number, number] = [0, 0];
  phase: Phase = 'restart';
  restart: Restart | null = null;
  stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  events: MatchEvent[] = [];
  fx: Fx[] = [];
  /** Effects emitted so far (fx keeps only the latest 200); consumers track this to find new ones. */
  fxTotal = 0;
  possession: TeamSide = 0;
  subsUsed: [number, number] = [0, 0];
  readonly weather: Weather;
  /** Rolling friction for this pitch and weather. */
  private readonly groundK: number;
  /** Teams whose tactics are adjusted automatically at half-time. */
  aiTeams: TeamSide[] = [];

  private lostBallAt: [number, number] = [-99, -99];
  /** When each team last won the ball in open play (drives counter-attacks). */
  private regainAt: [number, number] = [-99, -99];
  /** When each team's current spell of possession began. */
  private possStart: [number, number] = [0, 0];
  private chasers: [number, number] = [-1, -1];
  private chasePoint: [Vec, Vec] = [vec(), vec()];
  private pressers = new Set<number>();
  private oppLine: [number, number] = [1, 1];
  /** Defender stepping into the carrier's shooting lane, and where. */
  private blocker = -1;
  private blockPoint = vec();
  /** Attackers attacking the box for an expected cross. */
  private boxRuns = new Map<number, Vec>();
  /** Defending team's man-marking assignments: defender id -> attacker id. */
  private marks = new Map<number, number>();
  /** Defenders (other than the chaser) who can cut out the pass in flight, and where. */
  private interceptors = new Map<number, Vec>();
  /** The keeper has the ball in his hands after winning it: both teams reset their shape. */
  private reset: { keeper: number; team: TeamSide; since: number } | null = null;

  constructor(home: TeamSetup, away: TeamSetup, seed: number, weather: Weather = WEATHER.clear) {
    this.weather = weather;
    this.groundK = C.GROUND_K * weather.groundK;
    this.rng = new Rng(seed);
    this.teams = [home, away];
    const center = vec(C.PITCH_L / 2, C.PITCH_W / 2);
    this.ball = {
      pos: { ...center },
      prevPos: { ...center },
      vel: vec(),
      height: 0,
      owner: null,
      lastTeam: 0,
      receiver: null,
      passer: null,
      noTouchTimer: 0,
      fumbler: null,
      lofted: false,
      loftFrom: vec(),
      loftDist: 0,
      cross: false,
      crossQuality: 0,
      threaded: false,
      curl: 0,
      curlTarget: vec(),
      shot: null,
    };
    for (const t of [0, 1] as TeamSide[]) {
      const tac = this.teams[t].tactics;
      tac.lineup.forEach((pid, slot) => this.players.push(this.makeSim(t, slot, this.findPlayer(t, pid))));
    }
    this.refreshOnPitch();
    this.setRestart('kickoff', 0, center);
    this.emit('kickoff', 0, 'Kick-off!');
  }

  // ---------------------------------------------------------------- public API

  get minute(): number {
    return Math.min(this.half * 45, Math.floor((this.time / C.HALF_SECONDS) * 45) + 1);
  }

  tactics(t: TeamSide): Tactics {
    return this.teams[t].tactics;
  }

  formation(t: TeamSide): Formation {
    return FORMATIONS[this.teams[t].tactics.formation];
  }

  isFinished(): boolean {
    return this.phase === 'fulltime';
  }

  /** Simulate to the end (or the next break) without rendering. */
  runToBreak(): void {
    while (this.phase !== 'halftime' && this.phase !== 'fulltime') this.step();
  }

  simulateFull(): void {
    this.runToBreak();
    if (this.phase === 'halftime') {
      this.startSecondHalf();
      this.runToBreak();
    }
  }

  startSecondHalf(): void {
    if (this.phase !== 'halftime') return;
    for (const t of this.aiTeams) this.aiHalftimeTalk(t);
    this.half = 2;
    this.time = C.HALF_SECONDS;
    this.setRestart('kickoff', 1, vec(C.PITCH_L / 2, C.PITCH_W / 2));
  }

  /** Minutes a player has been on the pitch (match-clock minutes). */
  minutesPlayed(p: SimPlayer): number {
    const end = p.offAt ?? this.time;
    return Math.round(((end - p.onAt) / C.HALF_SECONDS) * 45);
  }

  /** Apply edited tactics mid-match: role/instruction changes, position swaps and substitutions. */
  applyTactics(t: TeamSide, next: Tactics): void {
    this.teams[t].tactics = next;
    const form = FORMATIONS[next.formation];
    const current = this.players.filter((p) => p.team === t && (p.active || p.sentOff));
    const leaving = current.filter((p) => p.active && !next.lineup.includes(p.data.id));
    next.lineup.forEach((pid, slot) => {
      let sp = current.find((p) => p.data.id === pid);
      if (!sp) {
        const out = leaving.shift();
        sp = this.makeSim(t, slot, this.findPlayer(t, pid));
        this.players.push(sp);
        if (out) {
          out.active = false;
          out.offAt = this.time;
          sp.pos = { ...out.pos };
          sp.prevPos = { ...out.pos };
          if (this.ball.owner === out.id) this.ball.owner = sp.id;
          this.subsUsed[t]++;
          this.emit('sub', t, `Substitution: ${sp.data.name} replaces ${out.data.name}`);
        }
      }
      sp.slot = slot;
      sp.role = ROLES[next.roles[slot]];
      sp.instr = next.instr[slot];
      sp.fam = familiarity(sp.data, form.slots[slot].pos);
      sp.isGK = slot === 0;
    });
    this.refreshOnPitch();
  }

  step(): void {
    if (this.phase === 'halftime' || this.phase === 'fulltime') return;
    for (const p of this.onPitch) p.prevPos = { ...p.pos };
    this.ball.prevPos = { ...this.ball.pos };
    if (this.phase === 'restart') this.stepRestart();
    else this.stepPlay();
    this.time += C.TICK;
    const end = this.half * C.HALF_SECONDS;
    if (this.time >= end && !this.ball.shot && this.restart?.type !== 'penalty') this.endHalf();
  }

  // ---------------------------------------------------------------- setup helpers

  private findPlayer(t: TeamSide, id: string): Player {
    const p = this.teams[t].squad.find((q) => q.id === id);
    if (!p) throw new Error(`Player ${id} not in squad of ${this.teams[t].name}`);
    return p;
  }

  private makeSim(team: TeamSide, slot: number, data: Player): SimPlayer {
    const tac = this.teams[team].tactics;
    const form = FORMATIONS[tac.formation];
    const start = fromUV(team, 0.3, form.slots[slot].v);
    return {
      id: this.players.length,
      team,
      slot,
      data,
      role: ROLES[tac.roles[slot]],
      instr: tac.instr[slot],
      fam: familiarity(data, form.slots[slot].pos),
      boost: formMultiplier(data),
      isGK: slot === 0,
      active: true,
      sentOff: false,
      pos: { ...start },
      prevPos: { ...start },
      vel: vec(),
      target: { ...start },
      urgency: 0.5,
      action: 'position',
      stamina: data.condition,
      decisionCd: 0,
      tackleCd: 0,
      runTimer: 0,
      runTarget: null,
      supportTarget: null,
      supportTimer: 0,
      dribbleTarget: null,
      mustPass: false,
      yellows: 0,
      receivedFrom: null,
      receivedAt: -99,
      gotBallAt: 0,
      skills: new Set(data.skills ?? []),
      burstUntil: -99,
      cutUntil: -99,
      skillReadyAt: 0,
      onAt: this.time,
      offAt: null,
      ps: emptyPlayerStats(),
    };
  }

  private refreshOnPitch(): void {
    this.onPitch = this.players.filter((p) => p.active);
  }

  private emit(type: EventType, team: TeamSide, text: string, skill?: SkillId): void {
    this.events.push({ minute: this.minute, type, team, text, skill });
  }

  /**
   * Does p have this skill, and does it fire now? Triggered skills fire on their chance and then
   * rest (SKILL_REST) before they can fire again; always-on skills work every time but only call
   * themselves out now and then, so the callouts stay special.
   */
  private useSkill(p: SimPlayer, id: SkillId): boolean {
    if (!p.skills.has(id)) return false;
    const def = SKILLS[id];
    const ready = this.time >= p.skillReadyAt;
    const always = def.chance >= 1;
    if (!always && (!ready || !this.rng.chance(def.chance))) return false;
    p.ps.skills++;
    this.stats[p.team].skills++;
    if (ready) {
      p.skillReadyAt = this.time + SKILL_REST;
      this.effect('skill', p.pos, p.team, { label: def.name, skill: id });
      this.emit('skill', p.team, `${def.name}: ${p.data.name}`, id);
    }
    return true;
  }

  private effect(type: FxType, at: Vec, team: TeamSide, extra: Partial<Fx> = {}): void {
    this.fx.push({ type, time: this.time, x: at.x, y: at.y, team, ...extra });
    this.fxTotal++;
    if (this.fx.length > 200) this.fx.splice(0, this.fx.length - 200);
  }

  private endHalf(): void {
    this.time = this.half * C.HALF_SECONDS;
    this.ball.owner = null;
    this.ball.vel = vec();
    this.effect('whistle', this.ball.pos, 0);
    if (this.half === 1) {
      this.phase = 'halftime';
      this.emit('halftime', 0, `Half-time: ${this.score[0]}-${this.score[1]}`);
    } else {
      this.phase = 'fulltime';
      for (const p of this.onPitch) p.offAt = this.time;
      this.emit('fulltime', 0, `Full-time: ${this.score[0]}-${this.score[1]}`);
    }
  }

  private aiHalftimeTalk(t: TeamSide): void {
    const ti = this.teams[t].tactics.team;
    const diff = this.score[t] - this.score[1 - t];
    if (diff < 0) {
      ti.mentality = Math.min(2, ti.mentality + 1);
      ti.pressing = Math.min(1, ti.pressing + 1);
    } else if (diff >= 2) {
      ti.mentality = Math.max(-1, ti.mentality - 1);
    }
  }

  // ---------------------------------------------------------------- attribute helpers

  attr(p: SimPlayer, k: AttrKey): number {
    const physical = k === 'pace' || k === 'acceleration' || k === 'stamina' || k === 'strength';
    return p.data.attrs[k] * (physical ? 1 : p.fam * p.boost) * (0.8 + 0.2 * p.stamina);
  }

  maxSpeed(p: SimPlayer): number {
    const burst = this.time < p.burstUntil ? 1.15 : 1;
    return (5.2 + (3.3 * p.data.attrs.pace) / 99) * (0.72 + 0.28 * p.stamina) * this.weather.footing * burst;
  }

  private accel(p: SimPlayer): number {
    return (5 + (6 * p.data.attrs.acceleration) / 99) * this.weather.footing * (this.time < p.burstUntil ? 1.3 : 1);
  }

  private attackGoal(t: TeamSide): Vec {
    return t === 0 ? vec(C.PITCH_L, C.PITCH_W / 2) : vec(0, C.PITCH_W / 2);
  }

  private ownGoal(t: TeamSide): Vec {
    return this.attackGoal((1 - t) as TeamSide);
  }

  keeper(t: TeamSide): SimPlayer | undefined {
    return this.onPitch.find((p) => p.team === t && p.isGK);
  }

  private teamOn(t: TeamSide): SimPlayer[] {
    return this.onPitch.filter((p) => p.team === t);
  }

  /** Is pos inside the penalty box that team `attacking` is attacking? */
  private inAttackingBox(attacking: TeamSide, pos: Vec): boolean {
    return toU(attacking, pos.x) * C.PITCH_L > C.PITCH_L - C.BOX_DEPTH && Math.abs(pos.y - C.PITCH_W / 2) < C.BOX_W / 2;
  }

  private pressureOn(p: SimPlayer): number {
    let s = 0;
    for (const o of this.onPitch) {
      if (o.team === p.team) continue;
      const d = dist(o.pos, p.pos);
      if (d < 4) s += 1 - d / 4;
    }
    return Math.min(1.5, s);
  }

  private nearestDist(pt: Vec, players: SimPlayer[]): number {
    let m = Infinity;
    for (const o of players) m = Math.min(m, dist(o.pos, pt));
    return m;
  }

  private clampPitch(v: Vec): Vec {
    return { x: clamp(v.x, 0.5, C.PITCH_L - 0.5), y: clamp(v.y, 0.5, C.PITCH_W - 0.5) };
  }

  /** Distance from point p to segment a-b, and the fraction along it of the closest point. */
  private segDist(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 < 1e-9 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
    return { d: dist(p, add(a, scale(ab, t))), t };
  }

  private aerialScore(p: SimPlayer): number {
    return 0.6 * this.attr(p, 'heading') + 0.4 * this.attr(p, 'strength') + 15 * (p.role.w.aerial - 1);
  }

  /** Raw chance quality of a shot from pos (before skill, pressure and blockers). */
  private angleXg(t: TeamSide, pos: Vec): number {
    const gx = t === 0 ? C.PITCH_L : 0;
    const dx = Math.max(0.5, Math.abs(gx - pos.x));
    const angle = Math.abs(Math.atan2(C.GOAL_Y1 - pos.y, dx) - Math.atan2(C.GOAL_Y0 - pos.y, dx));
    return Math.min(0.7, 0.75 * angle * angle);
  }

  /**
   * Chance quality of a shot from where p stands: angle and distance, how closely he's pressed
   * (composed players cope better). Bodies in the way are left out: they get their chance to block
   * the shot physically (checkShotBlock). The shooter's finishing and the keeper
   * then decide how often it goes in (see finishMult and shoot).
   */
  private shotXg(p: SimPlayer, pressure: number, header: boolean): number {
    let xg = this.angleXg(p.team, p.pos);
    xg *= 1 - 0.5 * Math.min(1, pressure) * (1.2 - (0.6 * this.attr(p, 'composure')) / 99);
    if (header) xg *= 0.6;
    return clamp(xg, 0.005, 0.8);
  }

  /** How much better than an average chance this player converts (finishing or heading). */
  private finishMult(p: SimPlayer, header: boolean): number {
    return 0.3 + (1.2 * this.attr(p, header ? 'heading' : 'finishing')) / 99;
  }

  /** Outfield opponents standing in the lane between the ball carrier and the goal. */
  private blockers(p: SimPlayer): number {
    const g = this.attackGoal(p.team);
    let n = 0;
    for (const o of this.onPitch) {
      if (o.team === p.team || o.isGK) continue;
      const { d, t } = this.segDist(o.pos, p.pos, g);
      if (t > 0.03 && t < 0.95 && d < 1.3) n++;
    }
    return n;
  }

  /** How dangerous it is for team t to have the ball at pos: progress up the pitch plus scoring chance. */
  private threat(t: TeamSide, pos: Vec): number {
    const u = toU(t, pos.x);
    return 0.15 + 0.6 * u * u + 3 * this.angleXg(t, pos);
  }

  /** The few seconds after winning the ball, when the opponent is out of shape. */
  private inTransition(t: TeamSide): boolean {
    return this.time - this.regainAt[t] < TRANSITION_SECONDS;
  }

  /**
   * Tempo sets how hard players run when the ball changes hands. For a few seconds after a
   * turnover, the side that won it breaks forward and the side that lost it gets back into shape:
   * at a fast tempo everyone sprints, at a slow one they jog (saving their legs). It changes the
   * effort, not anyone's top speed. Chasing, pressing and blocking are always flat out.
   */
  private transitionEffort(p: SimPlayer): void {
    if (p.isGK || this.reset || this.ball.owner === p.id || this.phase !== 'play') return;
    if (p.action !== 'position' && p.action !== 'support' && p.action !== 'mark' && p.action !== 'run' && p.action !== 'box') return;
    const won = this.possession === p.team && this.time - this.regainAt[p.team] < TRANSITION_SECONDS;
    const lost = this.possession !== p.team && this.time - this.lostBallAt[p.team] < TRANSITION_SECONDS;
    if (!won && !lost) return;
    const tempo = this.tactics(p.team).team.tempo;
    // Fast: full sprint; normal: a brisk run; slow: a jog.
    const effort = tempo > 0 ? 1 : tempo === 0 ? 0.88 : 0.66;
    p.urgency = tempo > 0 ? Math.max(p.urgency, effort) : Math.min(p.urgency, effort);
    // At a fast tempo the side that won it also surges into the space ahead instead of settling.
    if (won && tempo > 0 && (p.action === 'position' || p.action === 'support')) {
      const dir = p.team === 0 ? 1 : -1;
      p.target = this.clampPitch({ x: p.target.x + dir * TRANSITION_SURGE, y: p.target.y });
    }
  }

  // ---------------------------------------------------------------- main loop

  private stepPlay(): void {
    const b = this.ball;
    if (b.owner !== null) this.possession = this.players[b.owner].team;
    this.updateKeeperReset();
    this.stats[this.possession].possessionTicks++;
    this.computeOppLines();
    this.computeChasers();
    this.computePressers();
    this.computeBlocker();
    this.computeBoxRuns();
    this.computeMarks();
    for (const p of this.onPitch) {
      this.think(p);
      this.transitionEffort(p);
      if (this.phase !== 'play') return;
    }
    for (const p of this.onPitch) this.move(p);
    this.updateBall();
    if (this.phase === 'play' && b.owner !== null) this.resolveChallenges();
  }

  /** The keeper gathers the ball: he holds it while both teams take up their shape. */
  private startKeeperReset(kp: SimPlayer): void {
    this.reset = { keeper: kp.id, team: kp.team, since: this.time };
    kp.decisionCd = KEEPER_HOLD_MAX;
    kp.mustPass = true;
    kp.action = 'hold';
    for (const q of this.onPitch) {
      q.runTarget = null;
      q.supportTarget = null;
    }
  }

  /** End the reset once the opposition has cleared out (or he has held it long enough). */
  private updateKeeperReset(): void {
    const r = this.reset;
    if (!r) return;
    const kp = this.players[r.keeper];
    if (this.ball.owner !== r.keeper || this.phase !== 'play') {
      this.reset = null;
      return;
    }
    const held = this.time - r.since;
    const clear = this.onPitch.every((o) => o.team === r.team || o.isGK || dist(o.pos, kp.pos) > 22);
    if (held > KEEPER_HOLD_MAX || (held > KEEPER_HOLD_MIN && clear)) {
      this.reset = null;
      kp.decisionCd = Math.min(kp.decisionCd, 0.2);
      kp.gotBallAt = this.time;
    }
  }

  /**
   * While the keeper holds the ball, everyone takes up the team's shape: his side spreads into
   * its build-up positions and the opposition drops into its defensive block, nobody pressing.
   */
  private thinkReset(p: SimPlayer, r: { team: TeamSide }): void {
    const ti = this.tactics(p.team).team;
    const slot = this.formation(p.team).slots[p.slot];
    const attacking = p.team === r.team;
    // Shape as if the ball were with the defenders (build-up) or in midfield (defending).
    const ball = attacking ? fromUV(r.team, 0.22, 0.5) : vec(C.PITCH_L / 2, C.PITCH_W / 2);
    p.target = formationTarget(p.team, slot, p.role, p.instr, { ball, inPossession: attacking, ti, oppLineU: this.oppLine[p.team] });
    p.urgency = dist(p.pos, p.target) > 8 ? 0.85 : 0.6;
    p.action = 'position';
  }

  private computeOppLines(): void {
    for (const t of [0, 1] as TeamSide[]) {
      let m = 0.5;
      for (const o of this.onPitch) if (o.team !== t && !o.isGK) m = Math.max(m, toU(t, o.pos.x));
      this.oppLine[t] = m;
    }
  }

  /** Ball position after t seconds of free travel, and whether it is low enough to play there. */
  private ballAt(t: number): { pos: Vec; playable: boolean } {
    const b = this.ball;
    const travel = (v0: number, k: number, tt: number) => (v0 * (1 - Math.exp(-k * tt))) / k;
    const speed = len(b.vel);
    // A curling pass is predicted along the line to where it will end up, which is how players read it.
    const curling = b.curl !== 0 && b.receiver !== null && !b.shot;
    const dir = curling ? norm(sub(b.curlTarget, b.pos)) : speed > 1e-6 ? scale(b.vel, 1 / speed) : vec();
    if (!b.lofted || b.shot) {
      const k = b.shot ? C.SHOT_K : this.groundK;
      return { pos: add(b.pos, scale(dir, travel(speed, k, t))), playable: true };
    }
    // Lofted: flies until it has covered loftDist, then rolls. Only playable near the landing spot.
    const done = dist(b.pos, b.loftFrom);
    const airLeft = Math.max(0, b.loftDist - done);
    const x = C.AIR_K * airLeft < speed ? -Math.log(1 - (C.AIR_K * airLeft) / speed) / C.AIR_K : Infinity;
    if (t <= x) {
      const d = travel(speed, C.AIR_K, t);
      return { pos: add(b.pos, scale(dir, d)), playable: (done + d) / b.loftDist >= 0.82 };
    }
    const landSpeed = speed * Math.exp(-C.AIR_K * x) * C.LANDING_DAMP;
    return { pos: add(b.pos, scale(dir, airLeft + travel(landSpeed, this.groundK, t - x))), playable: true };
  }

  private computeChasers(): void {
    const b = this.ball;
    this.chasers = [-1, -1];
    this.interceptors.clear();
    if (b.owner !== null || b.shot) return;
    // Sample the ball's path once (0.1s steps over 3s) and race every player against it.
    const path: { pos: Vec; playable: boolean }[] = [];
    for (let i = 1; i <= 30; i++) path.push(this.ballAt(i * 0.1));
    const reach = new Map<number, { tt: number; pt: Vec }>();
    for (const p of this.onPitch) {
      const vmax = this.maxSpeed(p);
      // Good positional sense means reading passes early; a marker reads the ball played to his man best of all.
      const markerRead = b.receiver !== null && this.marks.get(p.id) === b.receiver ? (0.8 * this.attr(p, 'marking')) / 99 : 0;
      // Interceptors read everything earlier; a precision pass is read late by the side it's played against.
      const lateRead = b.threaded && b.receiver !== null && b.passer !== null && this.players[b.passer].team !== p.team ? 0.4 : 1;
      const read = (0.1 + (2.2 * this.attr(p, 'positioning')) / 99 + markerRead + (p.skills.has('interceptor') ? 0.6 : 0) + (p.skills.has('awareness') ? 0.5 : 0)) * lateRead;
      let tt = 99;
      let pt = path[29].pos;
      for (let i = 0; i < 30; i++) {
        const s = (i + 1) * 0.1;
        if (path[i].playable && dist(p.pos, path[i].pos) <= vmax * s * 0.9 + read) {
          tt = s;
          pt = path[i].pos;
          break;
        }
      }
      reach.set(p.id, { tt, pt });
    }
    const recv = b.receiver !== null ? this.players[b.receiver] : null;
    for (const t of [0, 1] as TeamSide[]) {
      let best = -1;
      let bestT = Infinity;
      let bestPt = vec();
      for (const p of this.onPitch) {
        if (p.team !== t) continue;
        const { pt } = reach.get(p.id)!;
        let tt = reach.get(p.id)!.tt;
        if (p.isGK && !this.inAttackingBox((1 - t) as TeamSide, pt)) continue;
        // The intended receiver goes for the ball unless a team-mate is clearly closer.
        if (recv && recv.id === p.id) tt -= 0.6;
        if (tt < bestT) {
          bestT = tt;
          best = p.id;
          bestPt = pt;
        }
      }
      this.chasers[t] = best;
      this.chasePoint[t] = this.clampPitch(bestPt);
    }
    // Besides the chaser, any defender who can get across the pass before the receiver does goes for it.
    if (b.passer === null || !recv) return;
    const def = (1 - this.players[b.passer].team) as TeamSide;
    const recvT = reach.get(recv.id)!.tt;
    for (const p of this.onPitch) {
      if (p.team !== def || p.isGK || p.id === this.chasers[def]) continue;
      const r = reach.get(p.id)!;
      if (r.tt < Math.min(2.2, recvT + 0.2)) this.interceptors.set(p.id, this.clampPitch(r.pt));
    }
  }

  private computePressers(): void {
    if (this.reset) return this.pressers.clear();
    this.pressers.clear();
    const b = this.ball;
    if (b.owner === null) return;
    const carrier = this.players[b.owner];
    const def = (1 - carrier.team) as TeamSide;
    const ti = this.tactics(def).team;
    const cands = this.teamOn(def)
      .filter((p) => !p.isGK)
      .sort((a, c) => dist(a.pos, carrier.pos) - dist(c.pos, carrier.pos));
    const depth = toU(def, carrier.pos.x);
    const counter = this.time - this.lostBallAt[def] < 3 && ti.pressing >= 0 ? 8 : 0;
    for (let i = 0; i < Math.min(3, cands.length); i++) {
      const p = cands[i];
      const d = dist(p.pos, carrier.pos);
      let range = (10 + 6 * ti.pressing + 1.5 * ti.mentality) * Math.sqrt(p.role.w.press) * (1 + 0.2 * p.instr.aggression) + counter;
      if (depth < 0.35) range += 8;
      if (depth > 0.65 && ti.pressing < 1) range *= 0.6;
      // Nobody is allowed to stand on the ball: dwell for long and the nearest man goes regardless.
      const dwelling = i === 0 && this.time - carrier.gotBallAt > 1.8;
      const limit = dwelling ? Infinity : i === 0 ? range + 4 : i === 1 ? range * (ti.pressing > 0 ? 1 : 0.6) : ti.pressing > 0 ? range * 0.6 : 0;
      if (d < limit) this.pressers.add(p.id);
    }
  }

  /** When the carrier is within shooting range, the best-placed free defender steps into the shooting lane. */
  private computeBlocker(): void {
    if (this.reset) return void (this.blocker = -1);
    this.blocker = -1;
    const b = this.ball;
    if (b.owner === null) return;
    const carrier = this.players[b.owner];
    const def = (1 - carrier.team) as TeamSide;
    const goal = this.ownGoal(def);
    const dGoal = dist(carrier.pos, goal);
    if (dGoal > 32) return;
    this.blockPoint = add(carrier.pos, scale(norm(sub(goal, carrier.pos)), Math.min(3.2, dGoal * 0.4)));
    let best = 14;
    for (const p of this.onPitch) {
      if (p.team !== def || p.isGK || this.pressers.has(p.id)) continue;
      const d = dist(p.pos, this.blockPoint);
      if (d < best) {
        best = d;
        this.blocker = p.id;
      }
    }
  }

  /** Which line of the team a player defends in. */
  private zoneOf(p: SimPlayer): 'def' | 'mid' | 'fwd' {
    const pos = this.formation(p.team).slots[p.slot].pos;
    if (pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') return 'def';
    if (pos === 'ST' || pos === 'LW' || pos === 'RW') return 'fwd';
    return 'mid';
  }

  /**
   * Man-marking assignments for the defending team. Attackers are taken in order of danger and
   * each goes to the defender it costs least to pick him up. Defenders take the most advanced
   * attackers and follow them anywhere in their own half; midfielders pick up men around their
   * zone (box-to-box players cover far more ground); forwards only track men near them and never
   * chase runners back into their own third. Pairings are sticky so markers don't keep swapping.
   */
  private computeMarks(): void {
    if (this.reset) return this.marks.clear();
    const prev = new Map(this.marks);
    this.marks.clear();
    const att = this.possession;
    const def = (1 - att) as TeamSide;
    const b = this.ball;
    const ti = this.tactics(def).team;
    const form = this.formation(def);
    const defenders = this.teamOn(def).filter((p) => !p.isGK && !this.pressers.has(p.id) && p.id !== this.blocker);
    const anchors = new Map<number, Vec>();
    for (const d of defenders) {
      anchors.set(d.id, formationTarget(def, form.slots[d.slot], d.role, d.instr, { ball: b.pos, inPossession: false, ti, oppLineU: this.oppLine[def] }));
    }
    const attackers = this.teamOn(att)
      .filter((a) => !a.isGK && a.id !== b.owner)
      .map((a) => ({ a, danger: this.threat(att, a.pos) + (a.action === 'run' ? 0.3 : 0) }))
      .sort((x, y) => y.danger - x.danger);
    const taken = new Set<number>();
    for (const { a } of attackers) {
      const au = toU(def, a.pos.x);
      let best = -1;
      let bestCost = Infinity;
      for (const d of defenders) {
        if (taken.has(d.id)) continue;
        const anchor = anchors.get(d.id)!;
        const zone = this.zoneOf(d);
        const roam = d.role.roam ?? 1;
        let cost = Math.min(dist(anchor, a.pos), dist(d.pos, a.pos) * 1.2);
        if (zone === 'def' && au > 0.6) cost += 20;
        if (zone === 'fwd' && au < toU(def, anchor.x) - 0.1) cost += 30;
        if (zone === 'mid' && au < 0.2) cost += 6;
        cost /= roam;
        if (prev.get(d.id) === a.id) cost -= 4;
        const max = zone === 'def' ? 26 : zone === 'mid' ? 18 : 9;
        if (cost < max && cost < bestCost) {
          bestCost = cost;
          best = d.id;
        }
      }
      if (best >= 0) {
        this.marks.set(best, a.id);
        taken.add(best);
      }
    }
  }

  /** Wide teams look to cross from further infield; narrow teams only from right on the touchline. */
  private inCrossingZone(t: TeamSide, v: number): boolean {
    const edge = 0.24 + 0.08 * this.tactics(t).team.width;
    return v < edge || v > 1 - edge;
  }

  /** When a team-mate is in a crossing position, forwards attack the near post, penalty spot and far post. */
  private computeBoxRuns(): void {
    this.boxRuns.clear();
    const b = this.ball;
    if (b.owner === null) return;
    const carrier = this.players[b.owner];
    const t = carrier.team;
    const u = toU(t, carrier.pos.x);
    const v = toV(t, carrier.pos.y);
    if (u < 0.68 || !this.inCrossingZone(t, v)) return;
    const near = v < 0.5 ? -1 : 1;
    const zones = [fromUV(t, 0.955, 0.5 + near * 0.06), fromUV(t, 0.955, 0.5 - near * 0.08), fromUV(t, 0.89, 0.5)];
    const form = this.formation(t);
    const runners = this.teamOn(t)
      .filter((p) => p !== carrier && !p.isGK && (form.slots[p.slot].u >= 0.65 || p.role.w.run >= 1.4))
      .sort((a, c) => form.slots[c.slot].u - form.slots[a.slot].u || a.slot - c.slot);
    runners.slice(0, 3).forEach((p, i) => this.boxRuns.set(p.id, zones[i]));
  }

  // ---------------------------------------------------------------- off-ball decisions

  private think(p: SimPlayer): void {
    p.decisionCd -= C.TICK;
    p.tackleCd -= C.TICK;
    p.supportTimer -= C.TICK;
    if (p.runTimer > 0) {
      p.runTimer -= C.TICK;
      if (p.runTimer <= 0) p.runTarget = null;
    }
    const b = this.ball;
    if (b.owner === p.id) return this.thinkCarrier(p);
    if (this.reset && !p.isGK) return this.thinkReset(p, this.reset);
    if (b.shot && b.shot.team !== p.team && !p.isGK && this.thinkShotBlock(p)) return;
    if (b.owner === null && !b.shot && this.chasers[p.team] === p.id) {
      p.target = this.chasePoint[p.team];
      p.urgency = 1;
      p.action = 'chase';
      return;
    }
    const cut = this.interceptors.get(p.id);
    if (cut) {
      p.target = cut;
      p.urgency = 1;
      p.action = 'chase';
      return;
    }
    if (p.isGK) return this.thinkKeeper(p);

    const ti = this.tactics(p.team).team;
    const inPoss = this.possession === p.team;
    const slot = this.formation(p.team).slots[p.slot];
    const base = formationTarget(p.team, slot, p.role, p.instr, { ball: b.pos, inPossession: inPoss, ti, oppLineU: this.oppLine[p.team] });

    if (inPoss) return this.thinkAttacking(p, base, ti);
    this.thinkDefending(p, base);
  }

  private thinkAttacking(p: SimPlayer, base: Vec, ti: TeamInstructions): void {
    const b = this.ball;
    const box = this.boxRuns.get(p.id);
    if (box) {
      p.target = box;
      p.urgency = 1;
      p.action = 'box';
      return;
    }
    if (!p.runTarget && b.owner !== null) this.maybeStartRun(p, base, ti);
    if (p.runTarget) {
      p.target = p.runTarget;
      p.urgency = 1;
      p.action = 'run';
      return;
    }
    // Move into space where the carrier can find us.
    if (b.owner !== null) {
      const carrier = this.players[b.owner];
      if (p.supportTimer <= 0 || !p.supportTarget) {
        p.supportTarget = dist(carrier.pos, base) < 40 ? this.supportSpot(p, base, carrier) : base;
        p.supportTimer = 0.5 + this.rng.next() * 0.3;
      }
      p.target = p.supportTarget;
      p.action = 'support';
    } else {
      p.target = base;
      p.action = 'position';
    }
    p.urgency = dist(p.pos, p.target) > 8 ? 0.85 : 0.6;
  }

  /** Pick the nearby spot with the most space and the clearest passing lane from the carrier. */
  private supportSpot(p: SimPlayer, base: Vec, carrier: SimPlayer): Vec {
    const opps = this.teamOn((1 - p.team) as TeamSide);
    const maxU = this.oppLine[p.team] + 0.01;
    let best = base;
    let bestS = -Infinity;
    // Aware players scan further for space.
    const offsets = p.skills.has('awareness') ? [...SUPPORT_OFFSETS, ...SUPPORT_OFFSETS.slice(1).map(([x, y]): [number, number] => [x * 1.7, y * 1.7])] : SUPPORT_OFFSETS;
    for (const [dx, dy] of offsets) {
      let c = this.clampPitch({ x: base.x + dx, y: base.y + dy });
      if (toU(p.team, c.x) > maxU) c = fromUV(p.team, maxU, toV(p.team, c.y));
      const space = Math.min(8, this.nearestDist(c, opps));
      let lane = 6;
      for (const o of opps) {
        const { d, t } = this.segDist(o.pos, carrier.pos, c);
        if (t > 0.05 && t < 0.98) lane = Math.min(lane, d);
      }
      const tooClose = dist(c, carrier.pos) < 6 ? 3 : 0;
      const s = space * 0.6 + lane * 0.7 - dist(c, base) * 0.22 - tooClose + (toU(p.team, c.x) - toU(p.team, base.x)) * 6;
      if (s > bestS) {
        bestS = s;
        best = c;
      }
    }
    return best;
  }

  private thinkDefending(p: SimPlayer, base: Vec): void {
    const b = this.ball;
    p.runTarget = null;
    p.supportTarget = null;
    if (b.owner !== null && this.pressers.has(p.id)) {
      const carrier = this.players[b.owner];
      // Cut him off rather than chase his heels: aim where he will be by the time we get there.
      const lead = clamp(dist(p.pos, carrier.pos) / this.maxSpeed(p), 0.3, 1.2);
      p.target = add(carrier.pos, scale(carrier.vel, lead));
      p.urgency = 1;
      p.action = 'press';
      return;
    }
    if (this.blocker === p.id) {
      p.target = this.blockPoint;
      p.urgency = 1;
      p.action = 'block';
      return;
    }
    p.target = this.markAdjust(p, base);
    // Recovery run: sprint when the man is goal-side of you.
    const man = this.marks.get(p.id);
    const beaten = man !== undefined && toU(p.team, this.players[man].pos.x) < toU(p.team, p.pos.x) + 0.02;
    p.urgency = beaten || dist(p.pos, p.target) > 6 ? 1 : 0.7;
    p.action = 'mark';
  }

  /** Throw yourself in front of a shot if you can get to its path. */
  private thinkShotBlock(p: SimPlayer): boolean {
    const b = this.ball;
    const end = add(b.pos, scale(b.vel, 1.2));
    const { d, t } = this.segDist(p.pos, b.pos, end);
    if (d > (p.skills.has('last_ditch') ? 5.5 : 4) || t <= 0.02) return false;
    const pt = add(b.pos, scale(sub(end, b.pos), t));
    p.target = pt;
    p.urgency = 1;
    p.action = 'block';
    return true;
  }

  private maybeStartRun(p: SimPlayer, target: Vec, ti: TeamInstructions): void {
    const u = toU(p.team, target.x);
    if (u < 0.35) return;
    const counter = this.inTransition(p.team) ? 3 : 1;
    // Runs are made when the carrier has his head up, not when he's being closed down.
    const carrier = this.players[this.ball.owner!];
    const time = 1 - 0.6 * Math.min(1, this.pressureOn(carrier));
    const perSec = 0.14 * p.role.w.run * (1 + 0.5 * p.instr.runs) * (1 + 0.25 * ti.mentality) * (1 + 0.8 * ti.directness) * counter * time;
    if (perSec <= 0 || !this.rng.chance(perSec * C.TICK)) return;
    const line = this.oppLine[p.team];
    const v = toV(p.team, target.y);
    // Inside forwards and shadow strikers look for a gap toward goal; others stay in their channel.
    const gapV = this.findGap(p.team, v + (0.5 - v) * (p.role.w.shoot > 1.2 ? 0.5 : 0.1));
    // Forwards go in behind the line; players arriving from deep stop just in front of it, between the lines.
    const behind = u > line - 0.12;
    const runU = behind ? Math.min(line + this.rng.range(0.05, 0.12), 0.95) : Math.min(u + 0.2, line - 0.02);
    if (runU < u + 0.04) return;
    p.runTarget = fromUV(p.team, runU, gapV);
    p.runTimer = this.rng.range(1.8, 2.8);
    if (this.useSkill(p, 'speed_burst')) p.burstUntil = this.time + 2.5;
  }

  /** The widest hole in the opposition back line near lane v (team-relative). */
  private findGap(t: TeamSide, v: number): number {
    const line = this.oppLine[t];
    const vs = this.onPitch
      .filter((o) => o.team !== t && !o.isGK && toU(t, o.pos.x) > line - 0.12)
      .map((o) => toV(t, o.pos.y));
    vs.push(0.06, 0.94);
    vs.sort((a, c) => a - c);
    let best = v;
    let bestS = -Infinity;
    for (let i = 1; i < vs.length; i++) {
      const w = vs[i] - vs[i - 1];
      if (w < 0.08) continue;
      const mid = (vs[i] + vs[i - 1]) / 2;
      const s = Math.min(w, 0.3) - Math.abs(mid - v) * 0.9;
      if (s > bestS) {
        bestS = s;
        best = mid;
      }
    }
    return clamp(best, 0.08, 0.92);
  }

  /**
   * Off-ball defending. A marker stays goal-side of his man, a step ahead of where the man is
   * heading, and the nearer the man is to the ball the more he steps into the passing lane to
   * him. Players with no man screen the passing lanes running through their zone. A leash keeps
   * everyone in the team's shape: short for forwards, long for box-to-box players, and defenders
   * follow a runner wherever he goes.
   */
  private markAdjust(p: SimPlayer, base: Vec): Vec {
    const b = this.ball;
    const ballPos = b.owner !== null ? this.players[b.owner].pos : b.pos;
    const zone = this.zoneOf(p);
    const roam = p.role.roam ?? 1;
    const positioning = this.attr(p, 'positioning') / 99;
    const manId = this.marks.get(p.id);
    let spot: Vec;
    let leash: number;
    if (manId !== undefined) {
      const m = this.players[manId];
      const at = add(m.pos, scale(m.vel, 0.4));
      const toGoal = sub(this.ownGoal(p.team), at);
      // Aware defenders sit tighter goal-side and lean further into the passing lane.
      const aware = p.skills.has('awareness');
      const goalSide = add(at, scale(norm(toGoal), Math.min(aware ? 1.3 : 1.8, len(toGoal) * 0.3)));
      const dc = dist(ballPos, at);
      const lane = add(at, scale(sub(ballPos, at), Math.min(0.45, 3.5 / Math.max(1, dc))));
      const laneW = clamp((30 - dc) / 18, 0, 0.8) * (0.4 + 0.6 * positioning) * (aware ? 1.25 : 1);
      spot = add(goalSide, scale(sub(lane, goalSide), laneW));
      // Men near our goal are marked tightly; further out it's a blend with holding the zone. Cautious teams mark tighter.
      const near = toU(p.team, m.pos.x) < 0.38 ? 0.3 : 0;
      const tight = clamp(0.6 + near - 0.06 * this.tactics(p.team).team.mentality, 0.35, 1);
      spot = add(base, scale(sub(spot, base), tight));
      leash = zone === 'def' ? 30 : zone === 'mid' ? 13 * roam : 6 * roam;
    } else {
      // Nobody to pick up: stand in the passing lanes that run through the zone, weighted by where they lead.
      let sum = base;
      let wsum = 1;
      for (const a of this.onPitch) {
        if (a.team === p.team || a.isGK || a.id === b.owner || dist(ballPos, a.pos) > 35) continue;
        const { d, t } = this.segDist(base, ballPos, a.pos);
        if (d > 9 || t < 0.15 || t > 0.92) continue;
        const w = (0.3 + this.threat(a.team, a.pos)) * (1 - d / 9) * (0.6 + 0.8 * positioning);
        sum = add(sum, scale(add(ballPos, scale(sub(a.pos, ballPos), t)), w));
        wsum += w;
      }
      spot = scale(sum, 1 / wsum);
      leash = zone === 'fwd' ? 4 : 8;
    }
    let off = sub(spot, base);
    const l = len(off);
    if (l > leash) off = scale(off, leash / l);
    return add(base, off);
  }

  private thinkKeeper(p: SimPlayer): void {
    const b = this.ball;
    if (b.shot && b.shot.team !== p.team && Math.abs(b.vel.x) > 0.1) {
      const tt = (p.pos.x - b.pos.x) / b.vel.x;
      const y = b.pos.y + b.vel.y * Math.max(0, tt);
      p.target = { x: p.pos.x, y: clamp(y, C.GOAL_Y0 - 1, C.GOAL_Y1 + 1) };
      p.urgency = 1;
      return;
    }
    p.target = keeperTarget(p.team, b.pos, !!p.role.sweeper, this.tactics(p.team).team.lineHeight);
    p.urgency = 0.7;
    p.action = 'position';
  }

  // ---------------------------------------------------------------- on-ball decisions

  private thinkCarrier(p: SimPlayer): void {
    if (p.decisionCd > 0) {
      if (p.action === 'dribble' && p.dribbleTarget) {
        p.target = p.dribbleTarget;
        p.urgency = 1;
      } else {
        p.target = p.pos;
        p.urgency = 0.2;
        p.action = 'hold';
      }
      return;
    }
    this.decide(p);
  }

  /**
   * Estimated chance a pass from `from` to `aim` for receiver m is cut out. The ball is raced
   * against every opponent at points along its path; for a lofted ball only the drop zone counts.
   */
  private passRisk(from: Vec, aim: Vec, m: SimPlayer, lofted: boolean, opps: SimPlayer[]): number {
    const d = Math.max(1, dist(from, aim));
    const k = lofted ? C.AIR_K : this.groundK;
    const v0 = C.kickSpeed(d, lofted, this.groundK, this.weather.arrive);
    if (k * d >= v0 - 0.5) return 1;
    const tAt = (s: number) => -Math.log(1 - (k * s) / v0) / k;
    const tb = tAt(d);
    const tr = Math.max(0, dist(m.pos, aim) - 0.8) / this.maxSpeed(m) + 0.15;
    const tReceive = Math.max(tb, tr);
    // A pass the receiver can't reach in time runs on into trouble.
    let risk = clamp((tr - tb - 0.5) / 1.5, 0, 0.6);
    const dir = scale(sub(aim, from), 1 / d);
    const fracs = lofted ? [0.88, 1] : [0.2, 0.4, 0.6, 0.8, 1];
    for (const o of opps) {
      const vo = this.maxSpeed(o);
      const reach = o.isGK ? 1.8 : 1.0;
      for (const f of fracs) {
        const pt = add(from, scale(dir, d * f));
        const tBall = f === 1 ? tReceive : tAt(d * f);
        const tOpp = Math.max(0, dist(o.pos, pt) - reach) / vo + 0.25;
        const margin = tOpp - tBall;
        if (margin < 0.5) risk = Math.max(risk, clamp(0.5 - margin / 0.8, 0, 0.95));
      }
    }
    return risk;
  }

  /** Utility AI: value every option as (chance it works x what it's worth) and take the best. */
  private decide(p: SimPlayer): void {
    const t = p.team;
    const opp = (1 - t) as TeamSide;
    const ti = this.tactics(t).team;
    const opps = this.teamOn(opp);
    const mates = this.teamOn(t).filter((m) => m.id !== p.id);
    const goal = this.attackGoal(t);
    const pressure = this.pressureOn(p);
    const opts: Option[] = [];
    const myU = toU(t, p.pos.x);
    const here = this.threat(t, p.pos);
    // Mentality tilts every option toward (or away from) moving the ball forward. Right after
    // winning the ball every team looks to counter (cautious ones most of all), and a spell of
    // possession that goes nowhere gradually pushes the team to progress rather than recycle.
    const counter = this.inTransition(t) ? 0.3 * (1 - 0.15 * ti.mentality) : 0;
    const stale = clamp((this.time - this.possStart[t] - 10) / 15, 0, 1) * (myU < 0.5 ? 0.3 : 0.12);
    const push = clamp(0.07 * ti.mentality + counter + stale, -0.3, 0.6);
    const forwardBias = (to: Vec) => 1 + push * Math.sign(toU(t, to.x) - myU);

    // Shoot
    const dGoal = dist(p.pos, goal);
    if (dGoal < 28 && !p.mustPass) {
      const xg = this.shotXg(p, pressure, false);
      const skid = dGoal > 16 ? 1 + this.weather.slick : 1;
      // Shooters avoid firing into a crowd of bodies.
      const s = xg * Math.pow(0.6, this.blockers(p)) * 11 * skid * p.role.w.shoot * (1 + 0.35 * p.instr.shooting) * (1 + 0.08 * ti.mentality);
      opts.push({ score: s, run: () => this.shoot(p, xg, false) });
    }

    // Pass: to feet, into the space ahead of a team-mate, or to a runner; on the ground or in the air.
    const skill = this.attr(p, 'passing') / 99;
    const vision = this.attr(p, 'vision') / 99;
    const direct = ti.directness - 0.25 * Math.min(0, ti.mentality);
    for (const m of mates) {
      if (m.isGK && pressure < 0.5) continue;
      const aims: Vec[] = [this.clampPitch(add(m.pos, scale(m.vel, 0.35)))];
      if (!m.isGK) {
        const toGoal = norm(sub(goal, m.pos));
        const sp = len(m.vel);
        const lead = norm(add(toGoal, sp > 1 ? scale(m.vel, 0.6 / sp) : vec()));
        aims.push(this.clampPitch(add(m.pos, scale(lead, 5))), this.clampPitch(add(m.pos, scale(lead, 10))));
        if (m.action === 'run' && m.runTarget) aims.push(this.clampPitch(m.runTarget));
      }
      for (const aim of aims) {
        const d = dist(p.pos, aim);
        // Players with vision see passes further up the pitch.
        if (d < 4 || d > (20 + 35 * vision) * this.weather.visibility) continue;
        for (const lofted of [false, true]) {
          if (lofted ? d < 15 : d > 32) continue;
          // Seeing a through ball needs vision; lesser players mostly play to feet.
          const ambitious = aim !== aims[0];
          if (ambitious && this.rng.next() > 0.35 + 0.65 * vision) continue;
          // A player who can bend it knows a man in the lane is less of a problem.
          const risk = this.passRisk(p.pos, aim, m, lofted, opps) * (!lofted && p.skills.has('curve_pass') ? 0.75 : 1);
          const acc = 1 - clamp((d / 30) * (1 - skill) * (lofted ? 1.3 : 1) + pressure * 0.12, 0, 0.6);
          let pOk = (1 - risk) * acc;
          // Risk appetite: cautious teams avoid passes that might be cut out, attacking ones gamble.
          pOk = Math.pow(pOk, 1 - 0.15 * ti.mentality);
          const gain = pOk * this.threat(t, aim) - (1 - pOk) * 0.35 * this.threat(opp, aim);
          // Passes that take opponents out of the game are worth a little extra.
          let bypassed = 0;
          const aimU = toU(t, aim.x);
          for (const o of opps) {
            const ou = toU(t, o.pos.x);
            if (ou > myU && ou < aimU) bypassed++;
          }
          let style = lofted || d > 26 ? (0.7 + 0.3 * direct) * p.role.w.direct : 1 - 0.12 * direct;
          // Players lean on what they do best: long-ball specialists look up early.
          if (lofted && d > 28 && p.skills.has('long_ball')) style *= 1.5;
          const s = (gain + 0.025 * bypassed * pOk) * style * p.role.w.pass * forwardBias(aim);
          opts.push({ score: s, run: () => this.pass(p, m, aim, lofted, false) });
        }
      }
    }

    // Cross into the danger zones runners are attacking.
    const v = toV(t, p.pos.y);
    if (myU > 0.72 && this.inCrossingZone(t, v)) {
      const crossing = this.attr(p, 'crossing') / 99;
      for (const [id, zone] of this.boxRuns) {
        const att = this.players[id];
        if (att.team !== t) continue;
        let def: SimPlayer | null = null;
        for (const o of opps) {
          if (o.isGK || dist(o.pos, zone) > 3.5) continue;
          if (!def || this.aerialScore(o) > this.aerialScore(def)) def = o;
        }
        const pWin = def ? clamp(0.5 + (this.aerialScore(att) - this.aerialScore(def)) / 99, 0.15, 0.85) : 0.85;
        const xgH = this.angleXg(t, zone) * 0.6 * (0.6 + (0.8 * this.attr(att, 'heading')) / 99);
        const delivery = 0.55 + 0.4 * crossing - 0.15 * Math.min(1, pressure);
        const s = delivery * pWin * (xgH * 6 + 0.25) * p.role.w.cross * (1 + 0.6 * ti.width);
        opts.push({ score: s, run: () => this.pass(p, att, zone, true, true) });
      }
    }

    if (!p.mustPass) {
      // Dribble: try straight on and either side, carry into whichever has the most room.
      const fwd = norm(sub(goal, p.pos));
      const dribbling = this.attr(p, 'dribbling') / 99;
      for (const ang of [0, 0.6, -0.6, 1.2, -1.2]) {
        const dir = rotate(fwd, ang);
        const ahead = this.clampPitch(add(p.pos, scale(dir, 7)));
        const space = this.nearestDist(ahead, opps);
        const pKeep = clamp(space / 9, 0.1, 1) * (0.45 + 0.55 * dribbling) * (1 - 0.45 * Math.min(1, pressure));
        let s = (pKeep * this.threat(t, ahead) - (1 - pKeep) * 0.25 * this.threat(opp, p.pos)) * p.role.w.dribble * forwardBias(ahead);
        if (p.isGK) s *= 0.05;
        opts.push({ score: s, run: () => this.startDribble(p, ahead) });
      }

      // Cut Inside: from the flank in the final third, drive diagonally for the edge of the box.
      const v = toV(t, p.pos.y);
      if (p.skills.has('cut_inside') && myU > 0.6 && Math.abs(v - 0.5) > 0.18) {
        const target = this.clampPitch(fromUV(t, Math.min(0.88, myU + 0.08), 0.5 + Math.sign(v - 0.5) * 0.1));
        const space = this.nearestDist(target, opps);
        const pKeep = clamp(space / 8, 0.15, 1) * (0.5 + 0.5 * dribbling) * (1 - 0.35 * Math.min(1, pressure));
        const s = (pKeep * this.threat(t, target) * 1.5 - (1 - pKeep) * 0.25 * this.threat(opp, p.pos)) * p.role.w.dribble;
        opts.push({
          score: s,
          run: () => {
            this.startDribble(p, target);
            if (this.useSkill(p, 'cut_inside')) {
              p.burstUntil = this.time + 2;
              p.cutUntil = this.time + 4;
              p.decisionCd = 0.8;
            }
          },
        });
      }

      // Hold: keep the ball and wait for a better option. Bad idea under pressure, and only for a
      // moment, unless he is a target man holding it up in the opposition half for support to arrive.
      const holdUp = p.skills.has('hold_up') && myU > 0.5;
      opts.push({
        score:
          here *
          (holdUp ? 0.75 : pressure < 0.3 ? 0.7 : 0.3) *
          (1 - 0.15 * ti.tempo) *
          (1 - counter - stale) *
          clamp(1 - (this.time - p.gotBallAt - 1) / (holdUp ? 4 : 2.5), 0, 1),
        run: () => {
          p.action = 'hold';
          p.decisionCd = 0.35 - 0.1 * ti.tempo;
        },
      });
    }

    if (!opts.length) {
      p.decisionCd = 0.3;
      return;
    }
    // Small amount of noise so play isn't robotic; the best decision-makers barely deviate, and composed ones keep their heads under pressure.
    const noise = 0.15 - 0.12 * vision + 0.15 * Math.min(1, pressure) * (1 - this.attr(p, 'composure') / 99);
    let best = opts[0];
    let bs = -Infinity;
    for (const o of opts) {
      const sc = o.score * (1 + (this.rng.next() - 0.5) * 2 * noise);
      if (sc > bs) {
        bs = sc;
        best = o;
      }
    }
    p.mustPass = false;
    best.run();
  }

  private startDribble(p: SimPlayer, target: Vec): void {
    p.dribbleTarget = target;
    p.action = 'dribble';
    p.decisionCd = 0.55 - 0.2 * this.tactics(p.team).team.tempo;
    // Burst into open grass on the break.
    if (this.inTransition(p.team) && this.nearestDist(target, this.teamOn((1 - p.team) as TeamSide)) > 6 && this.useSkill(p, 'speed_burst')) p.burstUntil = this.time + 2.5;
  }

  private pass(p: SimPlayer, m: SimPlayer, aim: Vec, lofted: boolean, cross: boolean): void {
    const b = this.ball;
    const skill = this.attr(p, cross ? 'crossing' : 'passing') / 99;
    const pressure = this.pressureOn(p);
    const d = dist(p.pos, aim);
    // Skills: a pinpoint cross; a precision ball into the space ahead of a team-mate; a pass bent
    // around the man in the lane; or a long ball pinged upfield.
    const pinpoint = cross && this.useSkill(p, 'crosser');
    const precise = !cross && d > 12 && toU(p.team, aim.x) > toU(p.team, m.pos.x) + 0.02 && this.useSkill(p, 'precision_pass');
    const blocker = !cross && !lofted && d > 8 ? this.laneBlocker(p, aim) : null;
    const curl = blocker !== null && this.useSkill(p, 'curve_pass');
    const pinged = lofted && !cross && d > 28 && toU(p.team, aim.x) > toU(p.team, p.pos.x) && this.useSkill(p, 'long_ball');
    const err =
      (0.012 + (1 - skill) * 0.1 + pressure * 0.07 * (1.3 - (0.6 * this.attr(p, 'composure')) / 99)) *
      (lofted ? 1.3 : 1) *
      this.weather.passErr *
      (pinpoint || precise || curl || pinged ? 0.25 : 1);
    let dir = rotate(norm(sub(aim, p.pos)), this.rng.gauss() * err);
    const dErr = Math.max(3, d * (1 + this.rng.gauss() * err * 0.7));
    // A curled pass sets off away from the defender in the lane and swings back onto the aim along
    // a circular arc: start CURL_ANGLE off the straight line, turn at a constant curvature.
    let curve = 0;
    if (curl && blocker) {
      const ab = sub(aim, p.pos);
      const ao = sub(blocker.pos, p.pos);
      curve = ab.x * ao.y - ab.y * ao.x > 0 ? -1 : 1;
      dir = rotate(dir, curve * CURL_ANGLE);
    }
    const arc = curve ? CURL_ANGLE / Math.sin(CURL_ANGLE) : 1;
    const speed = C.kickSpeed(dErr * arc, lofted, this.groundK, this.weather.arrive) + (pinged ? 6 : 0);
    b.curl = curve ? (-curve * 2 * Math.sin(CURL_ANGLE)) / dErr : 0;
    b.curlTarget = { ...aim };
    b.owner = null;
    b.vel = scale(dir, speed);
    b.receiver = m.id;
    b.fumbler = null;
    b.passer = p.id;
    b.noTouchTimer = 0.3;
    b.lofted = lofted;
    b.loftFrom = { ...p.pos };
    b.loftDist = dErr;
    b.cross = cross;
    b.crossQuality = cross ? Math.min(1, skill + (pinpoint ? 0.3 : 0)) : 0;
    b.threaded = precise || curl;
    b.lastTeam = p.team;
    this.stats[p.team].passes++;
    p.ps.passes++;
    if (cross) this.stats[p.team].crosses++;
    // The receiver attacks the ball.
    m.runTarget = null;
    p.action = 'position';
    p.decisionCd = 0.5;
    this.effect('pass', p.pos, p.team, { tx: aim.x, ty: aim.y, curve: curve || undefined });
  }

  /** The opponent standing closest to the middle of a pass lane, if one is in the way. */
  private laneBlocker(p: SimPlayer, aim: Vec): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = 2.5;
    for (const o of this.onPitch) {
      if (o.team === p.team) continue;
      const { d, t } = this.segDist(o.pos, p.pos, aim);
      if (t > 0.15 && t < 0.85 && d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private shoot(p: SimPlayer, xg: number, header: boolean, pGoalOverride?: number, bonus = 1): void {
    const b = this.ball;
    const t = p.team;
    const kp = this.keeper((1 - t) as TeamSide);
    const gk = kp ? this.attr(kp, 'goalkeeping') : 25;
    const dGoal = dist(p.pos, this.attackGoal(t));
    // On a wet pitch a strike from distance skids off the surface and is hard to hold.
    const skid = !header && dGoal > 16 ? 1 + this.weather.slick : 1;
    // Shooting skills: a thunderbolt from distance, or a curler inside the box.
    const open = pGoalOverride === undefined && !header;
    const power = open && dGoal > 16 && this.useSkill(p, 'power_shot');
    const finesse = open && dGoal <= 16 && this.useSkill(p, 'finesse_shot');
    // Cutting in off the flank opens up the near post: shots soon after are struck with extra accuracy.
    const cutIn = !header && this.time < p.cutUntil ? 1.3 : 1;
    const special = (power ? 1.6 : finesse ? 1.45 : 1) * cutIn * bonus;
    // An aware keeper is always in the right place, narrowing the angle.
    const angle = kp?.skills.has('awareness') ? 0.88 : 1;
    const pGoal = pGoalOverride ?? clamp(xg * this.finishMult(p, header) * (2.25 - (gk / 99) * 1.1) * skid * special * angle, 0.01, 0.9);
    const fin = this.attr(p, header ? 'heading' : 'finishing') / 99;
    const gx = t === 0 ? C.PITCH_L + 0.5 : -0.5;
    let outcome: Shot['outcome'];
    let gy: number;
    // Keeper skills can turn a goal into a save.
    const stopped = () => kp !== undefined && (pGoalOverride !== undefined ? this.useSkill(kp, 'penalty_stopper') : this.useSkill(kp, 'cat_reflexes'));
    if (this.rng.next() < pGoal && !stopped()) {
      outcome = 'goal';
      const side = kp && kp.pos.y < C.PITCH_W / 2 ? 1 : -1;
      gy = C.PITCH_W / 2 + side * this.rng.range(1.2, 3.3);
    } else if (this.rng.next() < clamp(0.32 + 0.3 * fin - dGoal * 0.004 + (special > 1 ? 0.25 : 0), 0.15, 0.8)) {
      outcome = 'saved';
      gy = kp ? clamp(kp.pos.y + this.rng.gauss() * 1.2, C.GOAL_Y0 + 0.4, C.GOAL_Y1 - 0.4) : C.PITCH_W / 2;
    } else {
      outcome = 'miss';
      gy = C.PITCH_W / 2 + (this.rng.chance(0.5) ? 1 : -1) * (C.GOAL_W / 2 + this.rng.range(0.4, 4));
    }
    const speed = 24 + 8 * fin + (power ? 7 : 0);
    b.owner = null;
    b.vel = scale(norm(sub(vec(gx, gy), p.pos)), speed);
    b.lofted = false;
    b.cross = false;
    b.receiver = null;
    b.passer = null;
    b.noTouchTimer = 0.3;
    b.lastTeam = t;
    // Penalties can't be blocked; everyone else gets a chance as the ball flies past.
    b.shot = { team: t, shooter: p.id, outcome, checked: pGoalOverride !== undefined ? this.onPitch.map((q) => q.id) : [] };
    this.stats[t].shots++;
    this.stats[t].xg += pGoalOverride ?? xg;
    p.ps.shots++;
    if (outcome !== 'miss') {
      this.stats[t].shotsOnTarget++;
      p.ps.onTarget++;
    }
    if (p.receivedFrom !== null && this.time - p.receivedAt < 4) {
      const from = this.players[p.receivedFrom];
      if (from.team === t) from.ps.keyPasses++;
    }
    p.action = 'position';
    p.decisionCd = 0.5;
    this.effect(header ? 'header' : 'shot', p.pos, t);
  }

  // ---------------------------------------------------------------- movement

  private move(p: SimPlayer): void {
    const b = this.ball;
    const carrying = b.owner === p.id;
    // A carrier with a man tight on him is jockeyed and can't run at full tilt; strong players shield it better.
    const shielding = p.skills.has('hold_up') ? 0.4 : 1;
    const jockeyed = carrying ? 1 - 0.12 * Math.min(1, this.pressureOn(p)) * (1.2 - (0.4 * this.attr(p, 'strength')) / 99) * shielding : 1;
    const vmax = this.maxSpeed(p) * (carrying ? 0.82 + (0.12 * this.attr(p, 'dribbling')) / 99 : 1) * jockeyed;
    const cap = vmax * p.urgency;
    const to = sub(p.target, p.pos);
    const d = len(to);
    let desired = d < 0.25 ? vec() : scale(to, Math.min(cap, d * 2) / d);
    for (const q of this.onPitch) {
      if (q === p || q.team !== p.team) continue;
      const dd = dist(p.pos, q.pos);
      if (dd < 2 && dd > 0.01) desired = add(desired, scale(sub(p.pos, q.pos), ((2 - dd) * 1.5) / dd));
    }
    let dv = sub(desired, p.vel);
    const dvl = len(dv);
    const maxDv = this.accel(p) * C.TICK;
    if (dvl > maxDv) dv = scale(dv, maxDv / dvl);
    p.vel = add(p.vel, dv);
    p.pos = add(p.pos, scale(p.vel, C.TICK));
    if (carrying) {
      p.pos.x = clamp(p.pos.x, 0.4, C.PITCH_L - 0.4);
      p.pos.y = clamp(p.pos.y, 0.4, C.PITCH_W - 0.4);
    } else {
      p.pos.x = clamp(p.pos.x, -1.5, C.PITCH_L + 1.5);
      p.pos.y = clamp(p.pos.y, -1.5, C.PITCH_W + 1.5);
    }
    const frac = len(p.vel) / (5.2 + (3.3 * p.data.attrs.pace) / 99);
    const drain =
      (0.00025 + 0.0011 * frac * frac) *
      (1.35 - (0.7 * p.data.attrs.stamina) / 99) *
      (p.action === 'press' ? 1.6 : 1) *
      (this.possession !== p.team ? 1 + 0.15 * this.tactics(p.team).team.pressing : 1) *
      // A high-tempo game takes it out of the legs; a slow one saves them.
      (1 + 0.12 * this.tactics(p.team).team.tempo) *
      this.weather.stamina *
      (p.skills.has('tireless') ? 0.7 : 1);
    p.stamina = Math.max(0.2, p.stamina - drain * C.TICK);
    this.stats[p.team].staminaUsed += drain * C.TICK;
  }

  // ---------------------------------------------------------------- ball

  private updateBall(): void {
    const b = this.ball;
    if (b.noTouchTimer > 0) b.noTouchTimer -= C.TICK;
    if (b.owner !== null) {
      const o = this.players[b.owner];
      const sp = len(o.vel);
      const dir = sp > 0.3 ? scale(o.vel, 1 / sp) : norm(sub(this.attackGoal(o.team), o.pos));
      b.pos = add(o.pos, scale(dir, 0.55));
      b.vel = { ...o.vel };
      b.height = 0;
      return;
    }
    const from = { ...b.pos };
    const k = b.shot ? C.SHOT_K : b.lofted ? C.AIR_K : this.groundK;
    b.pos = add(b.pos, scale(b.vel, C.TICK));
    // A curled pass keeps bending at constant curvature until someone takes it.
    if (b.curl && b.receiver !== null && !b.shot) b.vel = rotate(b.vel, b.curl * len(b.vel) * C.TICK);
    b.vel = scale(b.vel, Math.exp(-k * C.TICK));
    if (b.lofted) {
      const f = dist(b.pos, b.loftFrom) / Math.max(1, b.loftDist);
      if (f >= 1) {
        b.lofted = false;
        b.height = 0;
        b.vel = scale(b.vel, C.LANDING_DAMP);
      } else {
        b.height = 4 * Math.min(8, b.loftDist * 0.18) * f * (1 - f);
        // Wind pushes a ball in the air off its line.
        b.vel = add(b.vel, scale(this.weather.wind, C.TICK));
      }
    } else b.height = 0;

    if (b.shot) {
      if (this.checkShotBlock(from)) return;
      return this.checkShot();
    }
    if (b.pos.y < 0 || b.pos.y > C.PITCH_W) return this.throwIn();
    if (b.pos.x < 0 || b.pos.x > C.PITCH_L) return this.byline();
    this.tryPickup(from);
  }

  /** Any defender the shot passes through this tick gets one chance to block it. */
  private checkShotBlock(from: Vec): boolean {
    const b = this.ball;
    const s = b.shot!;
    for (const o of this.onPitch) {
      if (o.team === s.team || o.isGK || s.checked.includes(o.id)) continue;
      // A last-ditch blocker gets a leg to shots others couldn't reach, and rarely lets one through.
      const d = this.segDist(o.pos, from, b.pos).d;
      if (d > (o.skills.has('last_ditch') ? 1.7 : 0.95)) continue;
      s.checked.push(o.id);
      const lunge = this.useSkill(o, 'last_ditch');
      // A good finisher picks his spot past the man in front of him.
      const placed = 1.35 - (0.7 * this.attr(this.players[s.shooter], 'finishing')) / 99;
      if (!lunge && (d > 0.95 || !this.rng.chance((0.3 + (0.3 * this.attr(o, 'positioning')) / 99) * placed))) continue;
      // Blocked: the ball cannons off the defender.
      this.stats[o.team].blocks++;
      o.ps.blocks++;
      if (s.outcome !== 'miss') {
        this.stats[s.team].shotsOnTarget--;
        this.players[s.shooter].ps.onTarget--;
      }
      const back = rotate(norm(scale(b.vel, -1)), this.rng.range(-1.3, 1.3));
      b.shot = null;
      b.pos = { ...o.pos };
      b.vel = scale(back, this.rng.range(5, 12));
      b.receiver = null;
      b.passer = null;
      b.noTouchTimer = 0.2;
      b.lastTeam = o.team;
      this.effect('block', o.pos, o.team);
      return true;
    }
    return false;
  }

  private tryPickup(from: Vec): void {
    const b = this.ball;
    const speed = len(b.vel);
    if (b.lofted && dist(b.pos, b.loftFrom) / b.loftDist < 0.82) return;
    if ((b.cross || b.lofted) && b.passer !== null) {
      // A dropping ball is contested in the air by the passing side's nearest player.
      const attTeam = this.players[b.passer].team;
      let att: SimPlayer | null = null;
      for (const p of this.onPitch) {
        if (p.team === attTeam && !p.isGK && dist(p.pos, b.pos) < 2.5 && (!att || dist(p.pos, b.pos) < dist(att.pos, b.pos))) att = p;
      }
      if (att) return this.aerialDuel(att);
    }
    // Use the ball's path over this tick so fast passes can't skip through a player.
    const near: { p: SimPlayer; d: number }[] = [];
    for (const p of this.onPitch) {
      if (b.noTouchTimer > 0 && (p.id === b.passer || p.id === b.fumbler)) continue;
      const r = p.isGK && this.inAttackingBox((1 - p.team) as TeamSide, p.pos) ? 1.8 : p.id === b.receiver ? 1.5 : C.CONTROL_RADIUS;
      const d = this.segDist(p.pos, from, b.pos).d;
      if (d <= r) near.push({ p, d });
    }
    if (!near.length) return;
    near.sort((a, c) => a.d - c.d);
    for (const { p } of near) {
      if (p.id === b.receiver) {
        // First touch: a fast ball, a defender tight on him or poor technique can see it bounce off him.
        const tech = (0.6 * this.attr(p, 'dribbling') + 0.4 * this.attr(p, 'composure')) / 99;
        const heavy = clamp((speed - 5) / 30 + (b.cross ? 0.1 : 0), 0, 0.4) * (1.1 - tech) * (0.15 + 0.85 * Math.min(1, this.pressureOn(p))) * this.weather.touch;
        if (this.rng.chance(heavy) && !this.useSkill(p, 'first_touch')) {
          b.vel = scale(rotate(vec(1, 0), this.rng.range(0, Math.PI * 2)), this.rng.range(2, 4));
          b.receiver = null;
          b.passer = null;
          b.lofted = false;
          b.cross = false;
          b.fumbler = p.id;
          b.noTouchTimer = 0.3;
          return;
        }
        return this.setOwner(p);
      }
      const marker = b.receiver !== null && this.marks.get(p.id) === b.receiver ? (0.25 * this.attr(p, 'marking')) / 99 : 0;
      const reader = p.skills.has('interceptor') ? 0.25 : 0;
      // A precision pass is weighted to beat the man in the way.
      const killer = b.threaded && b.receiver !== null && b.passer !== null && this.players[b.passer].team !== p.team ? 0.35 : 1;
      const chance = clamp(1.1 - speed / 30, 0.3, 0.95) * (0.45 + (0.6 * this.attr(p, 'positioning')) / 99 + marker + reader) * killer;
      if (this.rng.chance(chance)) return this.setOwner(p);
    }
  }

  private aerialDuel(att: SimPlayer): void {
    const b = this.ball;
    let def: SimPlayer | null = null;
    for (const o of this.onPitch) {
      if (o.team === att.team || dist(o.pos, att.pos) > 2.5) continue;
      if (!def || this.aerialScore(o) > this.aerialScore(def)) def = o;
    }
    // A well-delivered cross arrives where the attacker wants it.
    const delivery = b.cross ? (b.crossQuality - 0.6) * 0.4 : 0;
    // Skills settle the duel outright, unless both fire and cancel out.
    const threat = def !== null && this.useSkill(att, 'aerial_threat');
    const guard = def !== null && this.useSkill(def, 'aerial_guardian');
    const attWins = !def || (threat && !guard) || (threat === guard && this.rng.chance(clamp(0.5 + (this.aerialScore(att) - this.aerialScore(def)) / 99 + delivery, 0.15, 0.85)));
    if (attWins) {
      if (def) att.ps.aerialsWon++;
      const dGoal = dist(att.pos, this.attackGoal(att.team));
      // A volleyer meets it first time on the full, with his feet, from further out than a header.
      if (dGoal < 20 && this.useSkill(att, 'volley')) {
        b.pos = { ...att.pos };
        return this.shoot(att, this.shotXg(att, def ? 0.4 : 0, false), false, undefined, 1.35);
      }
      if (dGoal < 16) {
        b.pos = { ...att.pos };
        return this.shoot(att, this.shotXg(att, def ? 0.4 : 0, true), true);
      }
      return this.setOwner(att);
    }
    if (!def) return; // unreachable: an unchallenged header always goes to the attacker
    def.ps.aerialsWon++;
    this.effect('header', def.pos, def.team);
    // Defender wins it: sometimes only a flick-on that drops loose for a second ball, otherwise a clearance.
    if (this.rng.chance(b.cross ? 0.2 : 0.35)) {
      b.vel = scale(rotate(vec(1, 0), this.rng.range(0, Math.PI * 2)), this.rng.range(3, 7));
      b.lofted = false;
      b.cross = false;
      b.receiver = null;
      b.passer = null;
      b.noTouchTimer = 0.2;
      b.lastTeam = def.team;
      return;
    }
    const away = rotate(norm(sub(this.attackGoal(def.team), def.pos)), this.rng.range(-0.7, 0.7));
    const range = this.rng.range(18, 30);
    b.vel = scale(away, C.kickSpeed(range, true));
    b.lofted = true;
    b.loftFrom = { ...b.pos };
    b.loftDist = range;
    b.cross = false;
    b.receiver = null;
    b.passer = def.id;
    b.noTouchTimer = 0.3;
    b.lastTeam = def.team;
  }

  private setOwner(p: SimPlayer): void {
    const b = this.ball;
    b.fumbler = null;
    p.gotBallAt = this.time;
    const prev = this.possession;
    if (b.passer !== null && !b.shot) {
      const passer = this.players[b.passer];
      if (passer.team === p.team && passer.id !== p.id) {
        this.stats[p.team].passesCompleted++;
        passer.ps.passesOk++;
        p.receivedFrom = passer.id;
        p.receivedAt = this.time;
      } else if (passer.team !== p.team && !p.isGK) {
        this.stats[p.team].interceptions++;
        p.ps.interceptions++;
        if (!this.useSkill(p, 'interceptor')) this.useSkill(p, 'awareness');
      }
    }
    b.owner = p.id;
    b.vel = vec();
    b.receiver = null;
    b.passer = null;
    b.lofted = false;
    b.cross = false;
    b.threaded = false;
    b.curl = 0;
    b.shot = null;
    b.height = 0;
    b.lastTeam = p.team;
    const ti = this.tactics(p.team).team;
    p.decisionCd = 0.25 + 0.3 * (1 - this.attr(p, 'composure') / 99) - 0.08 * ti.tempo;
    p.action = 'hold';
    p.runTarget = null;
    if (p.team !== prev) {
      this.lostBallAt[prev] = this.time;
      this.regainAt[p.team] = this.time;
      this.possStart[p.team] = this.time;
      if (toU(p.team, b.pos.x) > 0.5) this.stats[p.team].highTurnovers++;
      for (const q of this.onPitch) if (q.team === prev) q.runTarget = null;
    }
    this.possession = p.team;
    // A keeper who takes the ball off the opposition gathers it and play resets.
    if (p.isGK && p.team !== prev) this.startKeeperReset(p);
  }

  private checkShot(): void {
    const b = this.ball;
    const s = b.shot!;
    const def = (1 - s.team) as TeamSide;
    const kp = this.keeper(def);
    if (s.outcome === 'saved' && kp && dist(b.pos, kp.pos) < 1.7) return this.resolveSave(kp);
    const crossed = s.team === 0 ? b.pos.x >= C.PITCH_L : b.pos.x <= 0;
    if (crossed) {
      if (s.outcome === 'goal') return this.goal(s.team, this.players[s.shooter]);
      if (s.outcome === 'saved' && kp) return this.resolveSave(kp);
      this.emit('miss', s.team, `${this.players[s.shooter].data.name} fires wide`);
      return this.goalKick(def, b.pos.y);
    }
    if (len(b.vel) < 2) b.shot = null;
  }

  private resolveSave(kp: SimPlayer): void {
    const b = this.ball;
    const shooter = b.shot ? this.players[b.shot.shooter] : null;
    this.emit('save', kp.team, `Save by ${kp.data.name}${shooter ? ` from ${shooter.data.name}` : ''}`);
    kp.ps.saves++;
    this.useSkill(kp, 'awareness');
    this.effect('save', kp.pos, kp.team);
    b.pos = { x: clamp(b.pos.x, 0.3, C.PITCH_L - 0.3), y: clamp(b.pos.y, 0.3, C.PITCH_W - 0.3) };
    const held = this.rng.chance((0.45 + (0.4 * this.attr(kp, 'goalkeeping')) / 99) * this.weather.grip);
    if (held || this.useSkill(kp, 'safe_hands')) {
      b.shot = null;
      this.setOwner(kp);
      return;
    }
    // Parried back into play.
    const away = rotate(norm(sub(this.attackGoal(kp.team), kp.pos)), this.rng.range(-1.2, 1.2));
    b.shot = null;
    b.vel = scale(away, this.rng.range(7, 13));
    b.receiver = null;
    b.passer = null;
    b.noTouchTimer = 0.25;
    b.lastTeam = kp.team;
  }

  private goal(team: TeamSide, scorer: SimPlayer | null): void {
    const b = this.ball;
    this.score[team]++;
    let text: string;
    if (scorer && scorer.team === team) {
      scorer.ps.goals++;
      const helper = scorer.receivedFrom !== null && this.time - scorer.receivedAt < 10 ? this.players[scorer.receivedFrom] : null;
      if (helper && helper.team === team) helper.ps.assists++;
      text = `GOAL! ${scorer.data.name}${helper && helper.team === team ? ` (assist ${helper.data.name})` : ''}`;
    } else text = 'GOAL! Own goal';
    this.emit('goal', team, `${text} · ${this.teams[team].short} ${this.score[0]}-${this.score[1]}`);
    this.effect('goal', b.pos, team);
    b.shot = null;
    b.vel = scale(b.vel, 0.15);
    this.setRestart('kickoff', (1 - team) as TeamSide, vec(C.PITCH_L / 2, C.PITCH_W / 2), 3.5, false);
  }

  private throwIn(): void {
    const b = this.ball;
    const team = (1 - b.lastTeam) as TeamSide;
    this.setRestart('throwin', team, vec(clamp(b.pos.x, 1, C.PITCH_L - 1), b.pos.y < 0 ? 0.3 : C.PITCH_W - 0.3));
  }

  private byline(): void {
    const b = this.ball;
    const defTeam: TeamSide = b.pos.x < 0 ? 0 : 1;
    const attTeam = (1 - defTeam) as TeamSide;
    if (b.pos.y > C.GOAL_Y0 && b.pos.y < C.GOAL_Y1) return this.goal(attTeam, null);
    if (b.lastTeam === defTeam) {
      this.stats[attTeam].corners++;
      const x = b.pos.x < 0 ? 0.5 : C.PITCH_L - 0.5;
      return this.setRestart('corner', attTeam, vec(x, b.pos.y < C.PITCH_W / 2 ? 0.5 : C.PITCH_W - 0.5));
    }
    this.goalKick(defTeam, b.pos.y);
  }

  private goalKick(team: TeamSide, y: number): void {
    const x = team === 0 ? 5.5 : C.PITCH_L - 5.5;
    this.setRestart('goalkick', team, vec(x, C.PITCH_W / 2 + (y < C.PITCH_W / 2 ? -6 : 6)));
  }

  // ---------------------------------------------------------------- challenges

  private resolveChallenges(): void {
    // Nobody challenges a keeper with the ball in his hands.
    if (this.reset) return;
    const carrier = this.players[this.ball.owner!];
    for (const def of this.onPitch) {
      if (def.team === carrier.team || def.tackleCd > 0) continue;
      const d = dist(def.pos, carrier.pos);
      if (d > (def.skills.has('sliding_tackle') ? 2.8 : 1.7)) continue;
      if (def.isGK && !this.inAttackingBox(carrier.team, carrier.pos)) continue;
      const ti = this.tactics(def.team).team;
      const agg = ti.tackling * 0.5 + def.instr.aggression * 0.35 + (def.data.attrs.aggression - 50) / 100;
      // In their own box defenders jockey and only dive in when they must; good tacklers stay cleaner.
      const box = this.inAttackingBox(carrier.team, carrier.pos);
      const rate = 1.1 * (1 + 0.6 * agg) * def.role.w.tackle * (this.pressers.has(def.id) ? 1.5 + 0.3 * ti.pressing : 1) * (box ? 0.4 : 1);
      if (!this.rng.chance(rate * C.TICK)) continue;
      // Beyond normal reach only a sliding tackle gets there.
      const slide = d > 1.7;
      if (slide && !this.useSkill(def, 'sliding_tackle')) continue;
      def.tackleCd = 0.9;
      this.stats[def.team].tackles++;
      def.ps.tackles++;
      // Skills: the carrier may flick it over him; a ball winner may time it perfectly.
      if (this.useSkill(carrier, 'rainbow_flick')) {
        def.tackleCd = 1.6;
        def.vel = vec();
        carrier.decisionCd = Math.min(carrier.decisionCd, 0.1);
        continue;
      }
      const winner = this.useSkill(def, 'ball_winner');
      const tk = this.attr(def, def.isGK ? 'goalkeeping' : 'tackling');
      const dr = this.attr(carrier, 'dribbling');
      // Always-on skills: a clean tackler rarely fouls and wins more; close control and a target
      // man's strength make the carrier much harder to dispossess.
      const clean = def.skills.has('clean_tackle');
      const glued = carrier.skills.has('close_control');
      const shield = carrier.skills.has('hold_up') && toU(carrier.team, carrier.pos.x) > 0.5;
      const pFoul = winner ? 0 : clamp(0.07 + 0.09 * agg + 0.1 * (1 - tk / 99), 0.02, 0.45) * (box ? 0.5 : 1) * (clean ? 0.35 : 1);
      const pWin = winner
        ? 0.95
        : clamp(
            0.42 +
              ((tk - dr) / 99) * 0.7 +
              0.08 * agg +
              ((def.data.attrs.strength - carrier.data.attrs.strength) / 99) * (shield ? 0.6 : 0.2) +
              (slide ? 0.15 : 0) +
              (clean ? 0.08 : 0) -
              (glued ? 0.12 : 0) -
              (shield ? 0.15 : 0),
            0.05,
            0.85,
          );
      if (this.rng.chance(pFoul)) return this.foul(def, carrier, agg);
      if (this.rng.chance(pWin)) {
        if (clean) this.useSkill(def, 'clean_tackle');
        this.stats[def.team].tacklesWon++;
        def.ps.tacklesWon++;
        this.effect('tackle', def.pos, def.team);
        if (this.rng.chance(0.65)) return this.setOwner(def);
        const b = this.ball;
        b.owner = null;
        b.vel = scale(rotate(vec(1, 0), this.rng.range(0, Math.PI * 2)), this.rng.range(4, 8));
        b.passer = null;
        b.receiver = null;
        b.noTouchTimer = 0.15;
        b.lastTeam = def.team;
        carrier.decisionCd = 0.4;
        return;
      }
      def.vel = scale(def.vel, 0.2);
      // The carrier rode the challenge: call out the skill that did it.
      if (glued) this.useSkill(carrier, 'close_control');
      else if (shield) this.useSkill(carrier, 'hold_up');
    }
  }

  private foul(def: SimPlayer, victim: SimPlayer, agg: number): void {
    const st = this.stats[def.team];
    st.fouls++;
    def.ps.fouls++;
    this.effect('foul', victim.pos, def.team);
    const pRed = clamp(0.008 + 0.012 * Math.max(0, agg), 0, 0.05);
    const pYellow = clamp(0.12 + 0.12 * agg, 0.04, 0.45);
    const r = this.rng.next();
    if (r < pRed || (r < pRed + pYellow && def.yellows >= 1)) {
      def.yellows++;
      st.reds++;
      def.ps.red++;
      def.sentOff = true;
      def.active = false;
      def.offAt = this.time;
      this.refreshOnPitch();
      this.effect('card', def.pos, def.team, { red: true });
      this.emit('red', def.team, `RED CARD: ${def.data.name} (${this.teams[def.team].short})`);
    } else if (r < pRed + pYellow) {
      def.yellows++;
      st.yellows++;
      def.ps.yellow++;
      this.effect('card', def.pos, def.team, { red: false });
      this.emit('yellow', def.team, `Yellow card: ${def.data.name} (${this.teams[def.team].short})`);
    }
    if (this.inAttackingBox(victim.team, victim.pos)) {
      this.emit('penalty', victim.team, `PENALTY to ${this.teams[victim.team].short}!`);
      const spot = victim.team === 0 ? C.PITCH_L - C.PEN_SPOT : C.PEN_SPOT;
      return this.setRestart('penalty', victim.team, vec(spot, C.PITCH_W / 2));
    }
    this.setRestart('freekick', victim.team, this.clampPitch(victim.pos));
  }

  // ---------------------------------------------------------------- restarts

  private setRestart(type: RestartType, team: TeamSide, pos: Vec, timer = RESTART_TIME[type], placeBall = true): void {
    const b = this.ball;
    b.owner = null;
    b.receiver = null;
    b.passer = null;
    b.lofted = false;
    b.cross = false;
    b.shot = null;
    b.height = 0;
    if (placeBall) {
      b.vel = vec();
      b.pos = { ...pos };
    }
    this.phase = 'restart';
    if (team !== this.possession) this.possStart[team] = this.time;
    this.possession = team;
    this.restart = { type, team, pos: { ...pos }, taker: this.chooseTaker(type, team, pos), timer, teleported: false };
    for (const p of this.onPitch) {
      p.runTarget = null;
      p.supportTarget = null;
      p.action = 'position';
      p.mustPass = false;
    }
  }

  private chooseTaker(type: RestartType, team: TeamSide, pos: Vec): number {
    const mine = this.teamOn(team);
    const outfield = mine.filter((p) => !p.isGK);
    if (type === 'goalkick') return (this.keeper(team) ?? outfield[0]).id;
    if (type === 'penalty') {
      return outfield.reduce((a, c) => (this.attr(c, 'finishing') > this.attr(a, 'finishing') ? c : a)).id;
    }
    if (type === 'kickoff') {
      return outfield.reduce((a, c) => (this.formation(team).slots[c.slot].u > this.formation(team).slots[a.slot].u ? c : a)).id;
    }
    return outfield.reduce((a, c) => (dist(c.pos, pos) < dist(a.pos, pos) ? c : a)).id;
  }

  private restartTarget(p: SimPlayer, r: Restart): Vec {
    const ti = this.tactics(p.team).team;
    if (p.isGK) return keeperTarget(p.team, r.pos, !!p.role.sweeper, ti.lineHeight);
    const slot = this.formation(p.team).slots[p.slot];
    let t = formationTarget(p.team, slot, p.role, p.instr, { ball: r.pos, inPossession: p.team === r.team, ti });
    if (r.type === 'kickoff') {
      t = fromUV(p.team, Math.min(toU(p.team, t.x), 0.47), toV(p.team, t.y));
      if (p.team !== r.team) t = this.pushOut(t, r.pos, C.CIRCLE_R + 0.5);
    } else if (r.type === 'penalty') {
      if (toU(r.team, t.x) > 0.82) t = fromUV(r.team, 0.8, toV(r.team, t.y));
    } else if (p.team !== r.team && (r.type === 'freekick' || r.type === 'corner')) {
      t = this.pushOut(t, r.pos, 9.5);
    }
    return t;
  }

  private pushOut(t: Vec, from: Vec, radius: number): Vec {
    const d = dist(t, from);
    if (d >= radius) return t;
    const dir = d > 0.01 ? norm(sub(t, from)) : vec(1, 0);
    return this.clampPitch(add(from, scale(dir, radius)));
  }

  private teleportKickoff(r: Restart): void {
    const b = this.ball;
    b.pos = { ...r.pos };
    b.prevPos = { ...r.pos };
    b.vel = vec();
    for (const p of this.onPitch) {
      const t = p.id === r.taker ? add(r.pos, vec(r.team === 0 ? -0.6 : 0.6, 0)) : this.restartTarget(p, r);
      p.pos = { ...t };
      p.prevPos = { ...t };
      p.vel = vec();
      p.target = { ...t };
    }
  }

  private stepRestart(): void {
    const r = this.restart!;
    r.timer -= C.TICK;
    if (r.type === 'kickoff' && !r.teleported) {
      if (r.timer <= 1.5) {
        this.teleportKickoff(r);
        r.teleported = true;
      } else {
        // Goal celebration: everyone eases to a stop while the ball nestles in the net.
        for (const p of this.onPitch) {
          p.vel = scale(p.vel, 0.92);
          p.pos = add(p.pos, scale(p.vel, C.TICK));
        }
        this.ball.pos = add(this.ball.pos, scale(this.ball.vel, C.TICK));
        this.ball.vel = scale(this.ball.vel, 0.85);
        return;
      }
    }
    let taker = this.players[r.taker];
    if (!taker.active) {
      r.taker = this.chooseTaker(r.type, r.team, r.pos);
      taker = this.players[r.taker];
    }
    const behind = add(r.pos, scale(norm(sub(this.ownGoal(r.team), r.pos)), 0.6));
    for (const p of this.onPitch) {
      if (p.id === r.taker) {
        p.target = behind;
        p.urgency = 1;
      } else {
        p.target = this.restartTarget(p, r);
        p.urgency = 0.75;
      }
      this.move(p);
    }
    if (r.timer > 0) return;

    taker.pos = { ...behind };
    taker.vel = vec();
    this.ball.pos = { ...r.pos };
    this.phase = 'play';
    this.restart = null;
    this.setOwner(taker);
    taker.decisionCd = r.type === 'kickoff' ? 0.2 : 0;
    taker.mustPass = r.type === 'throwin' || r.type === 'goalkick' || r.type === 'corner' || r.type === 'kickoff';
    if (r.type === 'corner') this.computeBoxRuns();
    if (r.type === 'penalty') {
      const kp = this.keeper((1 - r.team) as TeamSide);
      const pGoal = clamp(0.62 + (0.25 * this.attr(taker, 'finishing')) / 99 - (kp ? (0.15 * this.attr(kp, 'goalkeeping')) / 99 : 0), 0.5, 0.9);
      this.shoot(taker, 0.76, false, pGoal);
    }
  }
}
