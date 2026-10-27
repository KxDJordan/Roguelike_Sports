import { h } from './dom';
import { tacticsScreen } from './tacticsScreen';
import * as C from '../sim/constants';
import { Match } from '../sim/match';
import type { MatchEvent, TeamStats } from '../sim/stats';
import type { TeamSetup } from '../data/generator';
import { CameraMode, PitchRenderer, freshFx } from '../render/pitchRenderer';
import { WEATHER, Weather, windLabel } from '../sim/weather';
import { sound } from '../audio/sound';
import { skillIcon } from './skillIcons';
import type { Fx } from '../sim/stats';

const SPEEDS = [1, 2, 4, 8];
const CAM_KEY = 'rs.camera';

const ICON: Partial<Record<MatchEvent['type'], string>> = {
  goal: '⚽',
  save: '🧤',
  miss: '↗',
  yellow: '🟨',
  red: '🟥',
  penalty: '❗',
  sub: '🔁',
  halftime: '⏸',
  fulltime: '🏁',
  skill: '✨',
};

export interface MatchScreenOptions {
  home: TeamSetup;
  away: TeamSetup;
  seed: number;
  weather?: Weather;
  onExit: (m: Match) => void;
}

export function matchScreen(opts: MatchScreenOptions): { el: HTMLElement; destroy: () => void } {
  const weather = opts.weather ?? WEATHER.clear;
  const match = new Match(opts.home, opts.away, opts.seed, weather);
  match.aiTeams = [1];
  let speedIdx = 1;
  let paused = false;
  let raf = 0;
  let acc = 0;
  let last = performance.now();
  let seenEvents = 0;
  let overlayOpen = false;
  let fxHeard = 0;

  const canvas = h('canvas', { class: 'pitch' });
  const scoreH = h('b', { class: 'sb-score' }, '0');
  const scoreA = h('b', { class: 'sb-score' }, '0');
  const clockEl = h('div', { class: 'sb-clock' }, "1'");
  const possH = h('i', { class: 'poss-h', style: { background: opts.home.color } });
  const ticker = h('div', { class: 'ticker' });
  const banner = h('div', { class: 'goal-banner' });
  const pauseBtn = h('button', { class: 'ctl', onclick: () => setPaused(!paused) });
  const speedBtn = h('button', { class: 'ctl', onclick: () => ((speedIdx = (speedIdx + 1) % SPEEDS.length), syncButtons()) });
  const camBtn = h('button', { class: 'ctl', onclick: () => toggleCamera() });
  const intentBtn = h('button', {
    class: 'ctl',
    onclick: () => {
      renderer.showIntent = !renderer.showIntent;
      syncButtons();
    },
  });
  const muteBtn = h('button', {
    class: 'ctl',
    onclick: () => {
      sound.unlock();
      sound.setMuted(!sound.muted);
      syncButtons();
    },
  });
  const layer = h('div', { class: 'layer' });

  const el = h(
    'div',
    { class: 'screen match' },
    canvas,
    h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'scorebug' },
        h('div', { class: 'sb-team' }, h('i', { class: 'sb-kit', style: { background: opts.home.color } }), h('span', {}, opts.home.short)),
        h('div', { class: 'sb-scores' }, scoreH, h('span', { class: 'sb-dash' }), scoreA),
        h('div', { class: 'sb-team away' }, h('span', {}, opts.away.short), h('i', { class: 'sb-kit', style: { background: opts.away.color } })),
        clockEl,
        h('div', { class: 'sb-weather', title: weather.tip }, weather.icon, h('span', {}, [weather.name, windLabel(weather)].filter(Boolean).join(' · '))),
      ),
      h('div', { class: 'poss', style: { background: opts.away.color } }, possH),
      ticker,
    ),
    banner,
    h(
      'div',
      { class: 'controls' },
      pauseBtn,
      speedBtn,
      camBtn,
      h('button', { class: 'ctl', onclick: () => openTactics() }, h('span', { class: 'ico' }, '⚙'), h('span', {}, 'Tactics')),
      h('button', { class: 'ctl', onclick: () => openStats('Match stats', [h('button', { class: 'primary', onclick: closeOverlay }, 'Resume')]) }, h('span', { class: 'ico' }, '📊'), h('span', {}, 'Stats')),
      intentBtn,
      muteBtn,
    ),
    layer,
  );

  const renderer = new PitchRenderer(canvas);
  try {
    renderer.camera = (localStorage.getItem(CAM_KEY) as CameraMode) || 'full';
  } catch {
    // Storage unavailable: default camera.
  }
  renderer.weather = weather;
  renderer.onLightning = () => sound.thunder();
  sound.startMatch(weather);

  /** Turn new sim effects and events into sound, and let the crowd follow the danger. */
  function playAudio(): void {
    for (const f of freshFx(match, fxHeard)) playFx(f);
    fxHeard = match.fxTotal;
    const b = match.ball.pos;
    const toGoal = Math.min(b.x, C.PITCH_L - b.x);
    sound.excitement(match.phase === 'play' ? clamp01(1 - (toGoal - 6) / 30) : 0.2);
  }

  function playFx(f: Fx): void {
    switch (f.type) {
      case 'pass':
        return sound.kick(Math.min(1, Math.hypot((f.tx ?? f.x) - f.x, (f.ty ?? f.y) - f.y) / 45) * 0.6);
      case 'shot':
        return sound.kick(1);
      case 'header':
        return sound.header();
      case 'tackle':
        return sound.tackle();
      case 'block':
        return sound.block();
      case 'save':
        return sound.save();
      case 'goal':
        sound.goal(f.team === 0);
        return sound.whistle(1);
      case 'foul':
        return sound.whistle(1);
      case 'card':
        return sound.card(!!f.red);
      case 'skill':
        return sound.skill();
      case 'whistle':
        return sound.whistle(match.phase === 'fulltime' ? 3 : 2, true);
    }
  }

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  requestAnimationFrame(onResize);

  function toggleCamera(): void {
    renderer.camera = renderer.camera === 'full' ? 'follow' : 'full';
    try {
      localStorage.setItem(CAM_KEY, renderer.camera);
    } catch {
      // Not persisted.
    }
    syncButtons();
  }

  function syncButtons(): void {
    pauseBtn.replaceChildren(h('span', { class: 'ico' }, paused ? '▶' : '❚❚'), h('span', {}, paused ? 'Play' : 'Pause'));
    speedBtn.replaceChildren(h('span', { class: 'ico' }, '⏩'), h('span', {}, `${SPEEDS[speedIdx]}x`));
    camBtn.replaceChildren(h('span', { class: 'ico' }, '🎥'), h('span', {}, renderer.camera === 'full' ? 'Wide' : 'Follow'));
    intentBtn.replaceChildren(h('span', { class: 'ico' }, '➶'), h('span', {}, 'Runs'));
    intentBtn.classList.toggle('on', renderer.showIntent);
    muteBtn.replaceChildren(h('span', { class: 'ico' }, sound.muted ? '🔇' : '🔊'), h('span', {}, sound.muted ? 'Muted' : 'Sound'));
  }

  function setPaused(v: boolean): void {
    paused = v;
    syncButtons();
  }

  function showGoal(e: MatchEvent): void {
    const team = e.team === 0 ? opts.home : opts.away;
    const scorer = e.text.replace(/^GOAL!\s*/, '').split(' · ')[0];
    banner.replaceChildren(h('div', { class: 'gb-inner', style: { '--team': team.color } as unknown as Partial<CSSStyleDeclaration> }, h('b', {}, 'GOAL!'), h('span', {}, scorer), h('small', {}, team.name)));
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function updateHud(): void {
    scoreH.textContent = String(match.score[0]);
    scoreA.textContent = String(match.score[1]);
    clockEl.textContent = match.phase === 'halftime' ? 'HT' : match.phase === 'fulltime' ? 'FT' : `${match.minute}'`;
    const [a, b] = match.stats;
    const tot = a.possessionTicks + b.possessionTicks || 1;
    possH.style.width = `${(a.possessionTicks / tot) * 100}%`;
    if (match.events.length > seenEvents) {
      for (const e of match.events.slice(seenEvents)) {
        if (e.type === 'miss') sound.ooh(0.8);
        if (e.type === 'kickoff') {
          sound.whistle(1);
          continue;
        }
        if (e.type === 'goal') showGoal(e);
        const color = e.team === 0 ? opts.home.color : opts.away.color;
        const row = h('div', { class: `ev ev-${e.type}`, style: { borderLeftColor: color } }, h('span', { class: 'ev-ico' }, e.skill ? skillIcon(e.skill) : ICON[e.type] ?? '•'), h('span', { class: 'ev-min' }, `${e.minute}'`), h('span', {}, e.text));
        ticker.prepend(row);
        setTimeout(() => row.classList.add('fade'), 4200);
        setTimeout(() => row.remove(), 5200);
      }
      seenEvents = match.events.length;
      while (ticker.children.length > 3) ticker.lastChild!.remove();
    }
  }

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !overlayOpen) {
      acc += dt * SPEEDS[speedIdx];
      while (acc >= C.TICK) {
        match.step();
        acc -= C.TICK;
        if (match.phase === 'halftime' || match.phase === 'fulltime') {
          acc = 0;
          updateHud();
          // Let the final whistle breathe before the overlay.
          setTimeout(onBreak, 900);
          overlayOpen = true;
          break;
        }
      }
    }
    renderer.render(match, overlayOpen || paused ? 1 : acc / C.TICK);
    playAudio();
    updateHud();
    raf = requestAnimationFrame(frame);
  }

  function onBreak(): void {
    if (match.phase === 'halftime') {
      openStats('Half-time', [
        h('button', { onclick: () => openTactics() }, 'Tactics'),
        h(
          'button',
          {
            class: 'primary',
            onclick: () => {
              match.startSecondHalf();
              closeOverlay();
            },
          },
          'Second half',
        ),
      ]);
    } else {
      openStats('Full-time', [h('button', { class: 'primary', onclick: () => opts.onExit(match) }, 'Continue')]);
    }
  }

  function closeOverlay(): void {
    layer.replaceChildren();
    overlayOpen = false;
    last = performance.now();
  }

  function openStats(title: string, actions: HTMLElement[]): void {
    overlayOpen = true;
    layer.replaceChildren(
      h(
        'div',
        { class: 'modal pop-in' },
        h('div', { class: 'modal-kicker' }, title),
        h(
          'div',
          { class: 'big-score' },
          h('span', { class: 'bs-team' }, h('i', { class: 'sb-kit', style: { background: opts.home.color } }), opts.home.short),
          h('b', {}, `${match.score[0]} – ${match.score[1]}`),
          h('span', { class: 'bs-team' }, opts.away.short, h('i', { class: 'sb-kit', style: { background: opts.away.color } })),
        ),
        eventList(match),
        statsTable(match),
        h('div', { class: 'actions' }, ...actions),
      ),
    );
  }

  function openTactics(): void {
    const resumeTo = match.phase;
    overlayOpen = true;
    const back = () => {
      if (resumeTo === 'halftime') onBreak();
      else closeOverlay();
    };
    layer.replaceChildren(
      h(
        'div',
        { class: 'modal full' },
        tacticsScreen({
          team: opts.home,
          tactics: opts.home.tactics,
          title: 'Tactics',
          subtitle: `${match.minute}' · ${opts.home.short} ${match.score[0]}-${match.score[1]} ${opts.away.short}`,
          confirmLabel: 'Apply',
          match,
          side: 0,
          onConfirm: (t) => {
            match.applyTactics(0, t);
            back();
          },
          onCancel: back,
        }),
      ),
    );
  }

  syncButtons();
  raf = requestAnimationFrame(frame);
  return {
    el,
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      sound.stopMatch();
    },
  };
}

