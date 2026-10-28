import { Rng } from '../sim/rng';
import type { Match } from '../sim/match';
import { WEATHER, Weather, rollWeather } from '../sim/weather';
import { TEAM_NAMES, TeamSetup, makePlayerAt, makeTeam, randomAiTactics } from '../data/generator';
import { defaultRole } from '../tactics/roles';
import { AttrKey, Player, SLOT_GROUP, SlotPos, overall } from '../data/player';
import { SKILLS, SkillId, skillsFor } from '../data/skills';
import { CosmeticDef, CosmeticKind, rollCosmetic } from '../data/cosmetics';
import { FORMATIONS } from '../tactics/formations';
import { cloneTactics, defaultPlayerInstructions, defaultTeamInstructions } from '../tactics/instructions';
import { Club, collectCosmetic, saveClub, squadRating } from './club';

/**
 * Cup runs: the roguelike mode. Pay an entry fee, draft a fresh squad one position at a time,
 * then win five knockout ties in a row against stronger and stranger opponents. Every win earns
 * a boon for the rest of the run; one defeat ends it (unless a Second Chance saves you). Rewards
 * scale with how far you get, and each cup won permanently improves scouting for future drafts.
 */

export const ROUND_NAMES = ['Round 1', 'Round 2', 'Quarter-final', 'Semi-final', 'Final'];
export const ENTRY_FEE = 400;
/** Coins for going out in each round (index = round reached); the last entry is for winning. */
export const REWARDS = [150, 300, 600, 1200, 2500, 5000];
/** Opponent strength by round, relative to the draft base (actual squad rating, not the generator target). */
const OPPONENT_STEP = [-4, -1, 2, 4, 6];
/** Generated squads come out about this much stronger than the quality they are built from. */
const GENERATOR_LIFT = 6;
const MAX_SCOUTING = 5;
/** Rating the draft is built around before any scouting. */
const DRAFT_BASE = 58;

export type TwistId = 'storm' | 'snow' | 'heat' | 'fortress' | 'striker' | 'press' | 'injuries' | 'hostile' | 'fatigue';

export interface Twist {
  id: TwistId;
  name: string;
  icon: string;
  desc: string;
}

export const TWISTS: Record<TwistId, Twist> = {
  storm: { id: 'storm', name: 'Thunderstorm', icon: '⛈️', desc: 'Played in a storm: the ball skids and long balls drift.' },
  snow: { id: 'snow', name: 'Snowbound', icon: '🌨️', desc: 'Played in snow: the ball holds up and players slip.' },
  heat: { id: 'heat', name: 'Heatwave', icon: '🔥', desc: 'Played in the heat: legs go fast.' },
  fortress: { id: 'fortress', name: 'Brick Wall', icon: '🧤', desc: 'Their keeper is in the form of his life (+12 goalkeeping).' },
  striker: { id: 'striker', name: 'Red-hot Striker', icon: '🎯', desc: 'Their forwards are on fire (+10 finishing).' },
  press: { id: 'press', name: 'Pressing Machine', icon: '⚡', desc: 'They press high and fast all game.' },
  injuries: { id: 'injuries', name: 'Injury Crisis', icon: '🩹', desc: 'Your two best outfield starters miss this tie.' },
  hostile: { id: 'hostile', name: 'Hostile Crowd', icon: '📣', desc: 'A wall of noise: your players lose their cool (-10 composure).' },
  fatigue: { id: 'fatigue', name: 'Long Trip', icon: '🚌', desc: 'A long journey: your players start 15% down on fitness.' },
};
const TWIST_IDS = Object.keys(TWISTS) as TwistId[];

export type BoonId = 'pace' | 'clinical' | 'wall' | 'engine' | 'aerial' | 'physio' | 'captain' | 'second' | 'shootout' | 'signing' | 'masterclass';

