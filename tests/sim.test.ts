import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Match } from '../src/sim/match';
import { formationTarget, toU, toV } from '../src/sim/positioning';
import { makeTeam, TeamSetup } from '../src/data/generator';
import { FORMATIONS } from '../src/tactics/formations';
import { ROLES } from '../src/tactics/roles';
import { cloneTactics, defaultPlayerInstructions, defaultTeamInstructions } from '../src/tactics/instructions';
import { AIR_K, PITCH_L, PITCH_W, kickSpeed } from '../src/sim/constants';
import { WEATHER, Weather } from '../src/sim/weather';
import { freshFx } from '../src/render/pitchRenderer';

function teams(seed = 42): [TeamSetup, TeamSetup] {
  const rng = new Rng(seed);
  return [makeTeam(rng, 'Home', 'HOM', '#f00', 65), makeTeam(rng, 'Away', 'AWY', '#00f', 65)];
}

const copy = (t: TeamSetup): TeamSetup => ({ ...t, tactics: cloneTactics(t.tactics) });

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(new Rng(8).next()).not.toEqual(xs[0]);
  });
});

describe('positioning', () => {
  const slot = FORMATIONS['4-3-3'].slots[9]; // ST
  const center = { x: PITCH_L / 2, y: PITCH_W / 2 };
  const base = { ball: center, ti: defaultTeamInstructions() };
  const instr = defaultPlayerInstructions();

  it('mirrors between the two teams', () => {
    const a = formationTarget(0, slot, ROLES.af, instr, { ...base, inPossession: true });
    const b = formationTarget(1, slot, ROLES.af, instr, { ...base, inPossession: true });
    expect(toU(0, a.x)).toBeCloseTo(toU(1, b.x));
    expect(toV(0, a.y)).toBeCloseTo(toV(1, b.y));
  });

  it('drops a false nine deeper than an advanced forward', () => {
    const af = formationTarget(0, slot, ROLES.af, instr, { ...base, inPossession: true });
    const f9 = formationTarget(0, slot, ROLES.f9, instr, { ...base, inPossession: true });
    expect(f9.x).toBeLessThan(af.x);
  });

  it('pushes the block up with a high line', () => {
    const cb = FORMATIONS['4-3-3'].slots[2];
    const deep = formationTarget(0, cb, ROLES.cd, instr, { ...base, inPossession: false, ti: { ...base.ti, lineHeight: -1 } });
    const high = formationTarget(0, cb, ROLES.cd, instr, { ...base, inPossession: false, ti: { ...base.ti, lineHeight: 1 } });
    expect(high.x).toBeGreaterThan(deep.x + 5);
  });

  it('leaves a poacher up front when defending but brings a pressing forward back', () => {
    const def = { ...base, inPossession: false };
    const pch = formationTarget(0, slot, ROLES.pch, instr, def);
    const pf = formationTarget(0, slot, ROLES.pf, instr, def);
    expect(pch.x).toBeGreaterThan(pf.x + 10);
  });

  it('keeps the defensive block spread across the pitch', () => {
    const form = FORMATIONS['4-4-2'];
    const ys = form.slots.slice(1).map((s) =>
      formationTarget(0, s, ROLES.cm, instr, { ...base, inPossession: false }).y,
    );
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(PITCH_W * 0.65);
  });
});

describe('ball physics', () => {
  it('drives a 40 m long ball there in under 2.5 seconds', () => {
    const v0 = kickSpeed(40, true);
    const t = -Math.log(1 - (AIR_K * 40) / v0) / AIR_K;
    expect(t).toBeLessThan(2.5);
  });
});

describe('match', () => {
  it('replays identically from the same seed', () => {
    const [h, a] = teams();
    const m1 = new Match(copy(h), copy(a), 99);
    const m2 = new Match(copy(h), copy(a), 99);
    m1.simulateFull();
    m2.simulateFull();
    expect(m1.score).toEqual(m2.score);
    expect(m1.events).toEqual(m2.events);
    expect(m1.stats).toEqual(m2.stats);
  });

  it('plays a full match with sane numbers', () => {
    const [h, a] = teams();
    const m = new Match(copy(h), copy(a), 5);
    m.simulateFull();
    expect(m.phase).toBe('fulltime');
    const total = m.stats[0].passes + m.stats[1].passes;
    expect(total).toBeGreaterThan(100);
    expect(m.stats[0].shots + m.stats[1].shots).toBeGreaterThan(2);
  });

  it('applies substitutions mid-match', () => {
    const [h, a] = teams();
    const m = new Match(copy(h), copy(a), 3);
    m.runToBreak();
    const next = cloneTactics(m.tactics(0));
    const benchId = h.squad.find((p) => !next.lineup.includes(p.id))!.id;
    // Replace the last starter still on the pitch (a sent-off player can't be substituted).
    let slot = 10;
    while (!m.onPitch.some((p) => p.data.id === next.lineup[slot])) slot--;
    const outId = next.lineup[slot];
    next.lineup[slot] = benchId;
    m.applyTactics(0, next);
    const active = m.onPitch.filter((p) => p.team === 0).map((p) => p.data.id);
    expect(active).toContain(benchId);
    expect(active).not.toContain(outId);
    expect(m.subsUsed[0]).toBe(1);
  });
});