function statsTable(m: Match): HTMLElement {
  const [a, b] = m.stats;
  const totalPoss = a.possessionTicks + b.possessionTicks || 1;
  const pct = (s: TeamStats) => Math.round((s.possessionTicks / totalPoss) * 100);
  const passPct = (s: TeamStats) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
  const rows: [string, number, number, string?, string?][] = [
    ['Possession', pct(a), pct(b), `${pct(a)}%`, `${pct(b)}%`],
    ['Shots (on target)', a.shots, b.shots, `${a.shots} (${a.shotsOnTarget})`, `${b.shots} (${b.shotsOnTarget})`],
    ['Expected goals', a.xg, b.xg, a.xg.toFixed(2), b.xg.toFixed(2)],
    ['Passes', a.passes, b.passes, `${a.passes} · ${passPct(a)}%`, `${b.passes} · ${passPct(b)}%`],
    ['Crosses', a.crosses, b.crosses],
    ['Corners', a.corners, b.corners],
    ['Tackles won', a.tacklesWon, b.tacklesWon, `${a.tacklesWon}/${a.tackles}`, `${b.tacklesWon}/${b.tackles}`],
    ['Interceptions', a.interceptions, b.interceptions],
    ['Blocks', a.blocks, b.blocks],
    ['Skills used', a.skills, b.skills],
    ['High turnovers', a.highTurnovers, b.highTurnovers],
    ['Fouls', a.fouls, b.fouls],
    ['Cards', a.yellows + a.reds, b.yellows + b.reds, `${a.yellows}🟨 ${a.reds}🟥`, `${b.yellows}🟨 ${b.reds}🟥`],
  ];
  return h(
    'div',
    { class: 'stats' },
    ...rows.map(([label, x, y, lx, ly]) => {
      const tot = x + y || 1;
      return h(
        'div',
        { class: 'stat' },
        h('span', { class: 'v' }, lx ?? x),
        h(
          'div',
          { class: 'mid' },
          h('span', {}, label),
          h('div', { class: 'bars' }, h('i', { style: { width: `${(x / tot) * 100}%`, background: m.teams[0].color } }), h('i', { style: { width: `${(y / tot) * 100}%`, background: m.teams[1].color } })),
        ),
        h('span', { class: 'v' }, ly ?? y),
      );
    }),
  );
}

function eventList(m: Match): HTMLElement {
  const key = m.events.filter((e) => e.type === 'goal' || e.type === 'red' || e.type === 'penalty' || e.type === 'sub' || e.type === 'yellow');
  return h(
    'div',
    { class: 'events' },
    ...key.map((e) => h('div', { class: `ev ev-${e.type} side-${e.team}` }, h('span', { class: 'ev-ico' }, e.skill ? skillIcon(e.skill) : ICON[e.type] ?? '•'), h('span', { class: 'ev-min' }, `${e.minute}'`), h('span', {}, e.text))),
  );
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
