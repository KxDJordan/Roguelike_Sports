import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { TeamSetup, makeTeam } from '../src/data/generator';
import { cloneTactics } from '../src/tactics/instructions';
const rng = new Rng(4321);
const home = makeTeam(rng, 'Home', 'HOM', '#d64045', 62);
const away = makeTeam(rng, 'Away', 'AWY', '#3a86ff', 62);
const prep = (t: TeamSetup, by: number): TeamSetup => ({ ...t, tactics: cloneTactics(t.tactics), squad: t.squad.map((p) => ({ ...p, skills: [], attrs: { ...p.attrs, positioning: Math.min(99, p.attrs.positioning + by) } })) });
for (const by of [0, 25]) {
  let int = 0, opp = 0, xga = 0, ga = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    const m = new Match(prep(home, by), prep(away, 0), 500 + i);
    m.simulateFull();
    int += m.stats[0].interceptions; opp += m.stats[1].passes; xga += m.stats[1].xg; ga += m.score[1];
  }
  console.log(`positioning +${by}: interceptions ${(int / N).toFixed(1)} per opp pass ${((int / opp) * 100).toFixed(1)}% | xGA ${(xga / N).toFixed(2)} GA ${(ga / N).toFixed(2)}`);
}
