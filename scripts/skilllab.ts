/**
 * Skill lab. Part 1: a gold-rated team with its generated skills vs the same team with skills
 * stripped, same seeds and opponent; prints how often each skill fires and the overall effect.
 * Part 2: each skill given to every eligible home player, so its own effect is measurable.
 * Usage: npx tsx scripts/skilllab.ts [matches]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { TeamSetup, makeTeam } from '../src/data/generator';
import { cloneTactics } from '../src/tactics/instructions';
import { SKILLS, SkillId, skillsFor } from '../src/data/skills';

const N = Number(process.argv[2] ?? 30);

function teams(): [TeamSetup, TeamSetup] {
  const rng = new Rng(2024);
  return [makeTeam(rng, 'Home', 'HOM', '#d64045', 72), makeTeam(rng, 'Away', 'AWY', '#3a86ff', 72)];
}

const strip = (t: TeamSetup, skills: (p: TeamSetup['squad'][number]) => SkillId[]): TeamSetup => ({
  ...t,
  tactics: cloneTactics(t.tactics),
  squad: t.squad.map((p) => ({ ...p, skills: skills(p) })),
});

function play(label: string, home: TeamSetup, away: TeamSetup, fires?: Map<string, number>) {
  let gf = 0;
  let ga = 0;
  let xg = 0;
  let used = 0;
  for (let i = 0; i < N; i++) {
    const m = new Match(strip(home, (p) => p.skills), strip(away, () => []), 700 + i);
    m.simulateFull();
    gf += m.score[0];
    ga += m.score[1];
    xg += m.stats[0].xg;
    used += m.stats[0].skills;
    if (fires) for (const e of m.events) if (e.type === 'skill' && e.team === 0) fires.set(e.text.split(':')[0], (fires.get(e.text.split(':')[0]) ?? 0) + 1);
  }
  console.log(`${label.padEnd(22)} GF ${(gf / N).toFixed(2)} GA ${(ga / N).toFixed(2)} GD ${((gf - ga) / N).toFixed(2)} | xG ${(xg / N).toFixed(2)} | skills fired ${(used / N).toFixed(1)}/match`);
}

const [home, away] = teams();
console.log('Home skills:', home.squad.filter((p) => home.tactics.lineup.includes(p.id)).map((p) => `${p.positions[0]}:${p.skills.map((s) => SKILLS[s].icon).join('')}`).join(' '));
const fires = new Map<string, number>();
play('control (no skills)', strip(home, () => []), away);
play('with generated skills', home, away, fires);
console.log('callouts per match:', [...fires].map(([k, v]) => `${k} ${(v / N).toFixed(1)}`).join(', '));

console.log('\nEach skill on every eligible home starter:');
for (const id of Object.keys(SKILLS) as SkillId[]) {
  const given = strip(home, (p) => (skillsFor(p.positions[0]).some((s) => s.id === id) ? [id] : []));
  play(`${SKILLS[id].icon} ${SKILLS[id].name}`, given, away);
}
