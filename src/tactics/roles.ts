import type { SlotPos } from '../data/player';

export interface RoleWeights {
  pass: number;
  dribble: number;
  shoot: number;
  cross: number;
  /** Frequency of forward runs off the ball. */
  run: number;
  /** Willingness to close down the ball carrier. */
  press: number;
  /** Preference for long, progressive passes. */
  direct: number;
  /** Tackle attempt rate. */
  tackle: number;
  /** Bonus in aerial duels. */
  aerial: number;
}

export interface RoleOffset {
  /** Shift up the pitch (block-depth units). */
  du: number;
  /** Shift toward the centre of the pitch; negative hugs the touchline. */
  dv: number;
}

export interface Role {
  id: string;
  name: string;
  short: string;
  slots: SlotPos[];
  desc: string;
  attack: RoleOffset;
  defend: RoleOffset;
  w: RoleWeights;
  sweeper?: boolean;
  /** How far from his zone he'll follow a man when defending (1 = normal; box-to-box covers the whole pitch). */
  roam?: number;
}

const BASE: RoleWeights = { pass: 1, dribble: 1, shoot: 1, cross: 1, run: 1, press: 1, direct: 1, tackle: 1, aerial: 1 };

function role(
  id: string,
  name: string,
  short: string,
  slots: SlotPos[],
  desc: string,
  w: Partial<RoleWeights>,
  attack: Partial<RoleOffset> = {},
  defend: Partial<RoleOffset> = {},
  extra: Partial<Role> = {},
): Role {
  return {
    id,
    name,
    short,
    slots,
    desc,
    w: { ...BASE, ...w },
    attack: { du: 0, dv: 0, ...attack },
    defend: { du: 0, dv: 0, ...defend },
    ...extra,
  };
}

const FB: SlotPos[] = ['LB', 'RB'];
const WB: SlotPos[] = ['LB', 'RB', 'LWB', 'RWB'];
const WIDE_MID: SlotPos[] = ['LM', 'RM'];
const WIDE_ALL: SlotPos[] = ['LM', 'RM', 'LW', 'RW'];

