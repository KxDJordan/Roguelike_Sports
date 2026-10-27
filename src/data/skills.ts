import type { AttrKey, Player, PosGroup, Rarity, SlotPos } from './player';
import { SLOT_GROUP } from './player';

export type SkillId =
  | 'power_shot'
  | 'finesse_shot'
  | 'rainbow_flick'
  | 'aerial_threat'
  | 'speed_burst'
  | 'first_touch'
  | 'precision_pass'
  | 'curve_pass'
  | 'long_ball'
  | 'volley'
  | 'cut_inside'
  | 'hold_up'
  | 'close_control'
  | 'clean_tackle'
  | 'awareness'
  | 'crosser'
  | 'tireless'
  | 'ball_winner'
  | 'aerial_guardian'
  | 'last_ditch'
  | 'interceptor'
  | 'sliding_tackle'
  | 'cat_reflexes'
  | 'penalty_stopper'
  | 'safe_hands';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  /** What it does, for cards and the squad screen. */
  desc: string;
  /** Position groups that can learn it. */
  groups: PosGroup[];
  /** Further restricted to these positions (e.g. crossing is for wide players). */
  slots?: SlotPos[];
  /** Chance it fires when its moment comes. */
  chance: number;
  /** Attributes that make a player more likely to have it. */
  affinity: AttrKey[];
}

const WIDE: SlotPos[] = ['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW'];

const LIST: SkillDef[] = [
  { id: 'power_shot', name: 'Power Shot', icon: '💥', desc: 'Sometimes leathers a shot from outside the box: far harder for the keeper to stop.', groups: ['FWD', 'MID'], chance: 0.35, affinity: ['finishing', 'strength'] },
  { id: 'finesse_shot', name: 'Finesse Shot', icon: '🎯', desc: 'Sometimes curls a shot inside the box into the corner.', groups: ['FWD'], chance: 0.3, affinity: ['finishing', 'composure'] },
  { id: 'rainbow_flick', name: 'Rainbow Flick', icon: '🌈', desc: 'Sometimes flicks the ball over a defender who goes to tackle him and skips past.', groups: ['FWD', 'MID'], chance: 0.15, affinity: ['dribbling', 'composure'] },
  { id: 'aerial_threat', name: 'Aerial Threat', icon: '🦒', desc: 'Sometimes towers over his marker to win a header in attack.', groups: ['FWD'], slots: ['ST'], chance: 0.4, affinity: ['heading', 'strength'] },
  { id: 'speed_burst', name: 'Speed Burst', icon: '⚡', desc: 'Sometimes explodes into a sprint when making a run or carrying the ball into space.', groups: ['FWD', 'MID', 'DEF'], chance: 0.2, affinity: ['pace', 'acceleration'] },
  { id: 'first_touch', name: 'First Touch', icon: '🧲', desc: 'Kills any ball dead: never takes a heavy touch, even under pressure.', groups: ['FWD', 'MID'], chance: 1, affinity: ['dribbling', 'composure'] },
  { id: 'precision_pass', name: 'Precision Pass', icon: '🔑', desc: 'Sometimes threads a perfectly weighted pass into space that defenders read late.', groups: ['MID'], chance: 0.4, affinity: ['vision', 'passing'] },
  { id: 'curve_pass', name: 'Curved Pass', icon: '🌀', desc: 'Sometimes bends a pass around the man in the way, right into a team-mate\'s stride.', groups: ['MID', 'FWD', 'DEF'], chance: 0.4, affinity: ['passing', 'crossing'] },
  { id: 'long_ball', name: 'Long Ball', icon: '🚀', desc: 'Looks for the long pass upfield, and sometimes pings it fast and dead accurate.', groups: ['DEF'], chance: 0.5, affinity: ['passing', 'vision'] },
  { id: 'volley', name: 'Volley', icon: '🔥', desc: 'Sometimes meets a dropping ball first time with a volley instead of a header.', groups: ['FWD', 'MID'], chance: 0.45, affinity: ['finishing', 'composure'] },
  { id: 'cut_inside', name: 'Cut Inside', icon: '↩️', desc: 'Sometimes cuts in off the flank at pace and shoots with extra accuracy.', groups: ['FWD', 'MID'], slots: ['LW', 'RW', 'LM', 'RM'], chance: 0.4, affinity: ['dribbling', 'finishing'] },
  { id: 'hold_up', name: 'Hold-Up Play', icon: '🏋️', desc: 'Always on: uses his strength to shield the ball up front until team-mates arrive.', groups: ['FWD'], slots: ['ST'], chance: 1, affinity: ['strength', 'composure'] },
  { id: 'close_control', name: 'Close Control', icon: '🪄', desc: 'Always on: keeps the ball glued to his feet, so tackles on him fail far more often.', groups: ['MID'], chance: 1, affinity: ['dribbling', 'composure'] },
  { id: 'clean_tackle', name: 'Clean Tackler', icon: '🧹', desc: 'Always on: times tackles precisely, winning more of them and giving away far fewer fouls.', groups: ['DEF', 'MID'], chance: 1, affinity: ['tackling', 'composure'] },
  { id: 'awareness', name: 'Awareness', icon: '👁️', desc: 'Always on: reads the game. Picks the right spot to defend, finds space in attack, and as a keeper narrows the angle.', groups: ['GK', 'DEF', 'MID', 'FWD'], chance: 1, affinity: ['positioning', 'vision'] },
  { id: 'crosser', name: 'Crosser', icon: '🪃', desc: 'Sometimes whips in a pinpoint cross that lands right on a team-mate.', groups: ['MID', 'DEF', 'FWD'], slots: WIDE, chance: 0.5, affinity: ['crossing'] },
  { id: 'tireless', name: 'Tireless', icon: '🔋', desc: 'Always on: tires 30% more slowly.', groups: ['MID', 'DEF', 'FWD'], chance: 1, affinity: ['stamina'] },
  { id: 'ball_winner', name: 'Ball Winner', icon: '🦾', desc: 'Sometimes times a tackle perfectly and comes away with the ball, cleanly.', groups: ['MID', 'DEF'], chance: 0.15, affinity: ['tackling', 'aggression'] },
  { id: 'aerial_guardian', name: 'Aerial Guardian', icon: '🛡️', desc: 'Sometimes rises above an attacker to head the danger away.', groups: ['DEF'], chance: 0.45, affinity: ['heading', 'strength'] },
  { id: 'last_ditch', name: 'Last-Ditch Block', icon: '🧱', desc: 'Throws himself at shots: reaches blocks others can\'t and rarely misses one.', groups: ['DEF', 'MID'], chance: 0.6, affinity: ['positioning', 'marking'] },
  { id: 'interceptor', name: 'Interceptor', icon: '🕸️', desc: 'Always on: reads passes earlier and cuts out more of them.', groups: ['DEF', 'MID'], chance: 1, affinity: ['positioning', 'marking'] },
  { id: 'sliding_tackle', name: 'Sliding Tackle', icon: '🦵', desc: 'Sometimes slides in from further away to win the ball.', groups: ['DEF'], chance: 0.25, affinity: ['tackling', 'pace'] },
  { id: 'cat_reflexes', name: 'Cat Reflexes', icon: '🐱', desc: 'Sometimes pulls off a miracle save from a shot that was going in.', groups: ['GK'], chance: 0.22, affinity: ['goalkeeping', 'acceleration'] },
  { id: 'penalty_stopper', name: 'Penalty Stopper', icon: '✋', desc: 'Often guesses right from the spot.', groups: ['GK'], chance: 0.4, affinity: ['goalkeeping', 'composure'] },
  { id: 'safe_hands', name: 'Safe Hands', icon: '🧤', desc: 'Always on: holds on to shots instead of parrying them.', groups: ['GK'], chance: 1, affinity: ['goalkeeping', 'composure'] },
];

