import type { SkillId } from './skills';

export type SlotPos =
  | 'GK'
  | 'LB'
  | 'CB'
  | 'RB'
  | 'LWB'
  | 'RWB'
  | 'DM'
  | 'CM'
  | 'LM'
  | 'RM'
  | 'AM'
  | 'LW'
  | 'RW'
  | 'ST';

export type PosGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

export const SLOT_GROUP: Record<SlotPos, PosGroup> = {
  GK: 'GK',
  LB: 'DEF',
  CB: 'DEF',
  RB: 'DEF',
  LWB: 'DEF',
  RWB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  LM: 'MID',
  RM: 'MID',
  AM: 'MID',
  LW: 'FWD',
  RW: 'FWD',
  ST: 'FWD',
};

export const ATTR_KEYS = [
  'pace',
  'acceleration',
  'stamina',
  'strength',
  'passing',
  'vision',
  'dribbling',
  'finishing',
  'crossing',
  'tackling',
  'marking',
  'positioning',
  'heading',
  'composure',
  'aggression',
  'goalkeeping',
] as const;

export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;
export type Rarity = 'bronze' | 'silver' | 'gold' | 'elite';

export interface Player {
  id: string;
  name: string;
  number: number;
  /** Natural positions, best first. */
  positions: SlotPos[];
  attrs: Attributes;
  rarity: Rarity;
  /** Fitness entering a match, 0..1. */
  condition: number;
  /** Progression: XP toward the next level; each level grants skill points to train attributes. */
  xp: number;
  level: number;
  skillPoints: number;
  /** Special abilities that can fire during matches; the count depends on rarity. */
  skills: SkillId[];
  /** Last five match ratings, most recent last. */
  form: number[];
}

/** Fill in fields added after a save was written. */
export function normalizePlayer(p: Player): Player {
  p.xp ??= 0;
  p.level ??= 1;
  p.skillPoints ??= 0;
  p.form ??= [];
  p.skills ??= [];
  p.condition ??= 1;
  return p;
}

export const xpToNext = (level: number) => 100 + level * 60;

export function avgForm(p: Player): number | null {
  return p.form.length ? p.form.reduce((a, b) => a + b, 0) / p.form.length : null;
}

/** Small boost or dip from recent form, applied to technical attributes in matches. */
export function formMultiplier(p: Player): number {
  const f = avgForm(p);
  return f === null ? 1 : 1 + Math.max(-0.04, Math.min(0.04, (f - 6.5) * 0.025));
}

/** Transfer value in coins: rises steeply with quality. */
export function marketValue(p: Player): number {
  return Math.round((25 * Math.exp((overall(p) - 40) / 9.5)) / 10) * 10;
}

export type FaceKey = 'PAC' | 'SHO' | 'PAS' | 'DRI' | 'DEF' | 'PHY' | 'DIV' | 'HAN' | 'REF' | 'POS';

/** The six headline numbers shown on a player card. */
export function faceStats(p: Player): [FaceKey, number][] {
  const a = p.attrs;
  const avg = (...xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  if (p.positions[0] === 'GK') {
    return [
      ['DIV', avg(a.goalkeeping, a.acceleration)],
      ['HAN', avg(a.goalkeeping, a.composure)],
      ['REF', avg(a.goalkeeping, a.positioning, a.acceleration)],
      ['PAS', avg(a.passing, a.vision)],
      ['POS', a.positioning],
      ['PHY', avg(a.strength, a.stamina)],
    ];
  }
  return [
    ['PAC', avg(a.pace, a.acceleration)],
    ['SHO', avg(a.finishing, a.composure, a.finishing)],
    ['PAS', avg(a.passing, a.vision, a.crossing)],
    ['DRI', avg(a.dribbling, a.dribbling, a.composure)],
    ['DEF', avg(a.tackling, a.marking, a.positioning)],
    ['PHY', avg(a.strength, a.stamina, a.aggression, a.heading)],
  ];
}

export type Archetype = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';

export const ARCHETYPE_OF: Record<SlotPos, Archetype> = {
  GK: 'GK',
  CB: 'CB',
  LB: 'FB',
  RB: 'FB',
  LWB: 'FB',
  RWB: 'FB',
  DM: 'DM',
  CM: 'CM',
  AM: 'AM',
  LM: 'W',
  RM: 'W',
  LW: 'W',
  RW: 'W',
  ST: 'ST',
};

/** Attribute emphasis per archetype; values >= 1 are the key attributes used for the overall rating. */
export const ARCHETYPE_WEIGHTS: Record<Archetype, Partial<Record<AttrKey, number>>> = {
  GK: { goalkeeping: 1.15, positioning: 1.05, composure: 1.0, passing: 0.7, vision: 0.6, pace: 0.6, heading: 0.5, dribbling: 0.3, finishing: 0.2, tackling: 0.3, crossing: 0.3, marking: 0.3 },
  CB: { tackling: 1.12, marking: 1.12, heading: 1.1, strength: 1.1, positioning: 1.08, vision: 0.7, dribbling: 0.6, crossing: 0.5, finishing: 0.45, goalkeeping: 0.1 },
  FB: { pace: 1.08, stamina: 1.08, crossing: 1.0, tackling: 1.0, marking: 0.98, heading: 0.8, finishing: 0.5, goalkeeping: 0.1 },
  DM: { tackling: 1.08, positioning: 1.08, stamina: 1.05, passing: 1.03, marking: 1.0, finishing: 0.6, goalkeeping: 0.1 },
  CM: { passing: 1.08, stamina: 1.08, vision: 1.05, dribbling: 0.95, tackling: 0.9, finishing: 0.75, goalkeeping: 0.1 },
  AM: { vision: 1.12, dribbling: 1.1, passing: 1.08, finishing: 0.95, heading: 0.65, tackling: 0.55, marking: 0.5, goalkeeping: 0.1 },
  W: { pace: 1.12, acceleration: 1.1, dribbling: 1.1, crossing: 1.08, finishing: 0.9, heading: 0.6, tackling: 0.5, marking: 0.5, goalkeeping: 0.1 },
  ST: { finishing: 1.15, composure: 1.05, positioning: 1.05, heading: 1.03, pace: 1.02, crossing: 0.7, tackling: 0.4, marking: 0.4, goalkeeping: 0.1 },
};

export function ratingAt(p: Player, pos: SlotPos): number {
  const w = ARCHETYPE_WEIGHTS[ARCHETYPE_OF[pos]];
  let sum = 0;
  let n = 0;
  for (const k of ATTR_KEYS) {
    if ((w[k] ?? 0) >= 1) {
      sum += p.attrs[k];
      n++;
    }
  }
  return Math.round((sum / n) * familiarity(p, pos));
}

export function overall(p: Player): number {
  return ratingAt(p, p.positions[0]);
}

/** Multiplier on technical attributes when a player plays out of position. */
export function familiarity(p: Player, pos: SlotPos): number {
  if (p.positions.includes(pos)) return 1;
  const isGk = pos === 'GK';
  const wasGk = p.positions[0] === 'GK';
  if (isGk !== wasGk) return 0.4;
  if (p.positions.some((q) => SLOT_GROUP[q] === SLOT_GROUP[pos])) return 0.9;
  return 0.78;
}

export function rarityFor(ovr: number): Rarity {
  if (ovr >= 80) return 'elite';
  if (ovr >= 70) return 'gold';
  if (ovr >= 60) return 'silver';
  return 'bronze';
}
