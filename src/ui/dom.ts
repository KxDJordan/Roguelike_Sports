type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Minimal element builder: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') (el as unknown as Record<string, unknown>)[k] = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else (el.style as unknown as Record<string, string>)[sk] = sv;
      }
    }
    else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function segmented(label: string, options: { value: number; label: string }[], value: number, onChange: (v: number) => void): HTMLElement {
  return h(
    'div',
    { class: 'seg-row' },
    h('span', { class: 'seg-label' }, label),
    h(
      'div',
      { class: 'seg' },
      ...options.map((o) => h('button', { class: o.value === value ? 'on' : '', onclick: () => onChange(o.value) }, o.label)),
    ),
  );
}

export function toast(msg: string): void {
  const el = h('div', { class: 'toast' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

/** How long a finger must rest on an item before it can be dragged (so swipes still scroll). */
const HOLD_MS = 220;

/**
 * Pointer-based drag that works for mouse and touch. A press without movement counts as a tap.
 * With a mouse, moving starts the drag at once. With a finger, the item has to be held still for
 * a moment first; a swipe before that scrolls the page as normal (the element allows vertical
 * panning, and the browser cancels the pointer when it takes over the scroll).
 * Drop targets are any elements with a data-drop attribute.
 */
export function draggable(el: HTMLElement, onTap: () => void, onDrop: (dropKey: string) => void): void {
  // Once a drag is armed, stop the browser from also scrolling the page.
  let armed = false;
  el.addEventListener(
    'touchmove',
    (e) => {
      if (armed) e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const touch = e.pointerType !== 'mouse';
    let ghost: HTMLElement | null = null;
    let last = { x: sx, y: sy };
    armed = !touch;
    const hold = touch
      ? window.setTimeout(() => {
          armed = true;
          el.classList.add('armed');
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // The pointer already went away.
          }
          navigator.vibrate?.(12);
          startGhost(last.x, last.y);
        }, HOLD_MS)
      : 0;
    const startGhost = (x: number, y: number) => {
      ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add('ghost');
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
      document.body.append(ghost);
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8;
      // A finger that moves before the hold completes is a swipe or a tap that slipped: no drag.
      if (touch && !armed && moved) window.clearTimeout(hold);
      if (!ghost && armed && moved) startGhost(ev.clientX, ev.clientY);
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const up = (ev: PointerEvent) => {
      window.clearTimeout(hold);
      armed = false;
      el.classList.remove('armed');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      if (!ghost) {
        if (ev.type === 'pointerup' && Math.hypot(ev.clientX - sx, ev.clientY - sy) <= 8) onTap();
        return;
      }
      (ghost as HTMLElement).remove();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop]');
      if (target && target !== el && target.dataset.drop) onDrop(target.dataset.drop);
    };
    // Mouse drags capture straight away; a finger only once the hold arms (so scrolling still works).
    if (!touch) el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
