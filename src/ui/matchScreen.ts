import { h } from './dom';
import { tacticsScreen } from './tacticsScreen';
import * as C from '../sim/constants';
import { Match } from '../sim/match';
import type { MatchEvent, TeamStats } from '../sim/stats';
import type { TeamSetup } from '../data/generator';
import { CameraMode, PitchRenderer, freshFx } from '../render/pitchRenderer';
import { ReplayRecorder, ReplayView } from '../render/replay';
import { inkFor } from '../data/kits';
import { WEATHER, Weather, windLabel } from '../sim/weather';
import { sound } from '../audio/sound';
import { skillIcon } from './skillIcons';
import type { Fx } from '../sim/stats';

/** Speed settings as shown on the button; the sim runs BASE_SPEED times faster than the label. */
const SPEEDS = [1, 2, 4, 8];
const BASE_SPEED = 2;
const CAM_KEY = 'rs.camera';
/** How long the GOAL cut-in shows, and how much of the build-up the replay covers (sim seconds). */
const CUTIN_SECONDS = 2.4;
const REPLAY_SECONDS = 5;
/** Replay letterbox bars, as a fraction of the pitch height (matches .rp-bar in style.css). */
const LETTERBOX = 0.07;

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
  let speedIdx = 0;
  let paused = false;
  let raf = 0;
  let acc = 0;
  let last = performance.now();
  let seenEvents = 0;
  let overlayOpen = false;
  let fxHeard = 0;
  let fxRecorded = 0;
  const recorder = new ReplayRecorder(REPLAY_SECONDS + 1);

  const canvas = h('canvas', { class: 'pitch' });
  const scoreH = h('b', { class: 'sb-score' }, '0');
  const scoreA = h('b', { class: 'sb-score' }, '0');
  const clockEl = h('div', { class: 'sb-clock' }, "1'");
  const possH = h('i', { class: 'poss-h', style: { background: opts.home.color } });
  const ticker = h('div', { class: 'ticker' });
  const banner = h('div', { class: 'goal-banner' });
  const confettiEl = h('div', { class: 'confetti' });
  const replayUi = h(
    'div',
    { class: 'replay-ui' },
    h('i', { class: 'rp-bar top' }),
    h('i', { class: 'rp-bar bottom' }),
    h('div', { class: 'rp-badge' }, h('i', { class: 'rp-dot' }), 'REPLAY'),
    h('button', { class: 'rp-skip', onclick: (e: Event) => (e.stopPropagation(), skipCelebration()) }, 'Skip ›'),
  );
  // The pitch and everything drawn over it (goal cut-in, confetti, replay chrome).
  const stage = h('div', { class: 'stage', onclick: () => skipCelebration() }, canvas, banner, confettiEl, replayUi);
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
    stage,
    h(
      'div',
      { class: 'controls' },
      pauseBtn,
      speedBtn,
      camBtn,
      h('button', { class: 'ctl', onclick: () => openTactics() }, h('span', { class: 'ico' }, '⚙'), h('span', {}, 'Tactics')),
      h('button', { class: 'ctl', onclick: () => openStats('Match stats', [h('button', { class: 'primary', onclick: closeOverlay }, 'Resume')], 'stats') }, h('span', { class: 'ico' }, '📊'), h('span', {}, 'Stats')),
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

  // Refit whenever the canvas box changes: window resizes, rotation, or the score bar settling
  // its height once the web fonts load.
  const resizer = new ResizeObserver(() => renderer.resize());
  resizer.observe(canvas);

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

  // ---------------------------------------------------------------- goal celebration

  /**
   * A goal pauses the match for a broadcast-style celebration: a big GOAL cut-in with confetti,
   * then a slow-motion replay of the move, then play carries on. A tap skips ahead.
   */
  let celebration: { stage: 'cutin' | 'replay'; t: number; view: ReplayView | null; rt: number; hold: number; heard: number; camera: CameraMode; intent: boolean } | null = null;

  function startCelebration(): void {
    const e = [...match.events].reverse().find((x) => x.type === 'goal');
    if (!e) return;
    celebration = { stage: 'cutin', t: 0, view: null, rt: 0, hold: 0, heard: 0, camera: renderer.camera, intent: renderer.showIntent };
    showCutIn(e);
    sound.excitement(1);
  }

  function showCutIn(e: MatchEvent): void {
    const team = e.team === 0 ? opts.home : opts.away;
    const [who, score] = e.text.replace(/^GOAL!\s*/, '').split(' · ');
    const [scorer, assist] = who.split(' (assist ');
    const vars = { '--team': team.color, '--ink': inkFor(team.color) } as unknown as Partial<CSSStyleDeclaration>;
    banner.replaceChildren(
      h(
        'div',
        { class: 'cutin', style: vars },
        h('div', { class: 'ci-band' }),
        h('div', { class: 'ci-word' }, ...'GOAL!'.split('').map((ch, i) => h('span', { style: { '--i': String(i) } as unknown as Partial<CSSStyleDeclaration> }, ch))),
        h(
          'div',
          { class: 'ci-info' },
          h('b', {}, scorer),
          h('small', {}, [assist ? `Assist ${assist.replace(/\)$/, '')}` : null, `${e.minute}'`, score].filter(Boolean).join('  ·  ')),
        ),
      ),
    );
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    burstConfetti([team.color, team.color, '#ffd60a', '#ffffff', shadeHex(team.color)]);
  }

  /** Paper confetti raining down over the pitch (DOM, so it sits above the canvas cut-in). */
  function burstConfetti(colors: string[]): void {
    const pieces = Array.from({ length: 90 }, () => {
      const v = (k: string, val: string | number) => [k, String(val)] as const;
      const style = Object.fromEntries([
        v('--x', `${Math.random() * 100}%`),
        v('--drift', `${(Math.random() - 0.5) * 160}px`),
        v('--spin', `${(Math.random() - 0.5) * 1440}deg`),
        v('--dur', `${2.2 + Math.random() * 1.6}s`),
        v('--delay', `${Math.random() * 0.6}s`),
        v('--c', colors[Math.floor(Math.random() * colors.length)]),
        v('--w', `${6 + Math.random() * 6}px`),
      ]);
      return h('i', { style: style as unknown as Partial<CSSStyleDeclaration> });
    });
    confettiEl.replaceChildren(...pieces);
    setTimeout(() => confettiEl.replaceChildren(), 4500);
  }

  function beginReplay(): void {
    const c = celebration!;
    // The build-up: the last few seconds of play, ending with the ball in the net.
    const clip = recorder.clip().slice(-Math.round(REPLAY_SECONDS / C.TICK));
    if (clip.length < 12) return endCelebration();
    c.stage = 'replay';
    c.view = new ReplayView(match, clip);
    banner.classList.remove('show');
    renderer.clearEffects();
    renderer.syncFx(c.view);
    renderer.camera = 'replay';
    renderer.letterbox = LETTERBOX;
    renderer.showIntent = false;
    stage.classList.add('replaying');
  }

  function endCelebration(): void {
    const c = celebration;
    if (!c) return;
    renderer.camera = c.camera;
    renderer.letterbox = 0;
    renderer.showIntent = c.intent;
    renderer.clearEffects();
    renderer.syncFx(match);
    banner.classList.remove('show');
    stage.classList.remove('replaying');
    celebration = null;
    last = performance.now();
  }

  function skipCelebration(): void {
    if (!celebration) return;
    if (celebration.stage === 'cutin') beginReplay();
    else endCelebration();
  }

  /** Advance the celebration by dt real seconds and draw it. */
  function tickCelebration(dt: number): void {
    const c = celebration!;
    c.t += dt;
    if (c.stage === 'cutin') {
      renderer.render(match, 1);
      if (c.t > CUTIN_SECONDS) beginReplay();
      return;
    }
    const view = c.view!;
    // Slow motion, slower still for the final second before the ball goes in.
    const end = (view.length - 1) * C.TICK;
    const rate = c.rt > end - 1.1 ? 0.3 : 0.6;
    c.rt = Math.min(end, c.rt + dt * rate);
    const i = Math.floor(c.rt / C.TICK);
    view.show(i + 1);
    renderer.render(view, c.rt / C.TICK - i);
    // The replay's own kicks and the roar at the end.
    for (const f of freshFx(view, c.heard)) if (f.type === 'shot' || f.type === 'header' || f.type === 'save' || f.type === 'goal' || f.type === 'pass') playFx(f);
    c.heard = view.fxTotal;
    if (c.rt >= end) {
      c.hold += dt;
      if (c.hold > 1.4) endCelebration();
    }
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

        const color = e.team === 0 ? opts.home.color : opts.away.color;
        const row = h('div', { class: `ev ev-${e.type}`, style: { borderLeftColor: color } }, h('span', { class: 'ev-ico' }, e.skill ? skillIcon(e.skill) : ICON[e.type] ?? '•'), h('span', { class: 'ev-min' }, `${e.minute}'`), h('span', {}, e.text));
        ticker.prepend(row);
        setTimeout(() => row.classList.add('fade'), 4200);
        setTimeout(() => row.remove(), 5200);
      }
      seenEvents = match.events.length;
      while (ticker.children.length > 1) ticker.lastChild!.remove();
    }
  }

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused && !overlayOpen && !celebration) {
      acc += dt * SPEEDS[speedIdx] * BASE_SPEED;
      while (acc >= C.TICK) {
        const goals = match.score[0] + match.score[1];
        match.step();
        acc -= C.TICK;
        const scored = match.score[0] + match.score[1] > goals;
        recorder.record(match, freshFx(match, fxRecorded), scored);
        fxRecorded = match.fxTotal;
        if (scored) {
          acc = 0;
          startCelebration();
          break;
        }
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
    if (celebration && !paused && !overlayOpen) tickCelebration(dt);
    else if (celebration) renderer.render(celebration.view ?? match, 1);
    else renderer.render(match, overlayOpen || paused ? 1 : acc / C.TICK);
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

  /**
   * The results window: score at the top, an Events / Stats tab bar, the chosen tab in a
   * scrolling body, and the buttons pinned at the bottom so nothing gets pushed off screen.
   */
  function openStats(title: string, actions: HTMLElement[], tab: 'events' | 'stats' = 'events'): void {
    overlayOpen = true;
    const tabs = h('div', { class: 'seg modal-tabs' });
    const body = h('div', { class: 'modal-body' });
    const show = (t: 'events' | 'stats') => {
      tab = t;
      const n = keyEvents(match).length;
      tabs.replaceChildren(
        h('button', { class: tab === 'events' ? 'on' : '', onclick: () => show('events') }, n ? `Events · ${n}` : 'Events'),
        h('button', { class: tab === 'stats' ? 'on' : '', onclick: () => show('stats') }, 'Stats'),
      );
      body.replaceChildren(tab === 'events' ? eventList(match) : statsTable(match));
      body.scrollTop = 0;
    };
    show(tab);
    layer.replaceChildren(
      h(
        'div',
        { class: 'modal results-modal pop-in' },
        h('div', { class: 'modal-kicker' }, title),
        h(
          'div',
          { class: 'big-score' },
          h('span', { class: 'bs-team' }, h('i', { class: 'sb-kit', style: { background: opts.home.color } }), opts.home.short),
          h('b', {}, `${match.score[0]} – ${match.score[1]}`),
          h('span', { class: 'bs-team' }, opts.away.short, h('i', { class: 'sb-kit', style: { background: opts.away.color } })),
        ),
        tabs,
        body,
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
      resizer.disconnect();
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

/** The events worth listing in the results window. */
function keyEvents(m: Match): MatchEvent[] {
  return m.events.filter((e) => e.type === 'goal' || e.type === 'red' || e.type === 'penalty' || e.type === 'sub' || e.type === 'yellow');
}

function eventList(m: Match): HTMLElement {
  const key = keyEvents(m);
  if (!key.length) return h('div', { class: 'events empty muted' }, 'No goals, cards or substitutions yet.');
  return h(
    'div',
    { class: 'events' },
    ...key.map((e) => h('div', { class: `ev ev-${e.type} side-${e.team}` }, h('span', { class: 'ev-ico' }, e.skill ? skillIcon(e.skill) : ICON[e.type] ?? '•'), h('span', { class: 'ev-min' }, `${e.minute}'`), h('span', {}, e.text))),
  );
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A darker shade of a #rrggbb colour, for confetti variety. */
function shadeHex(hex: string): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const d = (v: number) => Math.round(v * 0.6);
  return `rgb(${d((n >> 16) & 255)},${d((n >> 8) & 255)},${d(n & 255)})`;
}
