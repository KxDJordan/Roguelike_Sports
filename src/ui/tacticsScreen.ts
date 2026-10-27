import { h, segmented, toast, draggable } from './dom';
import * as C from '../sim/constants';
import type { Match, TeamSide } from '../sim/match';
import { formationTarget, keeperTarget, toU } from '../sim/positioning';
import { clamp } from '../sim/vec';
import type { TeamSetup } from '../data/generator';
import { SKILLS } from '../data/skills';
import { skillIcon } from './skillIcons';
import { ARCHETYPE_OF, ARCHETYPE_WEIGHTS, ATTR_KEYS, AttrKey, Player, familiarity, ratingAt } from '../data/player';
import { FORMATIONS, FORMATION_IDS } from '../tactics/formations';
import { ROLES, rolesForSlot } from '../tactics/roles';
import {
  PLAYER_INSTRUCTION_OPTIONS,
  TEAM_INSTRUCTION_OPTIONS,
  Tactics,
  cloneTactics,
  withFormation,
} from '../tactics/instructions';

export interface TacticsContext {
  team: TeamSetup;
  tactics: Tactics;
  title: string;
  subtitle?: string;
  confirmLabel: string;
  /** When editing during a match: enables the substitution limit and live stamina. */
  match?: Match;
  side?: TeamSide;
  onConfirm: (t: Tactics) => void;
  onCancel?: () => void;
}

const MAX_SUBS = 5;

const ATTR_LABEL: Record<AttrKey, string> = {
  pace: 'PAC',
  acceleration: 'ACC',
  stamina: 'STA',
  strength: 'STR',
  passing: 'PAS',
  vision: 'VIS',
  dribbling: 'DRI',
  finishing: 'FIN',
  crossing: 'CRO',
  tackling: 'TCK',
  marking: 'MRK',
  positioning: 'POS',
  heading: 'HEA',
  composure: 'CMP',
  aggression: 'AGG',
  goalkeeping: 'GK',
};

const lastName = (p: Player) => p.name.split(' ').slice(-1)[0];

