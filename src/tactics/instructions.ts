import { FORMATIONS } from './formations';
import { defaultRole } from './roles';

/** All team instructions are on a -1..1 scale except mentality (-2..2). */
export interface TeamInstructions {
  mentality: number;
  width: number;
  lineHeight: number;
  pressing: number;
  /** Tackling aggressiveness: more ball wins, but more fouls and cards. */
  tackling: number;
  tempo: number;
  directness: number;
}

export interface PlayerInstructions {
  aggression: number;
  runs: number;
  shooting: number;
}

export interface Tactics {
  formation: string;
  /** Player ids, one per formation slot. */
  lineup: string[];
  /** Role id per formation slot. */
  roles: string[];
  instr: PlayerInstructions[];
  team: TeamInstructions;
}

export const defaultTeamInstructions = (): TeamInstructions => ({
  mentality: 0,
  width: 0,
  lineHeight: 0,
  pressing: 0,
  tackling: 0,
  tempo: 0,
  directness: 0,
});

export const defaultPlayerInstructions = (): PlayerInstructions => ({ aggression: 0, runs: 0, shooting: 0 });

export interface InstructionOption<K extends string> {
  key: K;
  label: string;
  options: { value: number; label: string }[];
}

const three = (lo: string, mid: string, hi: string) => [
  { value: -1, label: lo },
  { value: 0, label: mid },
  { value: 1, label: hi },
];

export const TEAM_INSTRUCTION_OPTIONS: InstructionOption<keyof TeamInstructions>[] = [
  {
    key: 'mentality',
    label: 'Mentality',
    options: [
      { value: -2, label: 'Defensive' },
      { value: -1, label: 'Cautious' },
      { value: 0, label: 'Balanced' },
      { value: 1, label: 'Positive' },
      { value: 2, label: 'Attacking' },
    ],
  },
  { key: 'width', label: 'Width', options: three('Narrow', 'Normal', 'Wide') },
  { key: 'lineHeight', label: 'Defensive line', options: three('Deep', 'Normal', 'High') },
  { key: 'pressing', label: 'Pressing', options: three('Low', 'Normal', 'High') },
  { key: 'tackling', label: 'Tackling', options: three('Stay on feet', 'Normal', 'Aggressive') },
  { key: 'tempo', label: 'Tempo', options: three('Slow', 'Normal', 'Fast') },
  { key: 'directness', label: 'Passing', options: three('Short', 'Mixed', 'Direct') },
];

export const PLAYER_INSTRUCTION_OPTIONS: InstructionOption<keyof PlayerInstructions>[] = [
  { key: 'aggression', label: 'Aggression', options: three('Low', 'Normal', 'High') },
  { key: 'runs', label: 'Forward runs', options: three('Stay back', 'Normal', 'Get forward') },
  { key: 'shooting', label: 'Shooting', options: three('Less', 'Normal', 'More') },
];

export function cloneTactics(t: Tactics): Tactics {
  return {
    formation: t.formation,
    lineup: [...t.lineup],
    roles: [...t.roles],
    instr: t.instr.map((i) => ({ ...i })),
    team: { ...t.team },
  };
}

/** Switch formation keeping players in slot order and resetting roles to the new slots' defaults. */
export function withFormation(t: Tactics, formationId: string): Tactics {
  const next = cloneTactics(t);
  next.formation = formationId;
  next.roles = FORMATIONS[formationId].slots.map((s) => defaultRole(s.pos));
  return next;
}
