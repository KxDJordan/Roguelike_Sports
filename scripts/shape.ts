/**
 * Compares the tactics-board preview shape with where players actually stand in matches.
 * Samples team 0's positions while the opponent has the ball (or in possession, with --attack).
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';
import { formationTarget, keeperTarget, toU, toV } from '../src/sim/positioning';
import { PITCH_L, PITCH_W } from '../src/sim/constants';
import { ROLES } from '../src/tactics/roles';

const attack = process.argv.includes('--attack');
const rng = new Rng(9);
const home = makeTeam(rng, 'H', 'H', '#f00', 65, '4-4-2');
const away = makeTeam(rng, 'A', 'A', '#00f', 65, '4-3-3');
const sum = Array.from({ length: 11 }, () => ({ u: 0, v: 0, n: 0 }));
const ballSum = { u: 0, v: 0, n: 0 };

for (let i = 0; i < 6; i++) {
  const m = new Match(home, away, i + 1);
  while (m.phase !== 'fulltime') {
    if (m.phase === 'halftime') m.startSecondHalf();
    m.step();
    if (m.phase !== 'play' || m.ball.owner === null) continue;
    if ((m.possession === 0) !== attack) continue;
    ballSum.u += toU(0, m.ball.pos.x);
    ballSum.v += toV(0, m.ball.pos.y);
    ballSum.n++;
    for (const p of m.onPitch) {
      if (p.team !== 0) continue;
      const s = sum[p.slot];
      s.u += toU(0, p.pos.x);
      s.v += toV(0, p.pos.y);
      s.n++;
    }
  }
}

const form = home.tactics;
const center = { x: PITCH_L / 2, y: PITCH_W / 2 };
const avgBall = { x: (ballSum.u / ballSum.n) * PITCH_L, y: (ballSum.v / ballSum.n) * PITCH_W };
console.log(`${attack ? 'IN' : 'OUT OF'} possession. avg ball u=${(ballSum.u / ballSum.n).toFixed(2)} v=${(ballSum.v / ballSum.n).toFixed(2)}`);
console.log('slot  role  actual(u,v)   board@center(u,v)   board@avgBall(u,v)');
const { FORMATIONS } = await import('../src/tactics/formations');
FORMATIONS[form.formation].slots.forEach((slot, i) => {
  const role = ROLES[form.roles[i]];
  const ctx = (ball: { x: number; y: number }) =>
    i === 0 ? keeperTarget(0, ball, false, 0) : formationTarget(0, slot, role, form.instr[i], { ball, inPossession: attack, ti: form.team });
  const a = sum[i];
  const b = ctx(center);
  const c = ctx(avgBall);
  const f = (x: number) => x.toFixed(2);
  console.log(`${slot.pos.padEnd(5)} ${role.short.padEnd(5)} ${f(a.u / a.n)},${f(a.v / a.n)}     ${f(toU(0, b.x))},${f(toV(0, b.y))}          ${f(toU(0, c.x))},${f(toV(0, c.y))}`);
});
