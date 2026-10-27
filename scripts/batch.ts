/**
 * Headless tactics lab: plays many seeded matches per tactical setting against the same
 * opponent and prints how the team's averages move. Usage: npm run batch [-- matches]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { TeamSetup, makeTeam } from '../src/data/generator';
import { TeamInstructions, cloneTactics } from '../src/tactics/instructions';
import type { TeamStats } from '../src/sim/stats';
import { HALF_SECONDS, TICK } from '../src/sim/constants';

const N = Number(process.argv[2] ?? 40);

function baseTeams(): [TeamSetup, TeamSetup] {
  const rng = new Rng(1234);
  return [makeTeam(rng, 'Home', 'HOM', '#d64045', 65), makeTeam(rng, 'Away', 'AWY', '#3a86ff', 65)];
}

type Row = TeamStats & { goals: number; against: number; shotsAgainst: number; xgAgainst: number; stamina: number };

const only = process.argv[3];

function run(label: string, tweak: Partial<TeamInstructions>): Row | null {
  if (only && !only.split(',').includes(label.split(' ')[0])) return null;
  const [home, away] = baseTeams();
  const acc = {} as Record<string, number>;
  for (let i = 0; i < N; i++) {
    const h = { ...home, tactics: cloneTactics(home.tactics) };
    Object.assign(h.tactics.team, tweak);
    const a = { ...away, tactics: cloneTactics(away.tactics) };
    const m = new Match(h, a, 1000 + i);
    m.simulateFull();
    const s = m.stats[0] as unknown as Record<string, number>;
    for (const k of Object.keys(s)) acc[k] = (acc[k] ?? 0) + s[k];
    acc.goals = (acc.goals ?? 0) + m.score[0];
    acc.against = (acc.against ?? 0) + m.score[1];
    acc.shotsAgainst = (acc.shotsAgainst ?? 0) + m.stats[1].shots;
    acc.xgAgainst = (acc.xgAgainst ?? 0) + m.stats[1].xg;
    const st = m.onPitch.filter((p) => p.team === 0 && !p.isGK);
    acc.stamina = (acc.stamina ?? 0) + st.reduce((x, p) => x + p.stamina, 0) / st.length;
  }
  for (const k of Object.keys(acc)) acc[k] /= N;
  const r = acc as unknown as Row;
  const poss = (r.possessionTicks / ((2 * HALF_SECONDS) / TICK)) * 100;
  console.log(
    `${label.padEnd(18)} GF ${r.goals.toFixed(2)} GA ${r.against.toFixed(2)} | sh ${r.shots.toFixed(1)} (${r.shotsOnTarget.toFixed(1)}) xG ${r.xg.toFixed(2)} vs ${r.shotsAgainst.toFixed(1)} xGA ${r.xgAgainst.toFixed(2)} | pass ${r.passes.toFixed(0)} ${((r.passesCompleted / r.passes) * 100).toFixed(0)}% | cross ${r.crosses.toFixed(1)} | tkl ${r.tackles.toFixed(1)}/${r.tacklesWon.toFixed(1)} | fouls ${r.fouls.toFixed(1)} Y ${r.yellows.toFixed(2)} R ${r.reds.toFixed(2)} | highTO ${r.highTurnovers.toFixed(1)} | poss ${poss.toFixed(0)}% | stam ${r.stamina.toFixed(2)}`,
  );
  return r;
}

const t0 = Date.now();
run('baseline', {});
run('press high', { pressing: 1 });
run('press low', { pressing: -1 });
run('tackle aggressive', { tackling: 1 });
run('tackle stay feet', { tackling: -1 });
run('attacking', { mentality: 2 });
run('defensive', { mentality: -2 });
run('wide', { width: 1 });
run('narrow', { width: -1 });
run('direct', { directness: 1 });
run('short', { directness: -1 });
console.log(`${N} matches per row, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
