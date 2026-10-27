/**
 * Weather lab: plays the same fixtures in every weather and prints how the match changes.
 * Usage: npx tsx scripts/weatherlab.ts [matches]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';
import { cloneTactics } from '../src/tactics/instructions';
import { WEATHER, WeatherId } from '../src/sim/weather';

const N = Number(process.argv[2] ?? 30);

for (const id of Object.keys(WEATHER) as WeatherId[]) {
  const weather = { ...WEATHER[id] };
  if (id === 'wind' || id === 'storm') weather.wind = { x: 0, y: id === 'wind' ? 3.5 : 2.2 };
  const acc: Record<string, number> = {};
  const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
  for (let i = 0; i < N; i++) {
    const rng = new Rng(777);
    const a = makeTeam(rng, 'A', 'A', '#f00', 64);
    const b = makeTeam(rng, 'B', 'B', '#00f', 64);
    const m = new Match({ ...a, tactics: cloneTactics(a.tactics) }, { ...b, tactics: cloneTactics(b.tactics) }, 900 + i, weather);
    m.simulateFull();
    for (const s of m.stats) {
      add('shots', s.shots);
      add('xg', s.xg);
      add('passes', s.passes);
      add('passOk', s.passesCompleted);
      add('crosses', s.crosses);
    }
    add('goals', m.score[0] + m.score[1]);
    add('saves', m.players.reduce((x, p) => x + p.ps.saves, 0));
    const out = m.onPitch.filter((p) => !p.isGK);
    add('stam', out.reduce((x, p) => x + p.stamina, 0) / out.length);
  }
  const r = (k: string) => acc[k] / N;
  console.log(
    `${weather.name.padEnd(13)} goals ${r('goals').toFixed(2)} | shots ${r('shots').toFixed(1)} xG ${r('xg').toFixed(2)} | passes ${r('passes').toFixed(0)} ${((acc.passOk / acc.passes) * 100).toFixed(0)}% | crosses ${r('crosses').toFixed(1)} | saves ${r('saves').toFixed(1)} | stamina ${r('stam').toFixed(2)}`,
  );
}
