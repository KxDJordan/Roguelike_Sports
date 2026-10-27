import type { SlotPos } from '../data/player';

/**
 * A slot's u is its depth inside the team block (0 = back line, 1 = striker line) and
 * v is across the pitch from the team's own perspective (0 = left touchline, 1 = right).
 * Slot 0 is always the goalkeeper.
 */
export interface Slot {
  pos: SlotPos;
  u: number;
  v: number;
}

export interface Formation {
  id: string;
  name: string;
  slots: Slot[];
}

const s = (pos: SlotPos, u: number, v: number): Slot => ({ pos, u, v });
const GK = s('GK', 0, 0.5);
const BACK4 = [s('LB', 0, 0.1), s('CB', 0, 0.37), s('CB', 0, 0.63), s('RB', 0, 0.9)];

export const FORMATIONS: Record<string, Formation> = {
  '4-3-3': {
    id: '4-3-3',
    name: '4-3-3',
    slots: [GK, ...BACK4, s('DM', 0.25, 0.5), s('CM', 0.45, 0.3), s('CM', 0.45, 0.7), s('LW', 0.85, 0.12), s('ST', 1, 0.5), s('RW', 0.85, 0.88)],
  },
  '4-4-2': {
    id: '4-4-2',
    name: '4-4-2',
    slots: [GK, ...BACK4, s('LM', 0.45, 0.1), s('CM', 0.45, 0.38), s('CM', 0.45, 0.62), s('RM', 0.45, 0.9), s('ST', 1, 0.38), s('ST', 1, 0.62)],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    name: '4-2-3-1',
    slots: [GK, ...BACK4, s('DM', 0.25, 0.38), s('DM', 0.25, 0.62), s('LW', 0.7, 0.12), s('AM', 0.7, 0.5), s('RW', 0.7, 0.88), s('ST', 1, 0.5)],
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    name: '4-1-4-1',
    slots: [GK, ...BACK4, s('DM', 0.22, 0.5), s('LM', 0.5, 0.1), s('CM', 0.5, 0.38), s('CM', 0.5, 0.62), s('RM', 0.5, 0.9), s('ST', 1, 0.5)],
  },
  '3-5-2': {
    id: '3-5-2',
    name: '3-5-2',
    slots: [GK, s('CB', 0, 0.25), s('CB', 0, 0.5), s('CB', 0, 0.75), s('LWB', 0.35, 0.06), s('DM', 0.25, 0.5), s('CM', 0.45, 0.32), s('CM', 0.45, 0.68), s('RWB', 0.35, 0.94), s('ST', 1, 0.38), s('ST', 1, 0.62)],
  },
  '5-3-2': {
    id: '5-3-2',
    name: '5-3-2',
    slots: [GK, s('LWB', 0.05, 0.07), s('CB', 0, 0.28), s('CB', 0, 0.5), s('CB', 0, 0.72), s('RWB', 0.05, 0.93), s('CM', 0.45, 0.28), s('CM', 0.4, 0.5), s('CM', 0.45, 0.72), s('ST', 1, 0.38), s('ST', 1, 0.62)],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS);
