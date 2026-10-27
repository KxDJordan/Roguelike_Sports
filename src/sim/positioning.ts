import { PITCH_L, PITCH_W } from './constants';
import { Vec, clamp } from './vec';
import type { Slot } from '../tactics/formations';
import type { Role } from '../tactics/roles';
import type { PlayerInstructions, TeamInstructions } from '../tactics/instructions';

export type TeamSide = 0 | 1;

/** How far up the pitch a point is from a team's perspective (0 = own goal line, 1 = opponent's). */
export const toU = (team: TeamSide, x: number): number => (team === 0 ? x / PITCH_L : 1 - x / PITCH_L);
/** Across the pitch from a team's perspective (0 = its left touchline). */
export const toV = (team: TeamSide, y: number): number => (team === 0 ? y / PITCH_W : 1 - y / PITCH_W);
export const fromUV = (team: TeamSide, u: number, v: number): Vec =>
  team === 0 ? { x: u * PITCH_L, y: v * PITCH_W } : { x: (1 - u) * PITCH_L, y: (1 - v) * PITCH_W };

export interface ShapeContext {
  ball: Vec;
  inPossession: boolean;
  ti: TeamInstructions;
  /** Deepest opposition outfielder (team-relative u); attackers won't drift beyond it. */
  oppLineU?: number;
}

/**
 * Where an outfield player wants to stand. The team block's back line slides with the ball,
 * its depth and width stretch in possession and compress out of it, and the role shifts the
 * player within the block.
 */
export function formationTarget(team: TeamSide, slot: Slot, role: Role, instr: PlayerInstructions, ctx: ShapeContext): Vec {
  const { ti } = ctx;
  const bu = toU(team, ctx.ball.x);
  const bv = toV(team, ctx.ball.y);
  let line: number;
  let depth: number;
  let widthF: number;
  let shiftV: number;
  if (ctx.inPossession) {
    line = 0.24 + 0.05 * ti.mentality + 0.04 * ti.lineHeight + (bu - 0.5) * 0.42;
    depth = 0.46 + 0.035 * ti.mentality;
    widthF = 0.95 + 0.16 * ti.width;
    shiftV = 0.12;
  } else {
    line = 0.21 + 0.07 * ti.lineHeight + 0.04 * ti.pressing + 0.02 * ti.mentality + (bu - 0.5) * 0.32;
    depth = 0.37 + 0.02 * ti.lineHeight + 0.015 * ti.mentality;
    // Keep the block spread across the pitch: it slides toward the ball rather than squeezing into it.
    widthF = 0.84 + 0.07 * ti.width;
    shiftV = 0.2;
  }
  line = clamp(line, 0.06, 0.56);
  const off = ctx.inPossession ? role.attack : role.defend;
  let u = line + slot.u * depth + off.du;
  if (ctx.inPossession) u += 0.035 * instr.runs;
  const toward = Math.sign(0.5 - slot.v);
  const v = 0.5 + (slot.v - 0.5) * widthF + toward * off.dv + (bv - 0.5) * shiftV;
  // Nobody drifts beyond the opposition's last outfielder (offside line in possession, their shoulder out of it).
  if (ctx.oppLineU !== undefined) u = Math.min(u, Math.max(ctx.oppLineU, ctx.inPossession ? bu : 0) + 0.01);
  return fromUV(team, clamp(u, 0.03, 0.96), clamp(v, 0.03, 0.97));
}

/** Keepers track the ball across the goal; sweepers come off the line as the ball moves away. */
export function keeperTarget(team: TeamSide, ball: Vec, sweeper: boolean, lineHeight: number): Vec {
  const bu = toU(team, ball.x);
  const bv = toV(team, ball.y);
  const u = sweeper ? 0.03 + 0.1 * Math.max(0, bu - 0.4) + 0.012 * lineHeight : 0.012 + 0.012 * bu;
  return fromUV(team, u, 0.5 + (bv - 0.5) * 0.18);
}
