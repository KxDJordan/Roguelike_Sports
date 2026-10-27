/**
 * Measures off-ball behaviour: how wide the defending block is, how high non-defending forwards
 * stay, how often attackers make runs into gaps, and how well defenders cover passing lanes.
 * Usage: npx tsx scripts/shapediag.ts [matches]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';
import { toU } from '../src/sim/positioning';
import { FORMATIONS } from '../src/tactics/formations';
import { defaultRole } from '../src/tactics/roles';

const N = Number(process.argv[2] ?? 4);
let defTicks = 0;
let widthSum = 0;
let fwdUSum = 0;
let fwdN = 0;
let laneCovered = 0;
let laneTotal = 0;
let runStarts = 0;
let runPasses = 0;
let runPassesOk = 0;
let loftFlight = 0;
let loftDist = 0;
let lofts = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = Match.prototype as any;
const origRun = proto.maybeStartRun;
proto.maybeStartRun = function (this: Match, p: { runTarget: unknown }, ...rest: unknown[]) {
  const had = p.runTarget;
  origRun.call(this, p, ...rest);
  if (!had && p.runTarget) runStarts++;
};
const origPass = proto.pass;
proto.pass = function (this: Match, p: unknown, m: { runTarget: unknown; action: string }, aim: unknown, lofted: boolean, ...rest: unknown[]) {
  if (m.action === 'run') {
    runPasses++;
    pendingRun = (m as unknown as { id: number }).id;
  }
  if (lofted) {
    loftStart = this.time;
    loftLen = Math.hypot((aim as { x: number }).x - (p as { pos: { x: number } }).pos.x, (aim as { y: number }).y - (p as { pos: { y: number } }).pos.y);
  }
  return origPass.call(this, p, m, aim, lofted, ...rest);
};
let pendingRun = -1;
let lastPoss = -1;
let turnoverAt = -99;
let transTotal = 0;
let transMarked = 0;
let loftStart = -1;
let loftLen = 0;
const origSet = proto.setOwner;
proto.setOwner = function (this: Match, p: { id: number }) {
  if (pendingRun === p.id) runPassesOk++;
  pendingRun = -1;
  return origSet.call(this, p);
};

for (let i = 0; i < N; i++) {
  const rng = new Rng(300 + i);
  const home = makeTeam(rng, 'A', 'A', '#f00', 65);
  // Home plays a poacher up front, who should barely defend.
  home.tactics.formation = '4-3-3';
  home.tactics.roles = FORMATIONS['4-3-3'].slots.map((s) => (s.pos === 'ST' ? 'pch' : defaultRole(s.pos)));
  const m = new Match(home, makeTeam(rng, 'B', 'B', '#00f', 65), i + 1);
  while (!m.isFinished()) {
    const wasLofted = m.ball.lofted;
    m.step();
    if (wasLofted && !m.ball.lofted && loftStart >= 0) {
      loftFlight += m.time - loftStart;
      loftDist += loftLen;
      lofts++;
      loftStart = -1;
    }
    if (m.phase === 'halftime') m.startSecondHalf();
    if (m.phase !== 'play' || m.ball.owner === null) continue;
    const carrier = m.players[m.ball.owner];
    const def = 1 - carrier.team;
    defTicks++;
    const outfield = m.onPitch.filter((p) => p.team === def && !p.isGK);
    const ys = outfield.map((p) => p.pos.y);
    widthSum += Math.max(...ys) - Math.min(...ys);
    if (def === 0) {
      const st = m.onPitch.find((p) => p.team === 0 && p.role.id === 'pch');
      if (st) {
        fwdUSum += toU(0, st.pos.x);
        fwdN++;
      }
    }
    // Transition marking: in the 6 s after a turnover, attackers in the defending half with a defender within 4 m.
    if (carrier.team !== lastPoss) {
      lastPoss = carrier.team;
      turnoverAt = m.time;
    }
    if (m.time - turnoverAt < 6) {
      for (const a of m.onPitch) {
        if (a.team !== carrier.team || a === carrier || a.isGK || toU(def as 0 | 1, a.pos.x) > 0.5) continue;
        transTotal++;
        if (outfield.some((d) => Math.hypot(d.pos.x - a.pos.x, d.pos.y - a.pos.y) < 4)) transMarked++;
      }
    }
    // Lane coverage: share of carrier->attacker lanes (within 30 m) with a defender within 2 m of the line.
    for (const a of m.onPitch) {
      if (a.team !== carrier.team || a === carrier || a.isGK) continue;
      const dx = a.pos.x - carrier.pos.x;
      const dy = a.pos.y - carrier.pos.y;
      const L = Math.hypot(dx, dy);
      if (L > 30 || L < 5) continue;
      laneTotal++;
      for (const d of outfield) {
        const t = ((d.pos.x - carrier.pos.x) * dx + (d.pos.y - carrier.pos.y) * dy) / (L * L);
        if (t < 0.1 || t > 0.95) continue;
        const px = carrier.pos.x + dx * t - d.pos.x;
        const py = carrier.pos.y + dy * t - d.pos.y;
        if (Math.hypot(px, py) < 2) {
          laneCovered++;
          break;
        }
      }
    }
  }
}
console.log('defending block width (m)     ', (widthSum / defTicks).toFixed(1));
console.log('poacher u when defending      ', (fwdUSum / Math.max(1, fwdN)).toFixed(2));
console.log('lanes covered %               ', ((laneCovered / laneTotal) * 100).toFixed(1));
console.log('marked in transition %        ', ((transMarked / Math.max(1, transTotal)) * 100).toFixed(1));
console.log('runs started per team-match   ', (runStarts / N / 2).toFixed(1));
console.log('passes to runners / completed ', (runPasses / N / 2).toFixed(1), '/', (runPassesOk / N / 2).toFixed(1));
console.log('lofted flight s / avg dist m  ', (loftFlight / Math.max(1, lofts)).toFixed(2), '/', (loftDist / Math.max(1, lofts)).toFixed(1));
