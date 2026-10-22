// Klippy overlay: one closed shadow root on top of the page with independent layers.
//   highlights  – what the agent is showing you
//   cursor      – what the agent is doing (ghost pointer; the real mouse stays yours)
//   character   – the sprite + speech bubble + confirm prompts
// Everything is pointer-events:none except the confirm buttons while a prompt is open.
import { KLIPPY_HOST_TAG } from '../eyes/types';
import { STYLES, SPRITE_SVG, CURSOR_SVG } from './assets';

type Point = [number, number];

interface Highlight {
  el: WeakRef<Element>;
  box: HTMLDivElement;
}

export interface ConfirmOptions {
  timeoutMs?: number;
  allowLabel?: string;
  denyLabel?: string;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private hlLayer: HTMLDivElement;
  private cursor: HTMLDivElement;
  private character: HTMLDivElement;
  private bubble: HTMLDivElement;
  private highlights: Highlight[] = [];
  private raf = 0;
  private pos: Point | null = null;
  private bubbleTimer = 0;
  private confirmResolve: ((v: boolean) => void) | null = null;

  constructor() {
    this.host = document.createElement(KLIPPY_HOST_TAG);
    const hs = this.host.style;
    for (const [k, v] of Object.entries({
      all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', 'pointer-events': 'none', display: 'block',
      contain: 'strict', width: '100vw', height: '100vh',
    })) hs.setProperty(k, v, 'important');
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${STYLES}</style>
      <div class="layer hl"></div>
      <div class="layer char"><div class="character idle">${SPRITE_SVG}</div><div class="bubble" hidden></div></div>
      <div class="layer cur"><div class="cursor" hidden>${CURSOR_SVG}<span class="tag">Klippy</span></div></div>`;
    this.hlLayer = this.root.querySelector('.hl')!;
    this.cursor = this.root.querySelector('.cursor')!;
    this.character = this.root.querySelector('.character')!;
    this.bubble = this.root.querySelector('.bubble')!;
    this.attach();
  }

  /** (Re)attaches the host if the page removed it. */
  attach(): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  setMood(mood: 'idle' | 'thinking' | 'working'): void {
    this.character.className = `character ${mood}`;
  }

  private characterAnchor(): Point {
    const r = this.character.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + 4];
  }

  /** Curved path from the current cursor position to (x, y). */
  pathTo(x: number, y: number, steps = 14): Point[] {
    const [sx, sy] = this.pos ?? this.characterAnchor();
    const dx = x - sx;
    const dy = y - sy;
    const dist = Math.hypot(dx, dy) || 1;
    // Control point offset perpendicular to the straight line: a gentle, human-ish arc.
    const bend = Math.min(120, dist * 0.25);
    const cx = sx + dx / 2 - (dy / dist) * bend;
    const cy = sy + dy / 2 + (dx / dist) * bend;
    const pts: Point[] = [];
    for (let i = 1; i <= steps; i++) {
      const t = easeInOutCubic(i / steps);
      const u = 1 - t;
      pts.push([Math.round(u * u * sx + 2 * u * t * cx + t * t * x), Math.round(u * u * sy + 2 * u * t * cy + t * t * y)]);
    }
    return pts;
  }

  /** Animates the ghost cursor to (x, y). Resolves on arrival with the path it took. */
  moveCursor(x: number, y: number): Promise<Point[]> {
    this.attach();
    const [sx, sy] = this.pos ?? this.characterAnchor();
    const path = this.pathTo(x, y);
    const dist = Math.hypot(x - sx, y - sy);
    const duration = Math.min(900, Math.max(280, 250 + dist * 0.6));
    this.cursor.hidden = false;
    this.setMood('working');
    const dense = this.pathTo(x, y, 60);
    const start = performance.now();
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallback);
        this.cursor.style.transform = `translate(${x}px, ${y}px)`;
        this.pos = [x, y];
        resolve(path);
      };
      // rAF does not run in hidden tabs; never let the animation block an action.
      const fallback = setTimeout(finish, duration + 400);
      if (document.hidden) return finish();
      const frame = () => {
        if (finished) return;
        // Use performance.now(): the rAF timestamp can be earlier than `start`.
        const t = Math.min(1, Math.max(0, (performance.now() - start) / duration));
        const idx = Math.min(dense.length - 1, Math.max(0, Math.floor(t * (dense.length - 1))));
        const [px, py] = dense[idx] ?? [x, y];
        this.cursor.style.transform = `translate(${px}px, ${py}px)`;
        if (t < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
    });
  }

  /** Click ripple at the cursor position. */
  clickFx(): void {
    if (!this.pos) return;
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.transform = `translate(${this.pos[0]}px, ${this.pos[1]}px)`;
    this.root.querySelector('.cur')!.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  hideCursor(): void {
    this.cursor.hidden = true;
    this.pos = null;
    this.setMood('idle');
  }

  highlight(elements: Element[], label?: string): void {
    this.attach();
    elements.forEach((el, i) => {
      const box = document.createElement('div');
      box.className = 'box';
      box.style.zIndex = String(1000 - i); // earlier badges stay on top of later boxes
      // One text label (on the first box) plus number badges on the right corner, so
      // labels of neighbouring boxes never pile on top of each other.
      if (label && i === 0) {
        const tag = document.createElement('span');
        tag.className = 'label';
        tag.textContent = label;
        box.appendChild(tag);
      }
      if (elements.length > 1) {
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(i + 1);
        box.appendChild(num);
      }
      this.hlLayer.appendChild(box);
      this.highlights.push({ el: new WeakRef(el), box });
    });
    this.track();
  }

  clearHighlights(): void {
    for (const h of this.highlights) h.box.remove();
    this.highlights = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Keeps highlight boxes glued to their elements while scrolling/resizing. */
  private track(): void {
    if (this.raf) return;
    const loop = () => {
      this.highlights = this.highlights.filter((h) => {
        const el = h.el.deref();
        if (!el || !el.isConnected) {
          h.box.remove();
          return false;
        }
        const r = el.getBoundingClientRect();
        const s = h.box.style;
        s.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
        s.width = `${r.width + 8}px`;
        s.height = `${r.height + 8}px`;
        return true;
      });
      this.raf = this.highlights.length ? requestAnimationFrame(loop) : 0;
    };
    this.raf = requestAnimationFrame(loop);
  }

  say(text: string, ms?: number): void {
    if (this.confirmResolve) return; // never cover a pending confirmation
    this.attach();
    clearTimeout(this.bubbleTimer);
    this.bubble.className = 'bubble';
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    const duration = ms ?? Math.min(12000, 3500 + text.length * 50);
    this.bubbleTimer = window.setTimeout(() => (this.bubble.hidden = true), duration);
  }

  /**
   * Asks the user to confirm an action. Only trusted (real user) clicks count:
   * page scripts cannot reach into the closed shadow root, and synthetic events are ignored.
   */
  confirm(question: string, opts: ConfirmOptions = {}): Promise<boolean> {
    this.attach();
    if (this.confirmResolve) this.confirmResolve(false);
    clearTimeout(this.bubbleTimer);
    this.setMood('thinking');
    this.bubble.className = 'bubble confirm';
    this.bubble.textContent = '';
    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = question;
    const row = document.createElement('div');
    row.className = 'row';
    const allow = document.createElement('button');
    allow.textContent = opts.allowLabel ?? 'Allow';
    allow.className = 'allow';
    allow.dataset.klippyAction = 'allow';
    const deny = document.createElement('button');
    deny.textContent = opts.denyLabel ?? 'Deny';
    deny.className = 'deny';
    deny.dataset.klippyAction = 'deny';
    row.append(deny, allow);
    this.bubble.append(q, row);
    this.bubble.hidden = false;

    return new Promise<boolean>((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(timer);
        this.confirmResolve = null;
        this.bubble.hidden = true;
        this.bubble.className = 'bubble';
        this.bubble.textContent = '';
        this.setMood('idle');
        resolve(v);
      };
      this.confirmResolve = done;
      const onClick = (v: boolean) => (ev: MouseEvent) => {
        if (!ev.isTrusted) return;
        ev.preventDefault();
        ev.stopPropagation();
        done(v);
      };
      allow.addEventListener('click', onClick(true));
      deny.addEventListener('click', onClick(false));
      const timer = setTimeout(() => done(false), opts.timeoutMs ?? 60000);
    });
  }

  /** True when (x, y) falls on the character or bubble area. */
  coversPoint(x: number, y: number): boolean {
    for (const el of [this.character, this.bubble]) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  destroy(): void {
    this.clearHighlights();
    this.host.remove();
  }
}
