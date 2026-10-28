/**
 * Cup lab: simulates many cup runs (random draft picks, first boon offered, both sides AI) and
 * prints how far they get. Usage: npx tsx scripts/cuplab.ts [runs] [scouting]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';
import type { Club } from '../src/game/club';
import { ROUND_NAMES, draftPick, finishTie, shootout, startRun, takeBoon, tieSides } from '../src/game/cup';

const RUNS = Number(process.argv[2] ?? 60);
const SCOUTING = Number(process.argv[3] ?? 0);
const reached = new Array(ROUND_NAMES.length + 1).fill(0);
let shootouts = 0;
for (let r = 0; r < RUNS; r++) {
  const c: Club = { version: 2, team: makeTeam(new Rng(3), 'Y', 'YOU', '#e63946', 62), coins: 1e6, matchesPlayed: 0, record: { w: 0, d: 0, l: 0, gf: 0, ga: 0 }, results: [], cupMeta: { runs: 0, cupsWon: 0, best: -1, scouting: SCOUTING } };
  const run = startRun(c, '4-3-3', 1000 + r)!;
  const pick = new Rng(77 + r);
  while (run.draft) draftPick(run, pick.int(0, 2));
  let i = 0;
  while (run.status === 'active' && i++ < 12) {
    const { home, away, weather } = tieSides(run);
    const m = new Match(home, away, 5000 + r * 13 + i, weather);
    m.aiTeams = [0, 1];
    m.simulateFull();
    let pens;
    if (m.score[0] === m.score[1]) {
      pens = shootout(run, home, away);
      shootouts++;
    }
    finishTie(c, m, pens);
    if (run.offer) takeBoon(run, run.offer[0]);
  }
  reached[run.status === 'won' ? ROUND_NAMES.length : run.round]++;
}
console.log(`${RUNS} runs at scouting ${SCOUTING}:`);
reached.forEach((n, i) => console.log(`  ${(i === ROUND_NAMES.length ? 'Won the cup' : `Out in ${ROUND_NAMES[i]}`).padEnd(22)} ${((n / RUNS) * 100).toFixed(0)}%`));
console.log(`  shootouts per run ${(shootouts / RUNS).toFixed(2)}`);
