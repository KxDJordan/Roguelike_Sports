import type { Rng } from '../sim/rng';
import type { Rarity } from './player';

/**
 * Collectable looks for the user's club, found in packs: kits (shirt colours and pattern, which
 * also colour the crest and the players on the pitch), match-ball skins, and crests (the club
 * logo). Owned items live in the club's locker; one of each kind is equipped.
 */

export type CosmeticKind = 'kit' | 'ball' | 'crest';
export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'chevron' | 'pinstripes' | 'quarters';
export type CrestShape = 'shield' | 'round' | 'diamond' | 'hex' | 'heater';
export type Emblem = 'star' | 'bolt' | 'crown' | 'ball' | 'flame' | 'chevrons' | 'tower' | 'wings' | 'anchor' | 'trident';

export interface KitLook {
  primary: string;
  secondary: string;
  pattern: KitPattern;
}

export interface KitDef extends KitLook {
  id: string;
  name: string;
  rarity: Rarity;
}

export interface BallDef {
  id: string;
  name: string;
  rarity: Rarity;
  base: string;
  panel: string;
  /** Glow and trail colour for the flashier balls. */
  glow?: string;
}

export interface CrestLook {
  shape: CrestShape;
  emblem: Emblem;
}

export interface CrestDef extends CrestLook {
  id: string;
  name: string;
  rarity: Rarity;
}

export const KITS: KitDef[] = [
  { id: 'classic_red', name: 'Classic Red', rarity: 'bronze', primary: '#e63946', secondary: '#ffffff', pattern: 'solid' },
  { id: 'sky_blue', name: 'Sky Blue', rarity: 'bronze', primary: '#4cc9f0', secondary: '#0b2545', pattern: 'solid' },
  { id: 'forest', name: 'Forest', rarity: 'bronze', primary: '#2d6a4f', secondary: '#f1faee', pattern: 'solid' },
  { id: 'tangerine', name: 'Tangerine', rarity: 'bronze', primary: '#f77f00', secondary: '#1b1b1b', pattern: 'solid' },
  { id: 'royal_hoops', name: 'Royal Hoops', rarity: 'silver', primary: '#1d4ed8', secondary: '#ffffff', pattern: 'hoops' },
  { id: 'claret_halves', name: 'Claret Halves', rarity: 'silver', primary: '#7b1e3a', secondary: '#7fc8f8', pattern: 'halves' },
  { id: 'magpie', name: 'Magpie Stripes', rarity: 'silver', primary: '#111111', secondary: '#f5f5f5', pattern: 'stripes' },
  { id: 'lime_sash', name: 'Lime Sash', rarity: 'silver', primary: '#1f2937', secondary: '#a3e635', pattern: 'sash' },
  { id: 'gold_chevron', name: 'Gold Chevron', rarity: 'gold', primary: '#0b1016', secondary: '#ffd60a', pattern: 'chevron' },
  { id: 'harlequin', name: 'Harlequin', rarity: 'gold', primary: '#e11d48', secondary: '#0ea5e9', pattern: 'quarters' },
  { id: 'pinstripe_navy', name: 'Navy Pinstripe', rarity: 'gold', primary: '#0f172a', secondary: '#e2e8f0', pattern: 'pinstripes' },
  { id: 'emerald_stripes', name: 'Emerald Stripes', rarity: 'gold', primary: '#059669', secondary: '#ecfdf5', pattern: 'stripes' },
  { id: 'royal_purple', name: 'Imperial Purple', rarity: 'elite', primary: '#6d28d9', secondary: '#fcd34d', pattern: 'sash' },
  { id: 'inferno', name: 'Inferno', rarity: 'elite', primary: '#b91c1c', secondary: '#fb923c', pattern: 'chevron' },
  { id: 'midnight_gold', name: 'Midnight Gold', rarity: 'elite', primary: '#020617', secondary: '#eab308', pattern: 'pinstripes' },
];

