// Simplified role and accessible-name computation. Not a full ARIA implementation:
// good enough to give a model a stable, readable label for each element.

const MAX_NAME = 80;

export function collapse(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function clip(s: string | null | undefined, max = MAX_NAME): string {
  const t = collapse(s);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function tagOf(el: Element): string {
  return el.localName;
}

const TEXTBOX_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'password', 'date', 'datetime-local', 'month', 'week', 'time']);
const BUTTON_TYPES = new Set(['button', 'submit', 'reset', 'image', 'file', 'color']);

export function inputType(el: Element): string {
  return ((el as HTMLInputElement).type || el.getAttribute('type') || 'text').toLowerCase();
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  const tag = tagOf(el);
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : 'generic';
    case 'button':
    case 'summary':
      return 'button';
    case 'input': {
      const t = inputType(el);
      if (BUTTON_TYPES.has(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (TEXTBOX_TYPES.has(t)) return 'textbox';
      return 'textbox';
    }
    case 'select': {
      const s = el as HTMLSelectElement;
      return s.multiple || s.size > 1 ? 'listbox' : 'combobox';
    }
    case 'textarea':
      return 'textbox';
    case 'option':
      return 'option';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'dialog':
      return 'dialog';
    case 'img':
      return 'img';
    default:
      if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
      return 'generic';
  }
}

export function isFormControl(el: Element): boolean {
  const tag = tagOf(el);
  return tag === 'input' || tag === 'select' || tag === 'textarea';
}

/** Visible text of an element, falling back to labelled descendants (icon buttons). */
export function textOf(el: Element): string {
  const he = el as HTMLElement;
  let t = collapse(typeof he.innerText === 'string' ? he.innerText : el.textContent);
  if (!t) {
    const labelled = el.querySelector('[aria-label], img[alt], svg title, [title]');
    if (labelled) {
      t = collapse(
        labelled.getAttribute('aria-label') ??
          labelled.getAttribute('alt') ??
          (labelled.localName === 'title' ? labelled.textContent : labelled.getAttribute('title')),
      );
    }
  }
  return t;
}

function byIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr);
  if (!ids) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => (root.getElementById ? root.getElementById(id) : null) ?? el.ownerDocument.getElementById(id))
    .filter((x): x is HTMLElement => !!x)
    .map((x) => textOf(x))
    .join(' ');
}

export function accessibleName(el: Element): string {
  const labelledBy = byIds(el, 'aria-labelledby');
  if (labelledBy) return clip(labelledBy);
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return clip(ariaLabel);

  const tag = tagOf(el);
  if (isFormControl(el)) {
    if (tag === 'input') {
      const t = inputType(el);
      if (t === 'submit' || t === 'button' || t === 'reset') {
        const v = (el as HTMLInputElement).value;
        if (v) return clip(v);
        if (t === 'submit') return 'Submit';
        if (t === 'reset') return 'Reset';
      }
      if (t === 'image') return clip(el.getAttribute('alt') ?? 'Submit');
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = Array.from(labels)
        .map((l) => textOf(l))
        .join(' ');
      if (t) return clip(t);
    }
    const ph = el.getAttribute('placeholder') ?? el.getAttribute('title');
    if (ph) return clip(ph);
    return '';
  }
  if (tag === 'img') return clip(el.getAttribute('alt') ?? el.getAttribute('title'));
  const t = textOf(el);
  if (t) return clip(t);
  return clip(el.getAttribute('title'));
}
