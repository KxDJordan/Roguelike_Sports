import type { CrestLook, KitLook } from './cosmetics';
import { grantSkills } from './skills';
import { Rng } from '../sim/rng';
import { clamp } from '../sim/vec';
import { FORMATIONS, FORMATION_IDS } from '../tactics/formations';
import { defaultRole } from '../tactics/roles';
import { Tactics, defaultPlayerInstructions, defaultTeamInstructions } from '../tactics/instructions';
import {
  ARCHETYPE_OF,
  ARCHETYPE_WEIGHTS,
  ATTR_KEYS,
  Attributes,
  Player,
  SlotPos,
  familiarity,
  overall,
  rarityFor,
} from './player';

export interface TeamSetup {
  name: string;
  short: string;
  color: string;
  squad: Player[];
  tactics: Tactics;
  /** Shirt pattern and second colour (the user's club; AI clubs wear plain shirts in `color`). */
  kit?: KitLook;
  /** Match-ball skin id (the home side's is used). */
  ball?: string;
  /** Club crest design, coloured by the kit. */
  crest?: CrestLook;
}

const FIRST = [
  'Alex', 'Bruno', 'Carlos', 'Dani', 'Eli', 'Femi', 'Gabe', 'Hugo', 'Ivan', 'Jonas', 'Kai', 'Luca', 'Mateo', 'Nico',
  'Omar', 'Pablo', 'Quinn', 'Rafa', 'Sami', 'Theo', 'Uche', 'Viktor', 'Wes', 'Yusuf', 'Zeke', 'Arlo', 'Ben', 'Cian',
  'Diego', 'Emil', 'Felix', 'Goran', 'Hamza', 'Ilias', 'Jules', 'Kofi', 'Leon', 'Milan', 'Noah', 'Oskar', 'Remy', 'Sven',
];

const LAST = [
  'Adeyemi', 'Barros', 'Costa', 'Diallo', 'Eriksen', 'Fofana', 'Garcia', 'Hansen', 'Ibarra', 'Jansen', 'Kovac', 'Lindqvist',
  'Mendes', 'Novak', 'Okafor', 'Petrov', 'Quaresma', 'Rossi', 'Silva', 'Tanaka', 'Uribe', 'Varga', 'Walsh', 'Yilmaz',
  'Zeller', 'Almeida', 'Brandt', 'Castillo', 'Duarte', 'Ekstrom', 'Ferreira', 'Grant', 'Haaland', 'Ito', 'Keller', 'Lopes',
  'Moreau', 'Nunez', 'Oliveira', 'Park', 'Reyes', 'Santos', 'Toure', 'Vidal', 'Weber', 'Young', 'Ziegler', 'Mensah',
];

/** Random ids so players created in different sessions (e.g. from packs) never collide. */
const newId = (rng: Rng) => `p${((rng.next() * 2 ** 32) >>> 0).toString(36)}${((rng.next() * 2 ** 20) >>> 0).toString(36)}`;

/** Generate a player whose overall rating lands on (roughly) the target. */
export function makePlayerAt(rng: Rng, positions: SlotPos[], target: number, number: number): Player {
  const p = makePlayer(rng, positions, target, number);
  const f = target / Math.max(1, overall(p));
  for (const k of ATTR_KEYS) p.attrs[k] = Math.round(clamp(p.attrs[k] * f, 8, 99));
  p.rarity = rarityFor(overall(p));
  // Rescaling can change the rarity, so pick skills for the final player.
  p.skills = [];
  grantSkills(p, () => rng.next());
  return p;
}

export function makePlayer(rng: Rng, positions: SlotPos[], quality: number, number: number): Player {
  const weights = ARCHETYPE_WEIGHTS[ARCHETYPE_OF[positions[0]]];
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const w = weights[k] ?? 0.85;
    attrs[k] = Math.round(clamp(quality * w + rng.gauss() * 7, 8, 99));
  }
  const p: Player = {
    id: newId(rng),
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    number,
    positions,
    attrs,
    rarity: 'bronze',
    condition: 1,
    xp: 0,
    level: 1,
    skillPoints: 0,
    form: [],
    skills: [],
  };
  p.rarity = rarityFor(overall(p));
  grantSkills(p, () => rng.next());
  return p;
}

