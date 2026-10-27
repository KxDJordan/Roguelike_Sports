import type { SkillId } from '../data/skills';

export interface TeamStats {
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passesCompleted: number;
  crosses: number;
  corners: number;
  tackles: number;
  tacklesWon: number;
  fouls: number;
  yellows: number;
  reds: number;
  /** Ball regained in the opponent's half. */
  highTurnovers: number;
  blocks: number;
  interceptions: number;
  /** Skill activations. */
  skills: number;
  possessionTicks: number;
  staminaUsed: number;
}

export const emptyStats = (): TeamStats => ({
  shots: 0,
  shotsOnTarget: 0,
  xg: 0,
  passes: 0,
  passesCompleted: 0,
  crosses: 0,
  corners: 0,
  tackles: 0,
  tacklesWon: 0,
  fouls: 0,
  yellows: 0,
  reds: 0,
  highTurnovers: 0,
  blocks: 0,
  interceptions: 0,
  skills: 0,
  possessionTicks: 0,
  staminaUsed: 0,
});

/** Individual contribution, used for match ratings and form. */
export interface PlayerMatchStats {
  passes: number;
  passesOk: number;
  keyPasses: number;
  assists: number;
  shots: number;
  onTarget: number;
  goals: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  blocks: number;
  saves: number;
  aerialsWon: number;
  fouls: number;
  yellow: number;
  red: number;
  skills: number;
}

export const emptyPlayerStats = (): PlayerMatchStats => ({
  passes: 0,
  passesOk: 0,
  keyPasses: 0,
  assists: 0,
  shots: 0,
  onTarget: 0,
  goals: 0,
  tackles: 0,
  tacklesWon: 0,
  interceptions: 0,
  blocks: 0,
  saves: 0,
  aerialsWon: 0,
  fouls: 0,
  yellow: 0,
  red: 0,
  skills: 0,
});

export type EventType =
  | 'kickoff'
  | 'goal'
  | 'save'
  | 'miss'
  | 'yellow'
  | 'red'
  | 'penalty'
  | 'sub'
  | 'halftime'
  | 'fulltime'
  | 'skill';

export interface MatchEvent {
  minute: number;
  type: EventType;
  team: 0 | 1;
  text: string;
  /** For skill events: which skill fired. */
  skill?: SkillId;
}

/** Visual cues for the renderer (the sim never reads these). */
export type FxType = 'pass' | 'shot' | 'goal' | 'save' | 'block' | 'tackle' | 'foul' | 'card' | 'header' | 'whistle' | 'skill';

export interface Fx {
  type: FxType;
  time: number;
  x: number;
  y: number;
  team: 0 | 1;
  /** Optional second point, e.g. a pass target. */
  tx?: number;
  ty?: number;
  red?: boolean;
  /** Bend of a curled pass: +1 or -1 for which way it swings. */
  curve?: number;
  /** Skill behind a skill callout. */
  skill?: SkillId;
  /** Callout text, e.g. a skill name. */
  label?: string;
}
