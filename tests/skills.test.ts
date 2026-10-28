import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Match } from '../src/sim/match';
import { TeamSetup, makePlayerAt, makeTeam } from '../src/data/generator';
import { SLOT_GROUP, SlotPos } from '../src/data/player';
import { SKILLS, SKILL_SLOTS, SkillId, grantSkills, migrateSkills, seededRand } from '../src/data/skills';
import { cloneTactics } from '../src/tactics/instructions';

describe('skill generation', () => {
  it('gives more skills to rarer players, all suited to their position', () => {
    const rng = new Rng(9);
    const positions: SlotPos[] = ['GK', 'CB', 'LB', 'CM', 'LW', 'ST'];
    for (const target of [50, 64, 74, 84]) {
      for (const pos of positions) {
        const p = makePlayerAt(rng, [pos], target, 7);
        expect(p.skills.length).toBe(SKILL_SLOTS[p.rarity]);
        expect(new Set(p.skills).size).toBe(p.skills.length);
        for (const id of p.skills) {
          expect(SKILLS[id].groups).toContain(SLOT_GROUP[pos]);
          if (SKILLS[id].slots) expect(SKILLS[id].slots).toContain(pos);
        }
      }
    }
  });

  it('learns another skill on reaching a new rarity, and never loses one', () => {
    const p = makePlayerAt(new Rng(3), ['CM'], 65, 8);
    expect(p.rarity).toBe('silver');
    const before = [...p.skills];
    p.rarity = 'gold';
    const learned = grantSkills(p, Math.random);
    expect(learned).toHaveLength(1);
    expect(p.skills.slice(0, before.length)).toEqual(before);
  });

  it('gives players from older saves the same skills every time they load', () => {
    const p = makePlayerAt(new Rng(4), ['ST'], 82, 9);
    const a = { ...p, skills: [] };
    const b = { ...p, skills: [] };
    grantSkills(a, seededRand(p.id));
    grantSkills(b, seededRand(p.id));
    expect(a.skills).toHaveLength(3);
    expect(a.skills).toEqual(b.skills);
  });
});

describe('skills in matches', () => {
  const copy = (t: TeamSetup, keepSkills: boolean): TeamSetup => ({
    ...t,
    tactics: cloneTactics(t.tactics),
    squad: t.squad.map((p) => ({ ...p, skills: keepSkills ? p.skills : [] })),
  });

  it('fire during matches and make a skilled side better', () => {
    const rng = new Rng(2024);
    // Elite squads (3 skills each), so the effect stands well clear of match-to-match noise.
    const home = makeTeam(rng, 'Home', 'HOM', '#d64045', 83);
    const away = makeTeam(rng, 'Away', 'AWY', '#3a86ff', 83);
    let gdWith = 0;
    let gdWithout = 0;
    let callouts = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const a = new Match(copy(home, true), copy(away, false), 9000 + i);
      a.simulateFull();
      gdWith += a.score[0] - a.score[1];
      callouts += a.events.filter((e) => e.type === 'skill' && e.team === 0).length;
      const b = new Match(copy(home, false), copy(away, false), 9000 + i);
      b.simulateFull();
      gdWithout += b.score[0] - b.score[1];
      expect(b.stats[0].skills).toBe(0);
    }
    expect(callouts / N).toBeGreaterThan(5);
    expect(callouts / N).toBeLessThan(30);
    // About +1.5 goal difference for elite squads; the bar leaves room for noise.
    expect(gdWith / N).toBeGreaterThan(gdWithout / N + 0.25);
  });
});

describe('new skills and keeper resets', () => {
  it('renames Killer Pass to Precision Pass in old saves', () => {
    const p = makePlayerAt(new Rng(5), ['CM'], 75, 8);
    p.skills = ['killer_pass' as SkillId, 'tireless'];
    migrateSkills(p);
    expect(p.skills).toEqual(['precision_pass', 'tireless']);
  });

  it('bends a curved pass around the man in the lane and onto the receiver', () => {
    const rng = new Rng(1);
    const m = new Match(makeTeam(rng, 'H', 'H', '#f00', 70), makeTeam(rng, 'A', 'A', '#00f', 70), 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mm = m as any;
    m.phase = 'play';
    const passer = m.onPitch.find((q) => q.team === 0 && !q.isGK)!;
    const receiver = m.onPitch.find((q) => q.team === 0 && q !== passer && !q.isGK)!;
    const blocker = m.onPitch.find((q) => q.team === 1 && !q.isGK)!;
    for (const q of m.onPitch) q.pos = { x: 5, y: 5 + q.id };
    passer.pos = { x: 40, y: 34 };
    receiver.pos = { x: 60, y: 34 };
    blocker.pos = { x: 50, y: 34.8 };
    passer.skills = new Set(['curve_pass']);
    receiver.skills = new Set(['first_touch']);
    mm.ball.owner = passer.id;
    mm.ball.pos = { ...passer.pos };
    mm.rng.chance = () => true;
    mm.rng.gauss = () => 0;
    mm.pass(passer, receiver, { x: 60, y: 34 }, false, false);
    let passingBlocker = 0;
    for (let i = 0; i < 60 && m.ball.owner === null; i++) {
      mm.updateBall();
      if (Math.abs(m.ball.pos.x - 50) < 1) passingBlocker = m.ball.pos.y;
    }
    // It swung out on the far side of the defender, then arrived at the receiver's feet.
    expect(passingBlocker).toBeLessThan(33);
    expect(m.ball.owner).toBe(receiver.id);
  });

  it('lets a keeper who wins the ball hold it while everyone resets', () => {
    let gathers = 0;
    let challenged = 0;
    let nearSum = 0;
    for (let s = 0; s < 4; s++) {
      const rng = new Rng(s);
      const m = new Match(makeTeam(rng, 'H', 'H', '#f00', 66), makeTeam(rng, 'A', 'A', '#00f', 66), s);
      let prev: number | null = null;
      let keeper: number | null = null;
      let tackles = 0;
      while (!m.isFinished()) {
        if (m.phase === 'halftime') m.startSecondHalf();
        const before = m.stats[0].tackles + m.stats[1].tackles;
        m.step();
        const o = m.ball.owner;
        if (keeper !== null && o === keeper) tackles += m.stats[0].tackles + m.stats[1].tackles - before;
        if (o !== prev && o !== null && m.players[o].isGK && (prev === null || m.players[prev].team !== m.players[o].team)) {
          gathers++;
          keeper = o;
          tackles = 0;
        }
        if (keeper !== null && prev === keeper && o !== keeper) {
          const kp = m.players[keeper];
          nearSum += Math.min(...m.onPitch.filter((q) => q.team !== kp.team && !q.isGK).map((q) => Math.hypot(q.pos.x - kp.pos.x, q.pos.y - kp.pos.y)));
          challenged += tackles;
          keeper = null;
        }
        prev = o;
      }
    }
    expect(gathers).toBeGreaterThan(20);
    expect(challenged).toBe(0);
    expect(nearSum / gathers).toBeGreaterThan(12);
  });
});
