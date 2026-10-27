/** Counts decision and restart calls over a few matches to see where possessions go. */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';

const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = Match.prototype as any;
for (const name of ['shoot', 'startDribble', 'throwIn', 'byline', 'goalKick', 'aerialDuel', 'foul']) {
  const orig = proto[name];
  proto[name] = function (this: Match, ...args: unknown[]) {
    bump(name);
    return orig.apply(this, args);
  };
}
const origPass = proto.pass;
proto.pass = function (this: Match, ...args: unknown[]) {
  bump(args[4] ? 'cross' : args[3] ? 'passLong' : 'passShort');
  return origPass.apply(this, args);
};
const origSet = proto.setOwner;
proto.setOwner = function (this: Match, p: { team: number }) {
  const b = this.ball;
  if (b.passer !== null) bump(this.players[b.passer].team === p.team ? 'recv:mate' : 'recv:intercept');
  else if (this.phase === 'play') bump(p.team === this.possession ? 'recv:loose-own' : 'recv:loose-opp');
  return origSet.call(this, p);
};
const origRestart = proto.setRestart;
proto.setRestart = function (this: Match, type: string, ...rest: unknown[]) {
  bump('restart:' + type);
  return origRestart.call(this, type, ...rest);
};

const N = 5;
let ticksIn: number[] = [0, 0, 0];
for (let i = 0; i < N; i++) {
  const rng = new Rng(77);
  const m = new Match(makeTeam(rng, 'A', 'A', '#f00', 65), makeTeam(rng, 'B', 'B', '#00f', 65), i + 1);
  const origStep = m.step.bind(m);
  m.step = () => {
    if (m.ball.owner !== null) {
      const o = m.players[m.ball.owner];
      const u = o.team === 0 ? o.pos.x / 105 : 1 - o.pos.x / 105;
      ticksIn[u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2]++;
    }
    origStep();
  };
  m.simulateFull();
}
for (const k of Object.keys(counts).sort()) console.log(k.padEnd(20), (counts[k] / N / 2).toFixed(1), 'per team-match');
const tot = ticksIn.reduce((a, b) => a + b, 0);
console.log('carrier in own/mid/final third %', ticksIn.map((x) => ((x / tot) * 100).toFixed(0)).join(' / '));
ticksIn = [];