export function tacticsScreen(ctx: TacticsContext): HTMLElement {
  const side = ctx.side ?? 0;
  let draft = cloneTactics(ctx.tactics);
  let selected: number | null = null;
  let shape: 'attack' | 'defend' = 'attack';
  let previewBall = { x: C.PITCH_L / 2, y: C.PITCH_W / 2 };
  const root = h('div', { class: 'screen tactics' });

  // Live match state, if any.
  const sims = ctx.match ? ctx.match.players.filter((p) => p.team === side) : [];
  const onPitch = new Set(sims.filter((p) => p.active).map((p) => p.data.id));
  const sentOff = new Set(sims.filter((p) => p.sentOff).map((p) => p.data.id));
  const subbedOff = new Set(sims.filter((p) => !p.active && !p.sentOff).map((p) => p.data.id));
  const usedSubs = ctx.match ? ctx.match.subsUsed[side] : 0;

  const player = (id: string) => ctx.team.squad.find((p) => p.id === id)!;
  const fitness = (id: string) => {
    const sim = sims.find((p) => p.data.id === id && (p.active || p.sentOff));
    return sim ? sim.stamina : player(id).condition;
  };
  const pendingSubs = () => (ctx.match ? draft.lineup.filter((id) => !onPitch.has(id) && !sentOff.has(id)).length : 0);
  const subsLeft = () => MAX_SUBS - usedSubs - pendingSubs();

  function placeInSlot(slot: number, pid: string): void {
    const from = draft.lineup.indexOf(pid);
    const out = draft.lineup[slot];
    if (sentOff.has(out) || sentOff.has(pid)) return toast('Sent-off players cannot be moved');
    if (from >= 0) {
      draft.lineup[from] = out;
      draft.lineup[slot] = pid;
    } else {
      if (subbedOff.has(pid)) return toast(`${player(pid).name} has already been substituted`);
      const next = [...draft.lineup];
      next[slot] = pid;
      if (ctx.match && MAX_SUBS - usedSubs - next.filter((id) => !onPitch.has(id) && !sentOff.has(id)).length < 0) {
        return toast('No substitutions left');
      }
      draft.lineup = next;
    }
    render();
  }

  function onDrop(source: { slot?: number; pid: string }, key: string): void {
    const [kind, val] = key.split(':');
    if (kind === 'slot') {
      const slot = Number(val);
      if (source.slot !== undefined) {
        const a = draft.lineup[source.slot];
        const b = draft.lineup[slot];
        if (sentOff.has(a) || sentOff.has(b)) return toast('Sent-off players cannot be moved');
        draft.lineup[source.slot] = b;
        draft.lineup[slot] = a;
        render();
      } else placeInSlot(slot, source.pid);
    } else if (kind === 'bench' && source.slot !== undefined) {
      placeInSlot(source.slot, val);
    }
  }

  function chip(slot: number | undefined, pid: string, extraClass = ''): HTMLElement {
    const p = player(pid);
    const pos = slot !== undefined ? FORMATIONS[draft.formation].slots[slot].pos : p.positions[0];
    const role = slot !== undefined ? ROLES[draft.roles[slot]] : null;
    const rating = ratingAt(p, pos);
    const off = slot !== undefined && familiarity(p, pos) < 1;
    const fit = fitness(pid);
    const el = h(
      'div',
      {
        class: `chip ${extraClass} ${selected === slot && slot !== undefined ? 'sel' : ''} ${sentOff.has(pid) ? 'red' : ''} ${subbedOff.has(pid) ? 'gone' : ''}`,
        'data-drop': slot !== undefined ? `slot:${slot}` : `bench:${pid}`,
      },
      h('div', { class: 'dot', style: { background: slot === 0 ? '#1b1b1b' : ctx.team.color, borderColor: ctx.team.color } }, p.number),
      h('div', { class: 'nm' }, lastName(p)),
      h('div', { class: `rl ${off ? 'warn' : ''}` }, role ? `${role.short} · ${rating}` : `${p.positions.join('/')} · ${rating}`),
      h('div', { class: 'fit' }, h('i', { style: { width: `${Math.round(fit * 100)}%`, background: fit > 0.7 ? '#4ade80' : fit > 0.5 ? '#facc15' : '#f87171' } })),
    );
    draggable(
      el,
      () => {
        if (slot !== undefined) selected = selected === slot ? null : slot;
        else if (selected !== null) return placeInSlot(selected, pid);
        render();
      },
      (key) => onDrop({ slot, pid }, key),
    );
    return el;
  }

  /**
   * The preview shape is computed exactly as the match engine does for the current ball
   * position, which the user can drag around to see how the block shifts.
   */
  function board(): HTMLElement {
    const form = FORMATIONS[draft.formation];
    const ballEl = h('div', { class: 'board-ball', title: 'Drag the ball to preview the shape' });
    const pitch = h(
      'div',
      { class: 'board' },
      h('div', { class: 'line half' }),
      h('div', { class: 'circle' }),
      h('div', { class: 'box top' }),
      h('div', { class: 'box bottom' }),
    );
    const chips = form.slots.map((_, i) => chip(i, draft.lineup[i], 'on-board'));
    pitch.append(...chips, ballEl);

    const place = (el: HTMLElement, p: { x: number; y: number }) => {
      el.style.left = `${(p.y / C.PITCH_W) * 100}%`;
      el.style.top = `${(1 - p.x / C.PITCH_L) * 100}%`;
    };
    const layout = () => {
      const ball = previewBall;
      const attack = shape === 'attack';
      // In possession, attackers hold the line of a typical opponent's back four, as in the engine.
      const oppLine = clamp(0.21 + (1 - toU(0, ball.x) - 0.5) * 0.32, 0.06, 0.56);
      form.slots.forEach((slot, i) => {
        const role = ROLES[draft.roles[i]];
        const pos =
          i === 0
            ? keeperTarget(0, ball, !!role.sweeper, draft.team.lineHeight)
            : formationTarget(0, slot, role, draft.instr[i], { ball, inPossession: attack, ti: draft.team, oppLineU: attack ? 1 - oppLine : undefined });
        place(chips[i], pos);
      });
      place(ballEl, ball);
    };

    ballEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ballEl.setPointerCapture(e.pointerId);
      pitch.classList.add('dragging');
      const move = (ev: PointerEvent) => {
        const r = pitch.getBoundingClientRect();
        previewBall = {
          x: clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) * C.PITCH_L,
          y: clamp((ev.clientX - r.left) / r.width, 0, 1) * C.PITCH_W,
        };
        layout();
      };
      const up = () => {
        pitch.classList.remove('dragging');
        ballEl.removeEventListener('pointermove', move);
        ballEl.removeEventListener('pointerup', up);
        ballEl.removeEventListener('pointercancel', up);
      };
      ballEl.addEventListener('pointermove', move);
      ballEl.addEventListener('pointerup', up);
      ballEl.addEventListener('pointercancel', up);
    });

    layout();
    return pitch;
  }

  function sheet(slotIdx: number): HTMLElement {
    const slot = FORMATIONS[draft.formation].slots[slotIdx];
    const p = player(draft.lineup[slotIdx]);
    const role = ROLES[draft.roles[slotIdx]];
    const key = ARCHETYPE_WEIGHTS[ARCHETYPE_OF[slot.pos]];
    const instr = draft.instr[slotIdx];
    return h(
      'div',
      { class: 'sheet' },
      h(
        'div',
        { class: 'sheet-head' },
        h('div', {}, h('b', {}, `#${p.number} ${p.name}`), h('div', { class: 'muted' }, `${slot.pos} · natural ${p.positions.join('/')} · rating here ${ratingAt(p, slot.pos)}`), p.skills.length ? h('div', { class: 'sheet-skills' }, ...p.skills.map((id) => h('span', { title: SKILLS[id].desc }, skillIcon(id), SKILLS[id].name))) : null),
        h('button', { class: 'ghost-btn', onclick: () => ((selected = null), render()) }, 'Close'),
      ),
      h(
        'div',
        { class: 'attrs' },
        ...ATTR_KEYS.filter((k) => slot.pos === 'GK' || k !== 'goalkeeping').map((k) =>
          h('div', { class: `attr ${(key[k] ?? 0) >= 1 ? 'key' : ''}` }, h('span', {}, ATTR_LABEL[k]), h('b', {}, p.attrs[k])),
        ),
      ),
      h('div', { class: 'sub-title' }, 'Role'),
      h(
        'div',
        { class: 'roles' },
        ...rolesForSlot(slot.pos).map((r) =>
          h('button', { class: r.id === role.id ? 'on' : '', onclick: () => ((draft.roles[slotIdx] = r.id), render()) }, r.name),
        ),
      ),
      h('p', { class: 'muted role-desc' }, role.desc),
      ...(slotIdx === 0
        ? []
        : PLAYER_INSTRUCTION_OPTIONS.map((o) =>
            segmented(o.label, o.options, instr[o.key], (v) => {
              instr[o.key] = v;
              render();
            }),
          )),
    );
  }

  function render(): void {
    const scroll = root.scrollTop;
    root.replaceChildren();
    const bench = ctx.team.squad.filter((p) => !draft.lineup.includes(p.id));
    root.append(
      h(
        'header',
        { class: 'bar' },
        ctx.onCancel ? h('button', { class: 'ghost-btn', onclick: ctx.onCancel }, 'Back') : h('span'),
        h('div', { class: 'bar-title' }, h('b', {}, ctx.title), ctx.subtitle ? h('div', { class: 'muted' }, ctx.subtitle) : null),
        h('button', { class: 'primary', onclick: () => ctx.onConfirm(draft) }, ctx.confirmLabel),
      ),
      h(
        'div',
        { class: 'tac-grid' },
        h(
          'section',
          { class: 'tac-left' },
          h(
            'div',
            { class: 'formations' },
            ...FORMATION_IDS.map((id) =>
              h('button', { class: id === draft.formation ? 'on' : '', onclick: () => ((draft = withFormation(draft, id)), render()) }, FORMATIONS[id].name),
            ),
          ),
          segmented(
            'Show shape',
            [
              { value: 1, label: 'In possession' },
              { value: 0, label: 'Out of possession' },
            ],
            shape === 'attack' ? 1 : 0,
            (v) => ((shape = v ? 'attack' : 'defend'), render()),
          ),
          board(),
          h('div', { class: 'hint muted' }, 'Tap a player for role & instructions. Drag players to swap or bring on a sub. Drag the ball to see how the shape shifts.'),
          h(
            'div',
            { class: 'bench-head' },
            h('b', {}, 'Bench'),
            ctx.match ? h('span', { class: 'muted' }, `Substitutions left: ${subsLeft()}`) : null,
          ),
          h('div', { class: 'bench' }, ...bench.map((p) => chip(undefined, p.id))),
        ),
        h(
          'section',
          { class: 'tac-right' },
          selected !== null ? sheet(selected) : null,
          h('div', { class: 'panel' }, h('div', { class: 'sub-title' }, 'Team instructions'), ...TEAM_INSTRUCTION_OPTIONS.map((o) =>
            segmented(o.label, o.options, draft.team[o.key], (v) => {
              draft.team[o.key] = v;
              render();
            }),
          )),
        ),
      ),
    );
    root.scrollTop = scroll;
  }

  render();
  return root;
}