export interface Boon {
  id: BoonId;
  name: string;
  icon: string;
  desc: string;
  /** Can only be held once per run. */
  unique?: boolean;
}

export const BOONS: Record<BoonId, Boon> = {
  pace: { id: 'pace', name: 'Wing Speed', icon: '💨', desc: 'Wide players and forwards gain +5 pace and acceleration.' },
  clinical: { id: 'clinical', name: 'Clinical', icon: '🎯', desc: 'The whole squad gains +5 finishing.' },
  wall: { id: 'wall', name: 'The Wall', icon: '🧱', desc: 'Keepers gain +8 goalkeeping; defenders +4 positioning and marking.' },
  engine: { id: 'engine', name: 'Engine Room', icon: '⚙️', desc: 'Midfielders gain +5 stamina and passing.' },
  aerial: { id: 'aerial', name: 'Aerial Threat', icon: '🦒', desc: 'The whole squad gains +5 heading and strength.' },
  physio: { id: 'physio', name: 'Physio Room', icon: '🩺', desc: 'Everyone back to full fitness now, and faster recovery between ties.', unique: true },
  captain: { id: 'captain', name: "Captain's Armband", icon: '©️', desc: 'The whole squad gains +6 composure.' },
  second: { id: 'second', name: 'Second Chance', icon: '❤️', desc: 'Survive one defeat: replay the tie instead of going out.', unique: true },
  shootout: { id: 'shootout', name: 'Spot-kick Specialists', icon: '🥅', desc: 'Your penalty takers score more and your keeper saves more in shootouts.', unique: true },
  signing: { id: 'signing', name: 'Marquee Signing', icon: '✍️', desc: 'A star replaces your weakest starter in the same position.' },
  masterclass: { id: 'masterclass', name: 'Masterclass', icon: '🎓', desc: 'Your best player learns a new skill.' },
};
const BOON_IDS = Object.keys(BOONS) as BoonId[];

export interface CupOpponent {
  name: string;
  short: string;
  color: string;
  rating: number;
  style: string;
  twist: TwistId;
  setup: TeamSetup;
}

export interface TieResult {
  gf: number;
  ga: number;
  /** Shootout score, when the tie was drawn. */
  pens?: [number, number];
  won: boolean;
}

export interface CupRun {
  seed: number;
  status: 'draft' | 'active' | 'won' | 'lost';
  /** Overall rating the draft is built around (rises with scouting). */
  base: number;
  /** The run squad. Built up during the draft, then played with for the whole run. */
  squad: TeamSetup;
  /** Draft progress: slot being picked and the three players on offer. */
  draft: { slot: number; options: Player[] } | null;
  round: number;
  opponents: CupOpponent[];
  results: TieResult[];
  boons: BoonId[];
  /** Boons on offer after a win, waiting to be chosen. */
  offer: BoonId[] | null;
  secondChance: boolean;
  /** A one-off message for the bracket (e.g. a Second Chance was used). */
  notice?: string;
  /** Prize paid when the run ended. */
  payout?: { coins: number; cosmetic?: { kind: CosmeticKind; def: CosmeticDef; duplicateCoins: number } };
}

export interface CupMeta {
  runs: number;
  cupsWon: number;
  /** Furthest round reached (index into ROUND_NAMES; 5 = won). */
  best: number;
  /** Permanent scouting level from cups won: better draft options. */
  scouting: number;
}

export const emptyMeta = (): CupMeta => ({ runs: 0, cupsWon: 0, best: -1, scouting: 0 });

const rngFor = (run: CupRun, step: number) => new Rng((run.seed ^ Math.imul(step + 1, 2654435761)) >>> 0);

// ---------------------------------------------------------------- starting and drafting

