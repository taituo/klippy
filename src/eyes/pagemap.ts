// Builds the page map: a compact, indexed, text-only view of what is on the page.
import { accessibleName, clip, collapse, inputType, roleOf, tagOf } from './accname';
import { idFor, sweep } from './registry';
import { KLIPPY_HOST_TAG, type ItemKind, type PageItem, type PageMap } from './types';

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'svg', 'math', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', KLIPPY_HOST_TAG]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem', 'listbox',
]);
const LIVE_ROLES = new Set(['dialog', 'alertdialog', 'alert', 'status', 'log', 'tooltip']);
const TEXT_TAGS = new Set([
  'p', 'span', 'div', 'li', 'td', 'th', 'dt', 'dd', 'strong', 'em', 'b', 'i', 'small', 'figcaption',
  'blockquote', 'pre', 'code', 'label', 'caption', 'legend', 'section', 'article', 'main', 'header', 'footer', 'output',
]);

export interface SnapshotOptions {
  /** Maximum number of items. Diffs use a large cap internally. */
  maxItems?: number;
  /** Include plain text blocks (default true). */
  includeText?: boolean;
}

function isInteractive(el: Element, role: string): boolean {
  const tag = tagOf(el);
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
  if (tag === 'input') return inputType(el) !== 'hidden';
  if (INTERACTIVE_ROLES.has(role)) return true;
  if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return true;
  if (el.hasAttribute('onclick')) return true;
  const tabindex = el.getAttribute('tabindex');
  return tabindex !== null && Number(tabindex) >= 0;
}

function directText(el: Element): string {
  let t = '';
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue ?? '';
  }
  return collapse(t);
}

function shortHref(a: Element): string | undefined {
  const raw = a.getAttribute('href');
  if (raw === null) return undefined;
  try {
    const u = new URL(raw, a.ownerDocument.baseURI);
    if (u.protocol === 'javascript:') return 'javascript:';
    if (u.protocol === 'mailto:' || u.protocol === 'tel:') return clip(u.href, 50);
    const sameOrigin = u.origin === location.origin;
    const s = sameOrigin ? u.pathname + u.search + u.hash : u.host + u.pathname + u.search;
    return clip(s, 50);
  } catch {
    return clip(raw, 50);
  }
}

function valueOf(el: Element, role: string): string | undefined {
  const tag = tagOf(el);
  if (tag === 'input') {
    const t = inputType(el);
    if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image' || t === 'hidden') return undefined;
    const v = (el as HTMLInputElement).value;
    if (t === 'password') return v ? '••••' : '';
    if (t === 'file') return clip(Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name).join(', '), 60);
    return clip(v, 60);
  }
  if (tag === 'textarea') return clip((el as HTMLTextAreaElement).value, 60);
  if (tag === 'select') {
    const s = el as HTMLSelectElement;
    return clip(Array.from(s.selectedOptions).map((o) => o.label || o.text).join(', '), 60);
  }
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
    const v = el.getAttribute('aria-valuetext') ?? el.getAttribute('aria-valuenow');
    if (v) return clip(v, 60);
    if ((el as HTMLElement).isContentEditable) return clip(el.textContent, 60);
  }
  if (role === 'slider' || role === 'spinbutton' || role === 'progressbar') {
    const v = el.getAttribute('aria-valuetext') ?? el.getAttribute('aria-valuenow');
    if (v) return clip(v, 60);
  }
  return undefined;
}

function statesOf(el: Element, role: string): string[] {
  const s: string[] = [];
  const he = el as HTMLInputElement;
  const aria = (name: string) => el.getAttribute(`aria-${name}`);
  if ((el.matches(':disabled') as boolean) || aria('disabled') === 'true') s.push('disabled');
  if (tagOf(el) === 'input' && (inputType(el) === 'checkbox' || inputType(el) === 'radio')) {
    if (he.indeterminate) s.push('mixed');
    else if (he.checked) s.push('checked');
  } else if (aria('checked') === 'true') s.push('checked');
  else if (aria('checked') === 'mixed') s.push('mixed');
  if (aria('expanded') === 'true') s.push('expanded');
  else if (aria('expanded') === 'false') s.push('collapsed');
  if (aria('selected') === 'true' || (tagOf(el) === 'option' && (el as HTMLOptionElement).selected)) s.push('selected');
  if (aria('pressed') === 'true') s.push('pressed');
  if ((he.required as boolean | undefined) || aria('required') === 'true') s.push('required');
  if ((he.readOnly as boolean | undefined) || aria('readonly') === 'true') s.push('readonly');
  if (aria('invalid') === 'true') s.push('invalid');
  if (tagOf(el) === 'input' && inputType(el) === 'password') s.push('password');
  if (role === 'dialog' && tagOf(el) === 'dialog' && (el as HTMLDialogElement).open) s.push('open');
  return s;
}