export const BALLS: BallDef[] = [
  { id: 'classic', name: 'Classic', rarity: 'bronze', base: '#ffffff', panel: '#14181e' },
  { id: 'vintage', name: 'Vintage Leather', rarity: 'bronze', base: '#c08a4f', panel: '#6b4423' },
  { id: 'winter', name: 'Winter Orange', rarity: 'bronze', base: '#fb923c', panel: '#1f2937' },
  { id: 'cup_final', name: 'Cup Final', rarity: 'silver', base: '#f8fafc', panel: '#dc2626' },
  { id: 'ocean', name: 'Ocean', rarity: 'silver', base: '#e0f2fe', panel: '#0369a1' },
  { id: 'neon', name: 'Neon', rarity: 'gold', base: '#d9f99d', panel: '#16a34a', glow: '#a3e635' },
  { id: 'ice', name: 'Glacier', rarity: 'gold', base: '#ecfeff', panel: '#06b6d4', glow: '#67e8f9' },
  { id: 'golden', name: 'Golden Ball', rarity: 'elite', base: '#fde68a', panel: '#b45309', glow: '#fbbf24' },
  { id: 'galaxy', name: 'Galaxy', rarity: 'elite', base: '#312e81', panel: '#f0abfc', glow: '#c084fc' },
  { id: 'flame', name: 'Fireball', rarity: 'elite', base: '#fef3c7', panel: '#ea580c', glow: '#f97316' },
];

export const CRESTS: CrestDef[] = [
  { id: 'shield_star', name: 'Star Shield', rarity: 'bronze', shape: 'shield', emblem: 'star' },
  { id: 'round_ball', name: 'Roundel', rarity: 'bronze', shape: 'round', emblem: 'ball' },
  { id: 'heater_tower', name: 'Old Tower', rarity: 'bronze', shape: 'heater', emblem: 'tower' },
  { id: 'hex_bolt', name: 'Thunderbolt', rarity: 'silver', shape: 'hex', emblem: 'bolt' },
  { id: 'shield_anchor', name: 'Harbour', rarity: 'silver', shape: 'shield', emblem: 'anchor' },
  { id: 'diamond_chevrons', name: 'Chevrons', rarity: 'silver', shape: 'diamond', emblem: 'chevrons' },
  { id: 'round_flame', name: 'Eternal Flame', rarity: 'gold', shape: 'round', emblem: 'flame' },
  { id: 'heater_trident', name: 'Trident', rarity: 'gold', shape: 'heater', emblem: 'trident' },
  { id: 'shield_crown', name: 'Royal Crown', rarity: 'elite', shape: 'shield', emblem: 'crown' },
  { id: 'hex_wings', name: 'Winged', rarity: 'elite', shape: 'hex', emblem: 'wings' },
];

export const COSMETICS = { kit: KITS, ball: BALLS, crest: CRESTS } as const;
export type CosmeticDef = KitDef | BallDef | CrestDef;

export const KIND_NAME: Record<CosmeticKind, string> = { kit: 'Kit', ball: 'Ball', crest: 'Crest' };

export function cosmetic(kind: CosmeticKind, id: string): CosmeticDef | undefined {
  return (COSMETICS[kind] as readonly CosmeticDef[]).find((c) => c.id === id);
}

export const kitById = (id: string): KitDef => KITS.find((k) => k.id === id) ?? KITS[0];
export const ballById = (id: string): BallDef => BALLS.find((b) => b.id === id) ?? BALLS[0];
export const crestById = (id: string): CrestDef => CRESTS.find((c) => c.id === id) ?? CRESTS[0];

/** What a new club owns. */
export const STARTER = { kit: 'classic_red', ball: 'classic', crest: 'shield_star' } as const;

/** Coins for a duplicate, by rarity. */
export const DUPLICATE_COINS: Record<Rarity, number> = { bronze: 150, silver: 400, gold: 1000, elite: 2500 };

/** A random kit, ball or crest of the given rarity (falls back to a lower rarity if none exist). */
export function rollCosmetic(rng: Rng, rarity: Rarity): { kind: CosmeticKind; def: CosmeticDef } {
  const r = rng.next();
  const kind: CosmeticKind = r < 0.45 ? 'kit' : r < 0.72 ? 'ball' : 'crest';
  const order: Rarity[] = ['elite', 'gold', 'silver', 'bronze'];
  for (const rar of order.slice(order.indexOf(rarity))) {
    const pool = (COSMETICS[kind] as readonly CosmeticDef[]).filter((c) => c.rarity === rar);
    if (pool.length) return { kind, def: rng.pick(pool) };
  }
  return { kind: 'kit', def: KITS[0] };
}