const LIST: Role[] = [
  role('gk', 'Goalkeeper', 'GK', ['GK'], 'Stays on the line and keeps distribution simple.', { dribble: 0.05, direct: 1.2, run: 0 }),
  role('sk', 'Sweeper Keeper', 'SK', ['GK'], 'Starts high to sweep behind the defensive line and plays short out from the back.', { dribble: 0.05, pass: 1.15, direct: 0.8, run: 0 }, {}, {}, { sweeper: true }),

  role('cd', 'Central Defender', 'CD', ['CB'], 'Defends first. Clears danger and keeps passes simple.', { dribble: 0.35, shoot: 0.3, run: 0.05, direct: 1.15, press: 0.9 }),
  role('bpd', 'Ball-Playing Defender', 'BPD', ['CB'], 'Steps into midfield with the ball and looks for line-breaking passes.', { dribble: 0.6, shoot: 0.3, run: 0.05, pass: 1.25, direct: 1.35 }),
  role('stp', 'Stopper', 'STP', ['CB'], 'Steps out of the line aggressively to attack the ball.', { dribble: 0.35, shoot: 0.3, run: 0.05, press: 1.6, tackle: 1.3 }, {}, { du: 0.04 }),

  role('fb', 'Full-Back', 'FB', FB, 'Balanced: supports attacks down the flank but prioritises defending.', { run: 0.6, cross: 1.0, shoot: 0.4 }, { du: 0.12, dv: -0.02 }),
  role('wb', 'Wing-Back', 'WB', WB, 'Bombs forward to provide width and crosses; leaves space behind.', { run: 1.4, cross: 1.4, dribble: 1.1, shoot: 0.5 }, { du: 0.28, dv: -0.04 }, { du: 0.03 }),
  role('ifb', 'Inverted Full-Back', 'IFB', FB, 'Tucks into midfield in possession to add a passer centrally.', { run: 0.4, cross: 0.4, pass: 1.2, shoot: 0.4 }, { du: 0.12, dv: 0.2 }),

  role('anc', 'Anchor', 'A', ['DM'], 'Sits in front of the defence, screens passing lanes and rarely leaves position.', { run: 0.1, press: 0.6, dribble: 0.6, shoot: 0.5 }, { du: -0.06 }, { du: -0.03 }, { roam: 0.8 }),
  role('bwm', 'Ball-Winning Midfielder', 'BWM', ['DM', 'CM'], 'Hunts the ball, presses and tackles relentlessly.', { run: 0.5, press: 1.8, tackle: 1.4, pass: 0.9 }, {}, {}, { roam: 1.3 }),
  role('dlp', 'Deep-Lying Playmaker', 'DLP', ['DM', 'CM'], 'Dictates play from deep with long, progressive passing.', { run: 0.3, pass: 1.4, direct: 1.3, press: 0.8, dribble: 0.8 }, { du: -0.04 }),
  role('cm', 'Central Midfielder', 'CM', ['CM', 'DM'], 'All-round midfielder who links defence and attack.', { run: 0.8 }),
  role('b2b', 'Box-to-Box', 'B2B', ['CM'], 'Covers every blade of grass, arriving in the box and pressing back.', { run: 1.5, press: 1.25, shoot: 1.1 }, { du: 0.1 }, {}, { roam: 1.8 }),

  role('ap', 'Advanced Playmaker', 'AP', ['AM', 'CM'], 'Finds pockets between the lines and creates chances.', { pass: 1.4, dribble: 1.1, direct: 1.2, run: 0.8, press: 0.8 }, { du: 0.05 }),
  role('ss', 'Shadow Striker', 'SS', ['AM'], 'Runs beyond the striker to attack the box.', { run: 1.7, shoot: 1.4, pass: 0.8 }, { du: 0.18 }, { du: 0.04 }),

  role('wm', 'Wide Midfielder', 'WM', WIDE_MID, 'Works up and down the flank, tracking back diligently.', { run: 0.9, press: 1.15, cross: 1.1 }, {}, {}, { roam: 1.25 }),
  role('wng', 'Winger', 'W', WIDE_ALL, 'Hugs the touchline, beats the full-back and delivers crosses.', { cross: 1.6, dribble: 1.3, run: 1.1, press: 0.8 }, { du: 0.1, dv: -0.06 }, { du: 0.06, dv: -0.03 }),
  role('if', 'Inside Forward', 'IF', WIDE_ALL, 'Cuts inside from the flank to shoot.', { shoot: 1.5, dribble: 1.3, cross: 0.4, run: 1.2, press: 0.8 }, { du: 0.08, dv: 0.22 }, { du: 0.06 }),

  role('af', 'Advanced Forward', 'AF', ['ST'], 'Plays on the shoulder of the last defender and runs into the gaps in behind. Stays high as an outlet when defending.', { run: 1.5, shoot: 1.1, press: 0.8 }, { du: 0.03 }, { du: 0.1 }),
  role('tm', 'Target Man', 'TM', ['ST'], 'Physical focal point who wins headers and holds the ball up. Stays high for clearances.', { dribble: 0.5, run: 0.6, aerial: 1.5, press: 0.7 }, { du: -0.02 }, { du: 0.1 }),
  role('pch', 'Poacher', 'P', ['ST'], 'Lurks in the box waiting for chances. Barely defends.', { shoot: 1.6, pass: 0.7, press: 0.45, run: 1.2 }, { du: 0.05 }, { du: 0.17 }),
  role('f9', 'False Nine', 'F9', ['ST'], 'Drops deep to link play and drag centre-backs out of position.', { pass: 1.4, dribble: 1.2, run: 0.4, shoot: 0.9 }, { du: -0.18 }),
  role('pf', 'Pressing Forward', 'PF', ['ST', 'LW', 'RW'], 'Leads the press from the front, harrying defenders into mistakes.', { press: 2.0, tackle: 1.3, run: 1.1 }, {}, {}, { roam: 1.4 }),
];

export const ROLES: Record<string, Role> = Object.fromEntries(LIST.map((r) => [r.id, r]));

export function rolesForSlot(pos: SlotPos): Role[] {
  return LIST.filter((r) => r.slots.includes(pos));
}

const DEFAULT_ROLE: Record<SlotPos, string> = {
  GK: 'gk',
  CB: 'cd',
  LB: 'fb',
  RB: 'fb',
  LWB: 'wb',
  RWB: 'wb',
  DM: 'anc',
  CM: 'cm',
  AM: 'ap',
  LM: 'wm',
  RM: 'wm',
  LW: 'wng',
  RW: 'wng',
  ST: 'af',
};

export function defaultRole(pos: SlotPos): string {
  return DEFAULT_ROLE[pos];
}
