/** Traces what happens to long passes for a team using a given directness. */
import { Match } from '../src/sim/match';
import { Rng } from '../src/sim/rng';
import { makeTeam } from '../src/data/generator';

const directness = Number(process.argv[2] ?? 1);
const c: Record<string, number> = {};
const bump = (k: string) => (c[k] = (c[k] ?? 0) + 1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = Match.prototype as any;
let pending: { team: number; from: string } | null = null;
const oPass = proto.pass;
proto.pass = function (this: Match, p: any, m: any, aim: any, lofted: boolean, cross: boolean) {
  if (p.team === 0 && lofted && !cross) {
    const u = aim.x / 105;
    pending = { team: 0, from: p.slot <= 4 ? 'def' : p.slot <= 8 ? 'mid' : 'fwd' };
    bump(`long from ${pending.from} -> ${m.action === 'run' ? 'runner' : 'feet'} aimU ${u.toFixed(1)}`);
  } else pending = null;
  return oPass.call(this, p, m, aim, lofted, cross);
};
const oDuel = proto.aerialDuel;
proto.aerialDuel = function (this: Match, att: any) {
  const r = oDuel.call(this, att);
  if (pending) bump(`  aerial: ${this.ball.owner !== null && this.players[this.ball.owner].team === 0 ? 'won' : this.ball.shot ? 'header shot' : 'lost/loose'}`);
  pending = null;
  return r;
};
const oSet = proto.setOwner;
proto.setOwner = function (this: Match, p: any) {
  if (pending) bump(`  ground: ${p.team === 0 ? 'received' : 'intercepted'}`);
  pending = null;
  return oSet.call(this, p);
};
for (let i = 0; i < 6; i++) {
  const rng = new Rng(1234);
  const h = makeTeam(rng, 'H', 'H', '#f00', 65);
  const a = makeTeam(rng, 'A', 'A', '#00f', 65);
  h.tactics.team.directness = directness;
  new Match(h, a, 1000 + i).simulateFull();
}
for (const k of Object.keys(c).sort()) console.log(k.padEnd(40), (c[k] / 6).toFixed(1));
