import { Rng } from '../sim/rng';
import { Match } from '../sim/match';
import { TEAM_NAMES, TeamSetup, makeTeam, randomAiTactics } from '../data/generator';
import { cloneTactics } from '../tactics/instructions';
import type { Club, Result } from './club';

/**
 * Career mode: a ladder of four leagues named after the card rarities. Each season is a double
 * round-robin of 8 clubs (14 matchdays); the top two go up, the bottom two go down, and prize
 * money is paid by finishing position. The user's matches are played (or quick-simmed) through
 * the normal match flow; the other fixtures each matchday are simulated headless.
 */

export interface Division {
  name: string;
  /** Overall rating range of the AI clubs in it. */
  rating: [number, number];
  /** Prize for winning it; lower places get a share. */
  prize: number;
}

export const DIVISIONS: Division[] = [
  { name: 'Bronze League', rating: [54, 61], prize: 2000 },
  { name: 'Silver League', rating: [60, 67], prize: 4000 },
  { name: 'Gold League', rating: [67, 74], prize: 8000 },
  { name: 'Elite League', rating: [74, 82], prize: 16000 },
];

export const LEAGUE_SIZE = 8;
export const PROMOTED = 2;
export const RELEGATED = 2;
/** Share of the division prize by finishing position. */
const PRIZE_SHARE = [1, 0.7, 0.5, 0.4, 0.32, 0.25, 0.2, 0.15];

/** The user's club in fixtures and the table. */
export const YOU = 'you';

export interface CareerTeam {
  id: string;
  name: string;
  short: string;
  color: string;
  /** Overall rating (AI clubs). */
  rating: number;
  /** Playing style shown to the user (AI clubs). */
  style?: string;
  /** Squad and tactics for AI clubs; the user's club plays with club.team. */
  setup?: TeamSetup;
}

export interface Fixture {
  round: number;
  home: string;
  away: string;
  /** [home goals, away goals] once played. */
  score?: [number, number];
}

export type Outcome = 'champions' | 'promoted' | 'stayed' | 'relegated';

export interface SeasonRecord {
  season: number;
  tier: number;
  position: number;
  outcome: Outcome;
  prize: number;
}

export interface Career {
  season: number;
  tier: number;
  teams: CareerTeam[];
  fixtures: Fixture[];
  /** Index of the next matchday to be played (0-based); equals rounds() when the season is over. */
  round: number;
  history: SeasonRecord[];
}

export interface TableRow {
  team: CareerTeam;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  /** Last five results, most recent last. */
  form: Result[];
}

export const rounds = (_c?: Career) => (LEAGUE_SIZE - 1) * 2;
export const seasonOver = (c: Career) => c.round >= rounds(c);
export const teamById = (c: Career, id: string) => c.teams.find((t) => t.id === id)!;

/** Start a season in division `tier`: fresh AI clubs spread across the division's rating range. */
export function startSeason(club: Club, tier: number, season: number, history: SeasonRecord[], seed = Date.now()): Career {
  const rng = new Rng((seed ^ (season * 7919) ^ (tier * 104729)) >>> 0);
  const div = DIVISIONS[tier];
  const names = TEAM_NAMES.filter((n) => n.short !== club.team.short && n.name !== club.team.name);
  for (let i = names.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [names[i], names[j]] = [names[j], names[i]];
  }
  const teams: CareerTeam[] = [{ id: YOU, name: club.team.name, short: club.team.short, color: club.team.color, rating: 0 }];
  for (let i = 0; i < LEAGUE_SIZE - 1; i++) {
    const n = names[i];
    // Evenly spread from the bottom of the range to the top, with a little noise.
    const rating = Math.round(div.rating[0] + ((div.rating[1] - div.rating[0]) * i) / (LEAGUE_SIZE - 2) + rng.range(-1, 1));
    const setup = makeTeam(rng, n.name, n.short, n.color, rating);
    const style = randomAiTactics(rng, setup);
    teams.push({ id: `t${i}`, name: n.name, short: n.short, color: n.color, rating, style, setup });
  }
  return { season, tier, teams, fixtures: makeFixtures(teams.map((t) => t.id), rng), round: 0, history };
}

/**
 * Double round-robin by the circle method: every club plays every other once at home and once
 * away, one match per matchday. The second half mirrors the first with venues swapped.
 */
