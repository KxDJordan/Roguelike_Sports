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

/**
 * Pointer-based drag that works for mouse and touch. A press without movement counts as a tap.
 * Drop targets are any elements with a data-drop attribute.
 */
export function draggable(el: HTMLElement, onTap: () => void, onDrop: (dropKey: string) => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost: HTMLElement | null = null;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add('ghost');
        document.body.append(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!ghost) {
        if (ev.type === 'pointerup') onTap();
        return;
      }
      ghost.remove();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop]');
      if (target && target !== el && target.dataset.drop) onDrop(target.dataset.drop);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
