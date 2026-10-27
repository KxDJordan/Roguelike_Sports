/**
 * Attribute lab: boosts one attribute by +20 across a team and plays it against the same
 * opponent with the same seeds as an unboosted control, printing the stats each attribute should
 * move. Usage: npx tsx scripts/statlab.ts [matches] [attr,attr]
 */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { TeamSetup, makeTeam } from '../src/data/generator';
import { ATTR_KEYS, AttrKey } from '../src/data/player';
import { cloneTactics } from '../src/tactics/instructions';

const N = Number(process.argv[2] ?? 20);
const only = process.argv[3]?.split(',');

function teams(): [TeamSetup, TeamSetup] {
  const rng = new Rng(4321);
  return [makeTeam(rng, 'Home', 'HOM', '#d64045', 62), makeTeam(rng, 'Away', 'AWY', '#3a86ff', 62)];
}

function boosted(t: TeamSetup, keys: readonly AttrKey[], by: number): TeamSetup {
  return {
    ...t,
    tactics: cloneTactics(t.tactics),
    squad: t.squad.map((p) => {
      const attrs = { ...p.attrs };
      const gk = p.positions.includes('GK');
      for (const k of keys) if ((k === 'goalkeeping') === gk || keys.length > 1) attrs[k] = Math.max(1, Math.min(99, attrs[k] + by));
      return { ...p, attrs };
    }),
  };
}

type Row = Record<string, number>;

// Count crosses whose aerial duel the boosted (home) side's attacker wins.
let crossWon = [0, 0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = Match.prototype as any;
const origDuel = proto.aerialDuel;
proto.aerialDuel = function (this: Match, att: { id: number; team: number }) {
  const cross = this.ball.cross && att.team === 0;
  origDuel.call(this, att);
  if (!cross) return;
  crossWon[1]++;
  if (this.ball.owner === att.id || this.ball.shot?.shooter === att.id) crossWon[0]++;
};

function play(label: string, keys: readonly AttrKey[], by: number): Row {
  const [home, away] = teams();
  const acc: Row = {};
  crossWon = [0, 0];
  const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
  for (let i = 0; i < N; i++) {
    const m = new Match(boosted(home, keys, by), { ...away, tactics: cloneTactics(away.tactics) }, 500 + i);
    m.simulateFull();
    const s = m.stats[0];
    const o = m.stats[1];
    const mine = m.players.filter((p) => p.team === 0);
    const theirs = m.players.filter((p) => p.team === 1);
    const sum = (ps: typeof mine, k: 'aerialsWon' | 'saves' | 'goals') => ps.reduce((a, p) => a + p.ps[k], 0);
    add('gf', m.score[0]);
    add('ga', m.score[1]);
    add('shots', s.shots);
    add('xg', s.xg);
    add('xga', o.xg);
    add('passes', s.passes);
    add('passOk', s.passesCompleted);
    add('oppPasses', o.passes);
    add('oppPassOk', o.passesCompleted);
    add('tkl', s.tackles);
    add('tklWon', s.tacklesWon);
    add('int', s.interceptions);
    add('fouls', s.fouls);
    add('aerials', sum(mine, 'aerialsWon'));
    add('aerialsLost', sum(theirs, 'aerialsWon'));
    add('saves', sum(mine, 'saves'));
    add('onTargetAgainst', o.shotsOnTarget);
    add('poss', s.possessionTicks / (s.possessionTicks + o.possessionTicks));
    const out = m.onPitch.filter((p) => p.team === 0 && !p.isGK);
    add('stam', out.reduce((a, p) => a + p.stamina, 0) / out.length);
  }
  for (const k of Object.keys(acc)) acc[k] /= N;
  const pct = (a: number, b: number) => ((a / Math.max(1e-9, b)) * 100).toFixed(0).padStart(3);
  console.log(
    `${label.padEnd(13)} GF ${acc.gf.toFixed(2)} GA ${acc.ga.toFixed(2)} | xG ${acc.xg.toFixed(2)} xGA ${acc.xga.toFixed(2)} | conv ${pct(acc.gf, acc.shots)}% | pass ${pct(acc.passOk, acc.passes)}% opp ${pct(acc.oppPassOk, acc.oppPasses)}% | cross won ${pct(crossWon[0], crossWon[1])}% | tkl won ${pct(acc.tklWon, acc.tkl)}% | int ${acc.int.toFixed(1)} | aerial ${pct(acc.aerials, acc.aerials + acc.aerialsLost)}% | save ${pct(acc.saves, acc.onTargetAgainst)}% | fouls ${acc.fouls.toFixed(1)} | poss ${(acc.poss * 100).toFixed(0)}% | stam ${acc.stam.toFixed(2)}`,
  );
  return acc;
}

const t0 = Date.now();
play('control', [], 0);
for (const k of ATTR_KEYS) if (!only || only.includes(k)) play(`+20 ${k}`, [k], 20);
if (!only || only.includes('all')) {
  play('all +8', ATTR_KEYS, 8);
  play('all -8', ATTR_KEYS, -8);
}
console.log(`${N} matches per row, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