/** Pay the entry fee and start drafting. Returns null if the club can't afford it. */
export function startRun(club: Club, formation: string, seed = Date.now()): CupRun | null {
  if (club.coins < ENTRY_FEE) return null;
  club.coins -= ENTRY_FEE;
  const meta = (club.cupMeta ??= emptyMeta());
  meta.runs++;
  const base = DRAFT_BASE + 2 * meta.scouting;
  const run: CupRun = {
    seed: seed >>> 0,
    status: 'draft',
    base,
    squad: {
      name: club.team.name,
      short: club.team.short,
      color: club.team.color,
      kit: club.team.kit,
      ball: club.team.ball,
      crest: club.team.crest,
      squad: [],
      // Lineup slots fill in as players are drafted.
      tactics: { formation, lineup: [], roles: FORMATIONS[formation].slots.map((s) => defaultRole(s.pos)), instr: FORMATIONS[formation].slots.map(() => defaultPlayerInstructions()), team: defaultTeamInstructions() },
    },
    draft: null,
    round: 0,
    opponents: [],
    results: [],
    boons: [],
    offer: null,
    secondChance: false,
  };
  run.opponents = makeOpponents(run, club.team.short);
  run.draft = { slot: 0, options: draftOptions(run, 0) };
  club.cup = run;
  return run;
}

/** Three players for a slot: one safe pick, one solid, one gamble at a higher ceiling. */
function draftOptions(run: CupRun, slot: number): Player[] {
  const rng = rngFor(run, 100 + slot);
  const pos = FORMATIONS[run.squad.tactics.formation].slots[slot].pos;
  const taken = new Set(run.squad.squad.map((p) => p.number));
  const number = () => {
    let n = rng.int(2, 40);
    while (taken.has(n)) n = (n % 99) + 1;
    taken.add(n);
    return n;
  };
  const targets = [run.base + rng.int(-2, 2), run.base + rng.int(1, 5), run.base + rng.int(3, 10)];
  return targets.map((t) => {
    const p = makePlayerAt(rng, [pos], t, pos === 'GK' ? 1 : number());
    p.condition = 1;
    return p;
  });
}

/** Take one of the offered players for the current slot; after the last slot the bench is added. */
export function draftPick(run: CupRun, index: number): void {
  const d = run.draft;
  if (!d) return;
  const form = FORMATIONS[run.squad.tactics.formation];
  const p = d.options[index];
  run.squad.squad.push(p);
  run.squad.tactics.lineup[d.slot] = p.id;
  if (d.slot + 1 < form.slots.length) {
    run.draft = { slot: d.slot + 1, options: draftOptions(run, d.slot + 1) };
    return;
  }
  // Bench: a keeper and cover across the pitch, a step below the starters.
  const rng = rngFor(run, 99);
  const taken = new Set(run.squad.squad.map((p) => p.number));
  const benchPos: SlotPos[] = ['GK', 'CB', 'CM', 'LW', 'ST'];
  for (const pos of benchPos) {
    let n = rng.int(12, 40);
    while (taken.has(n)) n = (n % 99) + 1;
    taken.add(n);
    run.squad.squad.push(makePlayerAt(rng, [pos], run.base - 4 + rng.int(-2, 2), n));
  }
  run.draft = null;
  run.status = 'active';
}

/** Five opponents, each stronger than the last, each with a twist (no twist twice in a row). */
function makeOpponents(run: CupRun, avoidShort: string): CupOpponent[] {
  const rng = rngFor(run, 1);
  const names = TEAM_NAMES.filter((n) => n.short !== avoidShort);
  for (let i = names.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [names[i], names[j]] = [names[j], names[i]];
  }
  const twists = [...TWIST_IDS];
  for (let i = twists.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [twists[i], twists[j]] = [twists[j], twists[i]];
  }
  return ROUND_NAMES.map((_, r) => {
    const n = names[r];
    // Anchored to the unscouted base: scouting improves your draft, not the opposition.
    const target = DRAFT_BASE + OPPONENT_STEP[r];
    const setup = makeTeam(rng, n.name, n.short, n.color, target - GENERATOR_LIFT);
    const rating = squadRating(setup);
    const style = randomAiTactics(rng, setup);
    return { name: n.name, short: n.short, color: n.color, rating, style, twist: twists[r], setup };
  });
}

