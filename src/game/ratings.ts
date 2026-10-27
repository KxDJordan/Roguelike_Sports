import type { Match, SimPlayer } from '../sim/match';
import { SLOT_GROUP } from '../data/player';

/** Match rating on the usual 1-10 scale, from a player's individual contribution and the result. */
export function playerRating(m: Match, p: SimPlayer): number {
  const s = p.ps;
  const mins = Math.max(1, m.minutesPlayed(p));
  const share = Math.min(1, mins / 90);
  const conceded = m.score[1 - p.team];
  const diff = m.score[p.team] - conceded;
  const pos = m.formation(p.team).slots[p.slot].pos;
  const group = SLOT_GROUP[pos];

  let r = 6.2;
  r += s.goals * 1.1 + s.assists * 0.7 + s.keyPasses * 0.18;
  r += s.onTarget * 0.12 - Math.max(0, s.shots - s.onTarget) * 0.04;
  r += Math.min(0.8, s.passesOk * 0.012) - (s.passes - s.passesOk) * 0.03;
  r += s.tacklesWon * 0.16 + s.interceptions * 0.12 + s.blocks * 0.25 + s.aerialsWon * 0.06;
  r += s.saves * 0.4;
  r -= s.fouls * 0.05 + s.yellow * 0.35 + s.red * 1.8;
  r += clamp(diff, -3, 3) * 0.15 * share;
  if (group === 'GK') r += conceded === 0 ? 0.6 * share : -0.35 * conceded * share;
  if (group === 'DEF') r += conceded === 0 ? 0.4 * share : -0.15 * conceded * share;
  // Short cameos are pulled toward an average rating.
  r = 6 + (r - 6) * (0.5 + 0.5 * share);
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
