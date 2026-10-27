import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Match } from '../src/sim/match';
import { TeamSetup, makeTeam } from '../src/data/generator';
import { ATTR_KEYS, AttrKey } from '../src/data/player';
import { cloneTactics } from '../src/tactics/instructions';

/** Headless check that player attributes change what happens on the pitch. */

// 60 matches per side: fewer and match-to-match noise swamps the smaller effects.
const N = 60;

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
      const gk = p.positions[0] === 'GK';
      for (const k of keys) if (keys.length > 1 || (k === 'goalkeeping') === gk) attrs[k] = Math.max(1, Math.min(99, attrs[k] + by));
      // Skills are tested separately; keep them out so only the attribute changes.
      return { ...p, attrs, skills: [] };
    }),
  };
}

interface Totals {
  gd: number;
  goals: number;
  shots: number;
  passes: number;
  passesOk: number;
  tackles: number;
  tacklesWon: number;
  aerials: number;
  aerialsLost: number;
  saves: number;
  onTargetAgainst: number;
  interceptions: number;
  oppPasses: number;
}

const cache = new Map<string, Totals>();

function play(keys: readonly AttrKey[], by: number): Totals {
  const key = `${keys.join(',')}:${by}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [home, away] = teams();
  const t: Totals = { gd: 0, goals: 0, shots: 0, passes: 0, passesOk: 0, tackles: 0, tacklesWon: 0, aerials: 0, aerialsLost: 0, saves: 0, onTargetAgainst: 0, interceptions: 0, oppPasses: 0 };
  for (let i = 0; i < N; i++) {
    const m = new Match(boosted(home, keys, by), boosted(away, [], 0), 500 + i);
    m.simulateFull();
    const [s, o] = m.stats;
    t.gd += m.score[0] - m.score[1];
    t.goals += m.score[0];
    t.shots += s.shots;
    t.passes += s.passes;
    t.passesOk += s.passesCompleted;
    t.tackles += s.tackles;
    t.tacklesWon += s.tacklesWon;
    t.interceptions += s.interceptions;
    t.oppPasses += o.passes;
    t.onTargetAgainst += o.shotsOnTarget;
    for (const p of m.players) {
      if (p.team === 0) {
        t.aerials += p.ps.aerialsWon;
        t.saves += p.ps.saves;
      } else t.aerialsLost += p.ps.aerialsWon;
    }
  }
  cache.set(key, t);
  return t;
}

const control = () => play([], 0);

describe('player attributes affect performance', () => {
  it('better finishers convert more of their shots', () => {
    const f = play(['finishing'], 35);
    expect(f.goals / f.shots).toBeGreaterThan((control().goals / control().shots) * 1.08);
  });

  it('better keepers save more', () => {
    const g = play(['goalkeeping'], 25);
    expect(g.saves / g.onTargetAgainst).toBeGreaterThan(control().saves / control().onTargetAgainst + 0.04);
  });

  it('better headers win more aerial duels', () => {
    const h = play(['heading'], 25);
    const c = control();
    expect(h.aerials / (h.aerials + h.aerialsLost)).toBeGreaterThan(c.aerials / (c.aerials + c.aerialsLost) + 0.06);
  });

  it('better tacklers win more of their tackles', () => {
    const t = play(['tackling'], 25);
    expect(t.tacklesWon / t.tackles).toBeGreaterThan(control().tacklesWon / control().tackles + 0.06);
  });

  it('better passers complete more passes', () => {
    const p = play(['passing'], 25);
    expect(p.passesOk / p.passes).toBeGreaterThan(control().passesOk / control().passes + 0.02);
  });

  it('better positioning reads more passes', () => {
    const p = play(['positioning'], 25);
    expect(p.interceptions / p.oppPasses).toBeGreaterThan((control().interceptions / control().oppPasses) * 1.03);
  });

  it('a better team wins', () => {
    expect(play(ATTR_KEYS, 8).gd / N).toBeGreaterThan(control().gd / N + 1);
    expect(play(ATTR_KEYS, -8).gd / N).toBeLessThan(control().gd / N - 1);
  });
});