// ---------------------------------------------------------------- playing a tie

/** Both sides for the current tie, with its twist applied, plus the weather it is played in. */
export function tieSides(run: CupRun): { home: TeamSetup; away: TeamSetup; weather: Weather } {
  const opp = run.opponents[run.round];
  const twist = opp.twist;
  const rng = rngFor(run, 200 + run.round);
  const home: TeamSetup = { ...run.squad, tactics: cloneTactics(run.squad.tactics), squad: run.squad.squad.map((p) => ({ ...p, attrs: { ...p.attrs } })) };
  const away: TeamSetup = { ...opp.setup, tactics: cloneTactics(opp.setup.tactics), squad: opp.setup.squad.map((p) => ({ ...p, attrs: { ...p.attrs } })) };
  if (twist === 'fortress') for (const p of away.squad) if (p.positions[0] === 'GK') p.attrs.goalkeeping = Math.min(99, p.attrs.goalkeeping + 12);
  if (twist === 'striker') for (const p of away.squad) if (SLOT_GROUP[p.positions[0]] === 'FWD') p.attrs.finishing = Math.min(99, p.attrs.finishing + 10);
  if (twist === 'press') Object.assign(away.tactics.team, { pressing: 1, lineHeight: 1, tempo: 1, tackling: 1 });
  if (twist === 'hostile') for (const p of home.squad) p.attrs.composure = Math.max(1, p.attrs.composure - 10);
  if (twist === 'fatigue') for (const p of home.squad) p.condition = Math.max(0.3, p.condition - 0.15);
  if (twist === 'injuries') {
    // The two best outfield starters are out; the best bench players step in.
    const starters = home.tactics.lineup.map((id) => home.squad.find((p) => p.id === id)!).filter((p) => p.positions[0] !== 'GK');
    const out = [...starters].sort((a, b) => overall(b) - overall(a)).slice(0, 2);
    const bench = home.squad.filter((p) => !home.tactics.lineup.includes(p.id) && p.positions[0] !== 'GK').sort((a, b) => overall(b) - overall(a));
    out.forEach((p, i) => {
      const sub = bench[i];
      if (sub) home.tactics.lineup[home.tactics.lineup.indexOf(p.id)] = sub.id;
    });
  }
  const weather = twist === 'storm' ? rollStorm(rng) : twist === 'snow' ? WEATHER.snow : twist === 'heat' ? WEATHER.heat : rollWeather(rng);
  return { home, away, weather };
}

function rollStorm(rng: Rng): Weather {
  const ang = rng.next() * Math.PI * 2;
  return { ...WEATHER.storm, wind: { x: Math.cos(ang) * 2.2, y: Math.sin(ang) * 2.2 } };
}

/**
 * A penalty shootout: five each, then sudden death. Takers are the best finishers; the chance of
 * scoring depends on taker against keeper. Returns each side's kicks (true = scored).
 */