describe('tactics change behaviour (headless batch)', () => {
  const N = 12;
  function avg(tweak: Partial<ReturnType<typeof defaultTeamInstructions>>) {
    const [h, a] = teams(1234);
    const out = { fouls: 0, highTurnovers: 0, crosses: 0, shots: 0, stamina: 0 };
    for (let i = 0; i < N; i++) {
      const home = copy(h);
      Object.assign(home.tactics.team, tweak);
      const m = new Match(home, copy(a), 500 + i);
      m.simulateFull();
      const s = m.stats[0];
      out.fouls += s.fouls / N;
      out.highTurnovers += s.highTurnovers / N;
      out.crosses += s.crosses / N;
      out.shots += s.shots / N;
      const outfield = m.onPitch.filter((p) => p.team === 0 && !p.isGK);
      out.stamina += outfield.reduce((x, p) => x + p.stamina, 0) / outfield.length / N;
    }
    return out;
  }

  it('aggressive tackling commits more fouls', () => {
    expect(avg({ tackling: 1 }).fouls).toBeGreaterThan(avg({ tackling: -1 }).fouls * 1.5);
  });

  it('high pressing wins the ball higher and tires players', () => {
    const hi = avg({ pressing: 1 });
    const lo = avg({ pressing: -1 });
    expect(hi.highTurnovers).toBeGreaterThan(lo.highTurnovers);
    expect(hi.stamina).toBeLessThan(lo.stamina);
  });

  it('wide play produces more crosses than narrow play', () => {
    expect(avg({ width: 1 }).crosses).toBeGreaterThan(avg({ width: -1 }).crosses);
  });

  it('attacking mentality shoots more than defensive', () => {
    expect(avg({ mentality: 2 }).shots).toBeGreaterThan(avg({ mentality: -2 }).shots);
  });
});

describe('weather', () => {
  function play(weather: Weather, n = 6) {
    const out = { stamina: 0, passes: 0, passesOk: 0 };
    for (let i = 0; i < n; i++) {
      const [h, a] = teams(77);
      // Skills are tested separately; strip them so only the weather differs.
      const bare = (t: TeamSetup) => ({ ...copy(t), squad: t.squad.map((p) => ({ ...p, skills: [] })) });
      const m = new Match(bare(h), bare(a), 300 + i, weather);
      m.simulateFull();
      const outfield = m.onPitch.filter((p) => !p.isGK);
      out.stamina += outfield.reduce((s, p) => s + p.stamina, 0) / outfield.length / n;
      for (const s of m.stats) {
        out.passes += s.passes;
        out.passesOk += s.passesCompleted;
      }
    }
    return out;
  }

  it('heat tires players and rain spoils passing', () => {
    const clear = play(WEATHER.clear);
    expect(play(WEATHER.heat).stamina).toBeLessThan(clear.stamina - 0.08);
    const rain = play(WEATHER.rain);
    expect(rain.passesOk / rain.passes).toBeLessThan(clear.passesOk / clear.passes - 0.03);
  });

  it('wind blows a ball in the air off its line', () => {
    const [h, a] = teams();
    const m = new Match(copy(h), copy(a), 5, { ...WEATHER.wind, wind: { x: 0, y: 4 } });
    m.ball.owner = null;
    m.ball.pos = { x: 30, y: 34 };
    m.ball.vel = { x: 20, y: 0 };
    m.ball.lofted = true;
    m.ball.loftFrom = { x: 30, y: 34 };
    m.ball.loftDist = 40;
    m.phase = 'play';
    for (let i = 0; i < 20; i++) (m as unknown as { updateBall(): void }).updateBall();
    expect(m.ball.pos.y).toBeGreaterThan(35.5);
  });
});

describe('effects feed', () => {
  it('keeps delivering new effects after the buffer is trimmed', () => {
    const [h, a] = teams();
    const m = new Match(copy(h), copy(a), 8);
    let seen = 0;
    let delivered = 0;
    while (!m.isFinished()) {
      if (m.phase === 'halftime') m.startSecondHalf();
      m.step();
      delivered += freshFx(m, seen).length;
      seen = m.fxTotal;
    }
    expect(m.fxTotal).toBeGreaterThan(250);
    expect(delivered).toBe(m.fxTotal);
  });
});
