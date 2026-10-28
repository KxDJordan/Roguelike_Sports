import { Rng } from '../sim/rng';
import type { Match } from '../sim/match';
import { TeamSetup, makeTeam } from '../data/generator';
import { ARCHETYPE_OF, ARCHETYPE_WEIGHTS, ATTR_KEYS, AttrKey, Player, familiarity, marketValue, normalizePlayer, overall, rarityFor, xpToNext } from '../data/player';
import { grantSkills, migrateSkills, seededRand } from '../data/skills';
import { FORMATIONS } from '../tactics/formations';
import { playerRating } from './ratings';
import type { Career } from './career';
import type { CupMeta, CupRun } from './cup';
import { CosmeticKind, DUPLICATE_COINS, STARTER, ballById, cosmetic, crestById, kitById } from '../data/cosmetics';
import type { Rarity } from '../data/player';

const SAVE_KEY = 'rs.club.v2';
const LEGACY_KEY = 'rs.club.v1';

export const MAX_SQUAD = 26;
export const MIN_SQUAD = 16;

export type Result = 'W' | 'D' | 'L';

export interface Club {
  version: 2;
  team: TeamSetup;
  coins: number;
  matchesPlayed: number;
  record: { w: number; d: number; l: number; gf: number; ga: number };
  /** Most recent last. */
  results: Result[];
  /** Kits, balls and crests the club owns (ids). */
  locker?: Record<CosmeticKind, string[]>;
  /** What it's wearing. */
  look?: Record<CosmeticKind, string>;
  /** The cup run in progress (or just finished), and lifetime cup records. */
  cup?: CupRun;
  cupMeta?: CupMeta;
  /** League career, once started. */
  career?: Career;
}

export interface RatedPlayer {
  player: Player;
  rating: number;
  minutes: number;
  goals: number;
  assists: number;
}

export interface MatchReport {
  result: Result;
  score: [number, number];
  opponent: string;
  coins: { result: number; goals: number; total: number };
  ratings: RatedPlayer[];
  motm: RatedPlayer | null;
  levelUps: LevelUp[];
}

export interface LevelUp {
  player: Player;
  level: number;
  /** Attributes raised automatically, one entry per point. */
  gains: AttrKey[];
  /** A skill unlocked by stepping up a rarity. */
  skill?: string;
}

/** Attribute points a player gains automatically on each level-up. */
export const LEVEL_UP_POINTS = 2;

export function newClub(): Club {
  const rng = new Rng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  const club: Club = {
    version: 2,
    team: makeTeam(rng, 'Your Club', 'YOU', '#e63946', 62),
    coins: 1500,
    matchesPlayed: 0,
    record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
    results: [],
  };
  ensureLocker(club);
  saveClub(club);
  return club;
}

/** Bring a saved player up to date: new fields, and skills for players saved before skills existed. */
function upgradePlayer(p: Player): void {
  normalizePlayer(p);
  // Fitness now recovers fully between matches; older saves may hold tired players.
  p.condition = 1;
  migrateSkills(p);
  grantSkills(p, seededRand(p.id));
}

export function loadClub(): Club | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Club;
      c.team.squad.forEach(upgradePlayer);
      ensureLocker(c);
      return c;
    }
    // Carry an old single-team save forward.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const team = JSON.parse(legacy) as TeamSetup;
      team.squad.forEach(upgradePlayer);
      const club: Club = { version: 2, team, coins: 1500, matchesPlayed: 0, record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 }, results: [] };
      ensureLocker(club);
      saveClub(club);
      return club;
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return null;
}

export function saveClub(club: Club): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(club));
  } catch {
    // Storage unavailable (private mode etc.): progress just won't persist.
  }
}

export function squadRating(team: TeamSetup): number {
  const xi = team.tactics.lineup.map((id) => team.squad.find((p) => p.id === id)!);
  return Math.round(xi.reduce((s, p) => s + overall(p), 0) / xi.length);
}

/**
 * Fold a finished match into the club: rewards, ratings and form, XP and level-ups
 * (which train key attributes automatically). Everyone is back to full fitness for the next match.
 */
export function applyMatch(club: Club, m: Match): MatchReport {
  const [gf, ga] = m.score;
  const result: Result = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  club.matchesPlayed++;
  club.record[result === 'W' ? 'w' : result === 'D' ? 'd' : 'l']++;
  club.record.gf += gf;
  club.record.ga += ga;
  club.results = [...club.results, result].slice(-10);

  const coins = { result: result === 'W' ? 400 : result === 'D' ? 200 : 100, goals: gf * 60, total: 0 };
  coins.total = coins.result + coins.goals;
  club.coins += coins.total;

  const ratings: RatedPlayer[] = [];
  const levelUps: MatchReport['levelUps'] = [];
  for (const sp of m.players) {
    if (sp.team !== 0) continue;
    const p = club.team.squad.find((q) => q.id === sp.data.id);
    if (!p) continue;
    const minutes = m.minutesPlayed(sp);
    const rating = playerRating(m, sp);
    ratings.push({ player: p, rating, minutes, goals: sp.ps.goals, assists: sp.ps.assists });
    p.form = [...p.form, rating].slice(-5);
    p.xp += Math.round(minutes * 0.8 + Math.max(0, rating - 6) * 25 + sp.ps.goals * 15);
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      levelUps.push(levelUp(p));
    }
  }
  for (const p of club.team.squad) p.condition = 1;

  ratings.sort((a, b) => b.rating - a.rating);
  saveClub(club);
  return { result, score: [gf, ga], opponent: m.teams[1].name, coins, ratings, motm: ratings[0] ?? null, levelUps };
}