const SQUAD_TEMPLATE: { positions: SlotPos[]; number: number }[] = [
  { positions: ['GK'], number: 1 },
  { positions: ['RB', 'RWB'], number: 2 },
  { positions: ['LB', 'LWB'], number: 3 },
  { positions: ['CB'], number: 4 },
  { positions: ['CB'], number: 5 },
  { positions: ['DM', 'CM'], number: 6 },
  { positions: ['RW', 'RM'], number: 7 },
  { positions: ['CM', 'DM'], number: 8 },
  { positions: ['ST'], number: 9 },
  { positions: ['AM', 'CM'], number: 10 },
  { positions: ['LW', 'LM'], number: 11 },
  { positions: ['GK'], number: 13 },
  { positions: ['CB', 'RB'], number: 15 },
  { positions: ['DM'], number: 16 },
  { positions: ['CM', 'AM'], number: 18 },
  { positions: ['ST', 'LW'], number: 19 },
  { positions: ['ST', 'RW'], number: 20 },
  { positions: ['LM', 'LWB', 'RM'], number: 22 },
];

export function makeSquad(rng: Rng, quality: number): Player[] {
  return SQUAD_TEMPLATE.map((t, i) => makePlayer(rng, t.positions, quality - (i >= 11 ? 4 : 0), t.number));
}

/** Greedy best-fit lineup: fill each slot with the highest rated unused player at that position. */
export function autoLineup(squad: Player[], formationId: string): string[] {
  const used = new Set<string>();
  return FORMATIONS[formationId].slots.map((slot) => {
    let best: Player | null = null;
    let bestScore = -1;
    for (const p of squad) {
      if (used.has(p.id)) continue;
      const score = overall(p) * familiarity(p, slot.pos) * p.condition;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    used.add(best!.id);
    return best!.id;
  });
}

export function defaultTactics(squad: Player[], formationId: string): Tactics {
  const form = FORMATIONS[formationId];
  return {
    formation: formationId,
    lineup: autoLineup(squad, formationId),
    roles: form.slots.map((s) => defaultRole(s.pos)),
    instr: form.slots.map(() => defaultPlayerInstructions()),
    team: defaultTeamInstructions(),
  };
}

export function makeTeam(rng: Rng, name: string, short: string, color: string, quality: number, formationId = '4-3-3'): TeamSetup {
  const squad = makeSquad(rng, quality);
  return { name, short, color, squad, tactics: defaultTactics(squad, formationId) };
}

const AI_STYLES: { name: string; team: Partial<Tactics['team']> }[] = [
  { name: 'Gegenpress', team: { mentality: 1, pressing: 1, lineHeight: 1, tempo: 1 } },
  { name: 'Low block & counter', team: { mentality: -1, pressing: -1, lineHeight: -1, tempo: 1, directness: 1 } },
  { name: 'Possession', team: { tempo: -1, directness: -1, width: 1 } },
  { name: 'Physical', team: { tackling: 1, directness: 1, pressing: 1 } },
];

/** A computer manager's tactical setup: random shape and a coherent-ish style. */
export function randomAiTactics(rng: Rng, team: TeamSetup): string {
  const formation = rng.pick(FORMATION_IDS);
  const t = defaultTactics(team.squad, formation);
  const style = rng.pick(AI_STYLES);
  Object.assign(t.team, style.team);
  team.tactics = t;
  return style.name;
}

export const TEAM_NAMES: { name: string; short: string; color: string }[] = [
  { name: 'Northbridge FC', short: 'NOR', color: '#d64045' },
  { name: 'Harbor City', short: 'HAR', color: '#3a86ff' },
  { name: 'Ironvale United', short: 'IRV', color: '#f4a261' },
  { name: 'Redwood Rovers', short: 'RED', color: '#8338ec' },
  { name: 'Sunfield Athletic', short: 'SUN', color: '#ffbe0b' },
  { name: 'Westmoor Town', short: 'WES', color: '#06d6a0' },
  { name: 'Kingsport', short: 'KIN', color: '#ef476f' },
  { name: 'Ashford Albion', short: 'ASH', color: '#118ab2' },
  { name: 'Coldwater City', short: 'COL', color: '#4cc9f0' },
  { name: 'Brackenridge', short: 'BRK', color: '#80b918' },
  { name: 'Stonehaven FC', short: 'STO', color: '#6c757d' },
  { name: 'Marlow Wanderers', short: 'MAR', color: '#f15bb5' },
  { name: 'Eastgate Rangers', short: 'EAS', color: '#2a9d8f' },
  { name: 'Foxhollow', short: 'FOX', color: '#e76f51' },
  { name: 'Granite Bay', short: 'GRA', color: '#495057' },
  { name: 'Larkspur Town', short: 'LAR', color: '#9b5de5' },
  { name: 'Oakmere Athletic', short: 'OAK', color: '#386641' },
  { name: 'Port Selwyn', short: 'POR', color: '#00b4d8' },
  { name: 'Ravensholt', short: 'RAV', color: '#22223b' },
  { name: 'Thornbury United', short: 'THO', color: '#bc4749' },
];