export function makeFixtures(ids: string[], rng: Rng): Fixture[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const n = order.length;
  const first: Fixture[] = [];
  const rot = order.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const ring = [order[0], ...rot];
    for (let k = 0; k < n / 2; k++) {
      const a = ring[k];
      const b = ring[n - 1 - k];
      // Alternate venues so nobody gets a long run of home or away games.
      const swap = (r + k) % 2 === 1;
      first.push({ round: r, home: swap ? b : a, away: swap ? a : b });
    }
    rot.unshift(rot.pop()!);
  }
  const second = first.map((f) => ({ round: f.round + n - 1, home: f.away, away: f.home }));
  return [...first, ...second];
}

/** The user's fixture on the current matchday. */
export function userFixture(c: Career): Fixture | null {
  return c.fixtures.find((f) => f.round === c.round && (f.home === YOU || f.away === YOU)) ?? null;
}

/** The AI club the user plays next, with home/away. */
export function nextOpponent(c: Career): { team: CareerTeam; home: boolean; fixture: Fixture } | null {
  const f = userFixture(c);
  if (!f) return null;
  const home = f.home === YOU;
  return { team: teamById(c, home ? f.away : f.home), home, fixture: f };
}

/** League table, sorted by points, goal difference, goals scored, then name. */
export function standings(c: Career): TableRow[] {
  const rows = new Map<string, TableRow>(c.teams.map((t) => [t.id, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] }]));
  const played = c.fixtures.filter((f) => f.score).sort((a, b) => a.round - b.round);
  for (const f of played) {
    const [hg, ag] = f.score!;
    const add = (id: string, gf: number, ga: number) => {
      const r = rows.get(id)!;
      r.p++;
      r.gf += gf;
      r.ga += ga;
      const res: Result = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      if (res === 'W') r.w++;
      else if (res === 'D') r.d++;
      else r.l++;
      r.pts += res === 'W' ? 3 : res === 'D' ? 1 : 0;
      r.form = [...r.form, res].slice(-5);
    };
    add(f.home, hg, ag);
    add(f.away, ag, hg);
  }
  for (const r of rows.values()) r.gd = r.gf - r.ga;
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.name.localeCompare(b.team.name));
}

/** Record the user's result on the current matchday (goals for and against, from the user's side). */
export function recordUserResult(c: Career, gf: number, ga: number): void {
  const f = userFixture(c);
  if (!f) return;
  f.score = f.home === YOU ? [gf, ga] : [ga, gf];
}

/** A copy of an AI club the match engine can mutate (tactics change at half-time). */
export function matchSide(t: CareerTeam): TeamSetup {
  const s = t.setup!;
  return { ...s, tactics: cloneTactics(s.tactics) };
}

/**
 * Play the current matchday's other fixtures headless, then move on to the next matchday.
 * Yields between matches so the page stays responsive; `progress` reports each result.
 */
export async function simulateRound(c: Career, progress?: (done: number, total: number, f: Fixture) => void): Promise<void> {
  const todo = c.fixtures.filter((f) => f.round === c.round && !f.score && f.home !== YOU && f.away !== YOU);
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    await new Promise((r) => setTimeout(r, 0));
    const m = new Match(matchSide(teamById(c, f.home)), matchSide(teamById(c, f.away)), (c.season * 1000 + c.round * 10 + i + 1) * 2654435761 >>> 0);
    m.aiTeams = [0, 1];
    m.simulateFull();
    f.score = [m.score[0], m.score[1]];
    progress?.(i + 1, todo.length, f);
  }
  c.round++;
}

/** Where the user finished and what it means. */
export function seasonOutcome(c: Career): { position: number; outcome: Outcome; prize: number } {
  const position = standings(c).findIndex((r) => r.team.id === YOU) + 1;
  const top = c.tier === DIVISIONS.length - 1;
  const outcome: Outcome =
    position === 1 && top ? 'champions' : position <= PROMOTED && !top ? 'promoted' : position > LEAGUE_SIZE - RELEGATED && c.tier > 0 ? 'relegated' : position === 1 ? 'champions' : 'stayed';
  const prize = Math.round((DIVISIONS[c.tier].prize * PRIZE_SHARE[position - 1]) / 10) * 10;
  return { position, outcome, prize };
}

/** Pay the prize, file the season in the history and start the next one in the right division. */
export function finishSeason(club: Club, seed = Date.now()): SeasonRecord {
  const c = club.career!;
  const { position, outcome, prize } = seasonOutcome(c);
  club.coins += prize;
  const record: SeasonRecord = { season: c.season, tier: c.tier, position, outcome, prize };
  const tier = c.tier + (outcome === 'promoted' ? 1 : outcome === 'relegated' ? -1 : 0);
  club.career = startSeason(club, tier, c.season + 1, [...c.history, record], seed);
  return record;
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