export function shootout(run: CupRun, home: TeamSetup, away: TeamSetup): { home: boolean[]; away: boolean[] } {
  const rng = rngFor(run, 300 + run.round);
  const takers = (t: TeamSetup) =>
    t.tactics.lineup
      .map((id) => t.squad.find((p) => p.id === id)!)
      .filter((p) => p.positions[0] !== 'GK')
      .sort((a, b) => b.attrs.finishing + b.attrs.composure - (a.attrs.finishing + a.attrs.composure));
  const keeper = (t: TeamSetup) => t.squad.find((p) => p.id === t.tactics.lineup[0])!;
  const spec = run.boons.includes('shootout');
  const kick = (taker: Player, gk: Player, mine: boolean) => {
    let p = 0.74 + (taker.attrs.finishing + taker.attrs.composure - 120) / 500 - (gk.attrs.goalkeeping - 60) / 300;
    if (spec) p += mine ? 0.08 : -0.08;
    return rng.chance(Math.max(0.45, Math.min(0.93, p)));
  };
  const hT = takers(home);
  const aT = takers(away);
  const hk = keeper(home);
  const ak = keeper(away);
  const h: boolean[] = [];
  const a: boolean[] = [];
  const goals = (k: boolean[]) => k.filter(Boolean).length;
  // Over once one side can't be caught in the first five each, or after any level round of sudden death.
  const decided = () => {
    if (h.length <= 5 && a.length <= 5) {
      const hLeft = 5 - h.length;
      const aLeft = 5 - a.length;
      if (goals(h) > goals(a) + aLeft || goals(a) > goals(h) + hLeft) return true;
      return h.length === 5 && a.length === 5 && goals(h) !== goals(a);
    }
    return h.length === a.length && goals(h) !== goals(a);
  };
  for (let i = 0; i < 40; i++) {
    h.push(kick(hT[i % hT.length], ak, true));
    if (decided()) break;
    a.push(kick(aT[i % aT.length], hk, false));
    if (decided()) break;
  }
  return { home: h, away: a };
}

/**
 * Settle the current tie from a finished match (and a shootout if it was drawn): record it,
 * update fitness, and either offer boons (won), replay with a Second Chance, or end the run.
 */
export function finishTie(club: Club, m: Match, pens?: { home: boolean[]; away: boolean[] }): TieResult {
  const run = club.cup!;
  const [gf, ga] = m.score;
  const pensScore: [number, number] | undefined = pens ? [pens.home.filter(Boolean).length, pens.away.filter(Boolean).length] : undefined;
  const won = gf > ga || (gf === ga && !!pensScore && pensScore[0] > pensScore[1]);
  run.notice = undefined;
  const result: TieResult = { gf, ga, pens: pensScore, won };

  // Fitness carries over between ties: players who played are tired, everyone recovers some.
  const recovery = run.boons.includes('physio') ? 0.6 : 0.4;
  for (const p of run.squad.squad) {
    const sp = m.players.find((q) => q.team === 0 && q.data.id === p.id);
    p.condition = Math.min(1, (sp && m.minutesPlayed(sp) > 0 ? sp.stamina : p.condition) + recovery);
  }

  if (won) {
    run.results.push(result);
    run.round++;
    if (run.round >= ROUND_NAMES.length) endRun(club, 'won');
    else run.offer = offerBoons(run);
  } else if (run.secondChance) {
    // Saved: the tie is replayed.
    run.notice = `❤️ Second Chance used: you lost ${gf}–${ga}, but get to replay the ${ROUND_NAMES[run.round]}.`;
    run.secondChance = false;
  } else {
    run.results.push(result);
    endRun(club, 'lost');
  }
  return result;
}

