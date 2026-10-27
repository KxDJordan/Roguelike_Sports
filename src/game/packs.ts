import { Rng } from '../sim/rng';
import { Player, Rarity, SlotPos } from '../data/player';
import { makePlayerAt } from '../data/generator';
import { CosmeticDef, CosmeticKind, rollCosmetic } from '../data/cosmetics';

export interface PackDef {
  id: string;
  name: string;
  cost: number;
  count: number;
  odds: Record<Rarity, number>;
  blurb: string;
  /** Chance of a bonus kit, ball or crest card. */
  cosmetic: number;
}

export const PACKS: PackDef[] = [
  { id: 'bronze', name: 'Bronze Pack', cost: 600, count: 3, odds: { bronze: 0.74, silver: 0.23, gold: 0.03, elite: 0 }, blurb: '3 players. Mostly squad fillers, the odd gem. 35% chance of a kit, ball or crest.', cosmetic: 0.35 },
  { id: 'silver', name: 'Silver Pack', cost: 1800, count: 3, odds: { bronze: 0.15, silver: 0.62, gold: 0.21, elite: 0.02 }, blurb: '3 players. Solid first-team options. 60% chance of a kit, ball or crest.', cosmetic: 0.6 },
  { id: 'gold', name: 'Gold Pack', cost: 5000, count: 3, odds: { bronze: 0, silver: 0.3, gold: 0.58, elite: 0.12 }, blurb: '3 players. Real quality, a chance at an elite star. Always a kit, ball or crest.', cosmetic: 1 },
];

const RATING_RANGE: Record<Rarity, [number, number]> = {
  bronze: [46, 59],
  silver: [60, 69],
  gold: [70, 79],
  elite: [80, 89],
};

const POSITION_POOL: { positions: SlotPos[]; weight: number }[] = [
  { positions: ['GK'], weight: 1 },
  { positions: ['CB'], weight: 2 },
  { positions: ['LB', 'LWB'], weight: 1 },
  { positions: ['RB', 'RWB'], weight: 1 },
  { positions: ['DM', 'CM'], weight: 1.2 },
  { positions: ['CM'], weight: 1.2 },
  { positions: ['AM', 'CM'], weight: 1 },
  { positions: ['LW', 'LM'], weight: 1 },
  { positions: ['RW', 'RM'], weight: 1 },
  { positions: ['ST'], weight: 1.6 },
];

function rollRarity(rng: Rng, odds: Record<Rarity, number>): Rarity {
  let r = rng.next();
  for (const k of ['elite', 'gold', 'silver', 'bronze'] as Rarity[]) {
    if (r < odds[k]) return k;
    r -= odds[k];
  }
  return 'bronze';
}

function rollPositions(rng: Rng): SlotPos[] {
  const total = POSITION_POOL.reduce((s, p) => s + p.weight, 0);
  let r = rng.next() * total;
  for (const p of POSITION_POOL) {
    if (r < p.weight) return p.positions;
    r -= p.weight;
  }
  return ['CM'];
}

/** Open a pack: players are sorted so the best is revealed last. */
export function openPack(rng: Rng, pack: PackDef, takenNumbers: Set<number>): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < pack.count; i++) {
    const rarity = rollRarity(rng, pack.odds);
    const [lo, hi] = RATING_RANGE[rarity];
    let number = rng.int(2, 40);
    while (takenNumbers.has(number)) number = (number % 99) + 1;
    takenNumbers.add(number);
    out.push(makePlayerAt(rng, rollPositions(rng), rng.int(lo, hi), number));
  }
  return out.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
}

export const rarityRank = (r: Rarity) => ['bronze', 'silver', 'gold', 'elite'].indexOf(r);

/** The bonus kit, ball or crest card a pack may hold (rarity rolled on the pack's odds). */
export function openCosmetic(rng: Rng, pack: PackDef): { kind: CosmeticKind; def: CosmeticDef } | null {
  if (!rng.chance(pack.cosmetic)) return null;
  return rollCosmetic(rng, rollRarity(rng, pack.odds));
}