function deepActiveElement(): Element | null {
  let a: Element | null = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

function isOffscreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth;
}

/**
 * Walks the DOM (including open shadow roots) and returns the page map.
 * Hidden subtrees (display:none, aria-hidden, hidden) are skipped.
 */
export function buildPageMap(opts: SnapshotOptions = {}): PageMap {
  const maxItems = opts.maxItems ?? 400;
  const includeText = opts.includeText ?? true;
  const items: PageItem[] = [];
  let omitted = 0;
  const active = deepActiveElement();
  let focusedId: number | undefined;

  const push = (el: Element, kind: ItemKind, role: string, name: string) => {
    if (items.length >= maxItems) {
      omitted++;
      return;
    }
    const id = idFor(el);
    const item: PageItem = { id, kind, role, name, tag: tagOf(el), states: kind === 'text' ? [] : statesOf(el, role), fp: '' };
    if (kind === 'control') {
      const v = valueOf(el, role);
      if (v !== undefined) item.value = v;
      if (role === 'link') item.href = shortHref(el);
    }
    if (kind === 'heading') {
      const m = /^h([1-6])$/.exec(item.tag);
      item.level = m ? Number(m[1]) : Number(el.getAttribute('aria-level') ?? 2);
    }
    if (isOffscreen(el)) item.offscreen = true;
    if (el === active) focusedId = id;
    items.push(item);
  };

  const visit = (el: Element, insideControl: boolean) => {
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden') || el.hasAttribute('inert')) return;
    // display:none (or content-visibility hidden) hides the whole subtree.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) {
      if (getComputedStyle(el).display === 'none' || el.getClientRects().length === 0) return;
    }
    const cssHidden = typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions);

    let nowInsideControl = insideControl;
    if (!cssHidden) {
      const role = roleOf(el);
      if (role !== 'presentation' && role !== 'none') {
        if (isInteractive(el, role)) {
          push(el, 'control', role, accessibleName(el));
          nowInsideControl = true;
        } else if (role === 'heading') {
          push(el, 'heading', role, accessibleName(el));
          nowInsideControl = true;
        } else if (LIVE_ROLES.has(role)) {
          const name = accessibleName(el);
          push(el, 'live', role, name || clip(directText(el)));
        } else if (includeText && !insideControl && TEXT_TAGS.has(tag)) {
          const t = directText(el);
          if (t.length >= 2) push(el, 'text', 'text', clip(t));
        }
      }
    }
    if (el.shadowRoot) {
      for (const c of el.shadowRoot.children) visit(c, nowInsideControl);
    }
    for (const c of el.children) visit(c, nowInsideControl);
  };

  if (document.body) visit(document.body, false);

  // Fingerprints: role|name|tag plus an ordinal among identical siblings-in-map.
  const counts = new Map<string, number>();
  for (const it of items) {
    const base = `${it.role}|${it.name}|${it.tag}`;
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    it.fp = `${base}#${n}`;
  }
  sweep();
  return { url: location.href, title: document.title, items, omitted, focusedId };
}

export function formatItem(it: PageItem): string {
  const role = it.kind === 'heading' ? `heading(${it.level ?? '?'})` : it.role;
  let s = `[${it.id}] ${role}`;
  if (it.name) s += ` "${it.name}"`;
  if (it.value !== undefined && it.value !== '') s += ` value="${it.value}"`;
  if (it.href) s += ` → ${it.href}`;
  if (it.states.length) s += ' ' + it.states.join(' ');
  return s;
}

export function formatPageMap(map: PageMap): string {
  const lines = [`url: ${map.url}`, `title: ${map.title}`];
  if (map.focusedId !== undefined) lines.push(`focused: [${map.focusedId}]`);
  lines.push('');
  for (const it of map.items) lines.push(formatItem(it) + (it.offscreen ? ' (offscreen)' : ''));
  if (map.omitted) lines.push(`… ${map.omitted} more items not shown (raise maxItems)`);
  if (!map.items.length) lines.push('(no visible items)');
  return lines.join('\n');
}