function offerBoons(run: CupRun): BoonId[] {
  const rng = rngFor(run, 400 + run.round);
  const pool = BOON_IDS.filter((id) => !(BOONS[id].unique && run.boons.includes(id)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

const bump = (p: Player, k: AttrKey, by: number) => (p.attrs[k] = Math.max(1, Math.min(99, p.attrs[k] + by)));

/** Take a boon after a win. Returns a line describing what changed. */
export function takeBoon(run: CupRun, id: BoonId): string {
  run.offer = null;
  run.boons.push(id);
  const squad = run.squad.squad;
  const group = (p: Player) => SLOT_GROUP[p.positions[0]];
  switch (id) {
    case 'pace':
      for (const p of squad) if (group(p) === 'FWD' || ['LM', 'RM', 'LW', 'RW'].includes(p.positions[0])) (bump(p, 'pace', 5), bump(p, 'acceleration', 5));
      return 'Your wide players and forwards are quicker.';
    case 'clinical':
      for (const p of squad) bump(p, 'finishing', 5);
      return 'The whole squad is sharper in front of goal.';
    case 'wall':
      for (const p of squad) {
        if (group(p) === 'GK') bump(p, 'goalkeeping', 8);
        if (group(p) === 'DEF') (bump(p, 'positioning', 4), bump(p, 'marking', 4));
      }
      return 'Your defence is harder to break down.';
    case 'engine':
      for (const p of squad) if (group(p) === 'MID') (bump(p, 'stamina', 5), bump(p, 'passing', 5));
      return 'Your midfield runs further and passes better.';
    case 'aerial':
      for (const p of squad) (bump(p, 'heading', 5), bump(p, 'strength', 5));
      return 'Your squad dominates in the air.';
    case 'captain':
      for (const p of squad) bump(p, 'composure', 6);
      return 'Your squad keeps its head under pressure.';
    case 'physio':
      for (const p of squad) p.condition = 1;
      return 'Everyone is back to full fitness.';
    case 'second':
      run.secondChance = true;
      return 'If you lose a tie, you get to replay it.';
    case 'shootout':
      return 'Your side is now dangerous in a shootout.';
    case 'signing': {
      const xi = run.squad.tactics.lineup.map((pid) => squad.find((p) => p.id === pid)!);
      const weakest = [...xi].sort((a, b) => overall(a) - overall(b))[0];
      const rng = rngFor(run, 500 + run.round);
      const star = makePlayerAt(rng, [weakest.positions[0]], run.base + 14, weakest.number);
      star.condition = 1;
      const slot = run.squad.tactics.lineup.indexOf(weakest.id);
      run.squad.squad[squad.indexOf(weakest)] = star;
      run.squad.tactics.lineup[slot] = star.id;
      return `${star.name} (${overall(star)}) replaces ${weakest.name} as your ${weakest.positions[0]}.`;
    }
    case 'masterclass': {
      const best = [...squad].sort((a, b) => overall(b) - overall(a))[0];
      const rng = rngFor(run, 600 + run.round);
      const pool = skillsFor(best.positions[0]).filter((s) => !best.skills.includes(s.id));
      if (!pool.length) return `${best.name} already knows every trick.`;
      const skill = rng.pick(pool).id as SkillId;
      best.skills = [...best.skills, skill];
      return `${best.name} learned ${SKILLS[skill].name}.`;
    }
  }
}

/** Pay out and close the run. Winning also brings a rare kit, ball or crest and better scouting. */
function endRun(club: Club, status: 'won' | 'lost'): void {
  const run = club.cup!;
  const meta = (club.cupMeta ??= emptyMeta());
  run.status = status;
  const reached = status === 'won' ? ROUND_NAMES.length : run.round;
  meta.best = Math.max(meta.best, reached);
  const coins = REWARDS[reached];
  club.coins += coins;
  run.payout = { coins };
  if (status === 'won') {
    meta.cupsWon++;
    meta.scouting = Math.min(MAX_SCOUTING, meta.scouting + 1);
    const rng = rngFor(run, 700);
    const prize = rollCosmetic(rng, rng.chance(0.35) ? 'elite' : 'gold');
    run.payout.cosmetic = { ...prize, duplicateCoins: collectCosmetic(club, prize.kind, prize.def.id) };
  }
  saveClub(club);
}

/** Name of how far a run (or the best run) got. */
export function reachedName(best: number): string {
  if (best < 0) return 'No runs yet';
  if (best >= ROUND_NAMES.length) return 'Cup winners';
  return best === 0 ? 'Out in Round 1' : `Reached ${roundPhrase(best)}`;
}


/** "Round 1" reads as is; the later rounds take "the" ("out in the Semi-final"). */
export function roundPhrase(i: number): string {
  return i < 2 ? ROUND_NAMES[i] : `the ${ROUND_NAMES[i]}`;
}