export const SKILLS: Record<SkillId, SkillDef> = Object.fromEntries(LIST.map((s) => [s.id, s])) as Record<SkillId, SkillDef>;

/** How many skills a player of each rarity has. */
export const SKILL_SLOTS: Record<Rarity, number> = { bronze: 0, silver: 1, gold: 2, elite: 3 };

/** Skills a player in this position could have. */
export function skillsFor(pos: SlotPos): SkillDef[] {
  const group = SLOT_GROUP[pos];
  return LIST.filter((s) => s.groups.includes(group) && (!s.slots || s.slots.includes(pos)));
}

/**
 * Top a player's skills up to what his rarity allows, favouring skills that suit his
 * attributes. Skills are never taken away, so a player who improves into a new rarity learns
 * one more. `rand` returns 0..1.
 */
export function grantSkills(p: Player, rand: () => number): SkillId[] {
  p.skills ??= [];
  const learned: SkillId[] = [];
  const want = SKILL_SLOTS[p.rarity];
  while (p.skills.length < want) {
    const pool = skillsFor(p.positions[0]).filter((s) => !p.skills.includes(s.id));
    if (!pool.length) break;
    const weights = pool.map((s) => {
      const fit = s.affinity.reduce((a, k) => a + p.attrs[k], 0) / s.affinity.length / 99;
      return fit ** 3 + 0.02;
    });
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    let pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) {
        pick = pool[i];
        break;
      }
    }
    p.skills.push(pick.id);
    learned.push(pick.id);
  }
  return learned;
}

/** Deterministic 0..1 stream from a string, for giving skills to players from older saves. */
export function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Skills that were renamed; saves holding the old id get the new one. */
const RENAMED: Record<string, SkillId> = { killer_pass: 'precision_pass' };

/** Map renamed skill ids and drop any that no longer exist. */
export function migrateSkills(p: Player): void {
  p.skills = (p.skills ?? []).map((id) => RENAMED[id] ?? id).filter((id) => id in SKILLS);
}