/**
 * Level-up training: raise key attributes for the player's position, favouring the
 * heavier-weighted and the weaker ones so the profile fills out evenly.
 */
export function levelUp(p: Player, rand: () => number = Math.random): LevelUp {
  const weights = ARCHETYPE_WEIGHTS[ARCHETYPE_OF[p.positions[0]]];
  const gains: AttrKey[] = [];
  const had = p.skills.length;
  for (let i = 0; i < LEVEL_UP_POINTS; i++) {
    const pool = ATTR_KEYS.filter((k) => (weights[k] ?? 0) >= 1 && p.attrs[k] < 99);
    if (!pool.length) break;
    const score = pool.map((k) => weights[k]! * (100 - p.attrs[k]));
    let r = rand() * score.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1];
    for (let j = 0; j < pool.length; j++) {
      r -= score[j];
      if (r < 0) {
        pick = pool[j];
        break;
      }
    }
    p.attrs[pick]++;
    gains.push(pick);
  }
  p.rarity = rarityFor(overall(p));
  // Stepping up a rarity unlocks another skill.
  grantSkills(p, rand);
  return { player: p, level: p.level, gains, skill: p.skills.length > had ? p.skills[p.skills.length - 1] : undefined };
}

/** Spend a skill point to raise one attribute. */
export function trainAttribute(club: Club, p: Player, k: AttrKey): boolean {
  if (p.skillPoints <= 0 || p.attrs[k] >= 99) return false;
  p.skillPoints--;
  p.attrs[k]++;
  p.rarity = rarityFor(overall(p));
  // Stepping up a rarity unlocks another skill.
  grantSkills(p, Math.random);
  saveClub(club);
  return true;
}

export const skillPointCost = (p: Player) => 150 + p.level * 75;

/** Buy an extra skill point with coins (private coaching). */
export function buySkillPoint(club: Club, p: Player): boolean {
  const cost = skillPointCost(p);
  if (club.coins < cost) return false;
  club.coins -= cost;
  p.skillPoints++;
  saveClub(club);
  return true;
}

export function canAdd(club: Club): boolean {
  return club.team.squad.length < MAX_SQUAD;
}

export function addPlayer(club: Club, p: Player): boolean {
  if (!canAdd(club)) return false;
  club.team.squad.push(p);
  saveClub(club);
  return true;
}

/** Sell a player for their market value; if they were in the XI, the best bench option fills in. */
export function sellPlayer(club: Club, p: Player): boolean {
  const team = club.team;
  if (team.squad.length <= MIN_SQUAD) return false;
  const slot = team.tactics.lineup.indexOf(p.id);
  team.squad = team.squad.filter((q) => q.id !== p.id);
  if (slot >= 0) {
    const pos = FORMATIONS[team.tactics.formation].slots[slot].pos;
    const bench = team.squad.filter((q) => !team.tactics.lineup.includes(q.id));
    bench.sort((a, b) => overall(b) * familiarity(b, pos) - overall(a) * familiarity(a, pos));
    team.tactics.lineup[slot] = bench[0].id;
  }
  club.coins += marketValue(p);
  saveClub(club);
  return true;
}

// ---------------------------------------------------------------- identity and cosmetics

/** Give clubs (including ones saved before cosmetics existed) the starter look, and apply it. */
export function ensureLocker(club: Club): void {
  club.locker ??= { kit: [STARTER.kit], ball: [STARTER.ball], crest: [STARTER.crest] };
  club.look ??= { ...STARTER };
  for (const k of ['kit', 'ball', 'crest'] as CosmeticKind[]) if (!club.locker[k].includes(club.look[k])) club.locker[k].push(club.look[k]);
  applyLook(club);
}

/** Dress the team in the equipped kit, ball and crest. */
export function applyLook(club: Club): void {
  const look = club.look!;
  const kit = kitById(look.kit);
  const crest = crestById(look.crest);
  club.team.color = kit.primary;
  club.team.kit = { primary: kit.primary, secondary: kit.secondary, pattern: kit.pattern };
  club.team.ball = ballById(look.ball).id;
  club.team.crest = { shape: crest.shape, emblem: crest.emblem };
  const you = club.career?.teams.find((t) => t.id === 'you');
  if (you) you.color = kit.primary;
}

export function equip(club: Club, kind: CosmeticKind, id: string): boolean {
  if (!club.locker?.[kind].includes(id)) return false;
  club.look![kind] = id;
  applyLook(club);
  saveClub(club);
  return true;
}

/**
 * Add a kit, ball or crest found in a pack. A duplicate is turned into coins instead.
 * Returns the coins paid for a duplicate (0 when it was new).
 */
export function collectCosmetic(club: Club, kind: CosmeticKind, id: string): number {
  ensureLocker(club);
  if (club.locker![kind].includes(id)) {
    const coins = DUPLICATE_COINS[(cosmetic(kind, id)?.rarity ?? 'bronze') as Rarity];
    club.coins += coins;
    saveClub(club);
    return coins;
  }
  club.locker![kind].push(id);
  saveClub(club);
  return 0;
}

export const NAME_MAX = 22;

/** Rename the club. The short code is the 3 letters shown on scoreboards and tables. */
export function renameClub(club: Club, name: string, short: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  const s = short.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n.length < 2 || n.length > NAME_MAX) return `Name must be 2-${NAME_MAX} characters.`;
  if (s.length !== 3) return 'Short code must be 3 letters or numbers.';
  club.team.name = n;
  club.team.short = s;
  // The league table shows your club too.
  const you = club.career?.teams.find((t) => t.id === 'you');
  if (you) {
    you.name = n;
    you.short = s;
  }
  saveClub(club);
  return null;
}
