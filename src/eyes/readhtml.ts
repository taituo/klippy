// Cleaned HTML of one subtree: the "zoom in" view when the page map is not enough.
import { elementFor, peekId } from './registry';

const DROP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'iframe', 'object', 'embed']);
const KEEP_ATTRS = new Set([
  'id', 'name', 'type', 'href', 'src', 'alt', 'title', 'role', 'value', 'placeholder', 'for', 'action', 'method',
  'autocomplete', 'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple', 'download', 'target',
  'lang', 'colspan', 'rowspan', 'label', 'data-testid', 'open', 'hidden', 'contenteditable', 'tabindex',
]);
const MAX_ATTR = 100;
const MAX_TEXT = 200;

function cleanAttr(name: string, value: string): string {
  if ((name === 'src' || name === 'href') && value.startsWith('data:')) return 'data:…';
  return value.length > MAX_ATTR ? value.slice(0, MAX_ATTR - 1) + '…' : value;
}

export function readHtml(id: number, maxChars = 4000): string {
  const el = elementFor(id);
  if (!el) throw new Error(`No element with id [${id}] on this page (it may have been removed). Take a new snapshot.`);

  const clone = el.cloneNode(true) as Element;
  // Parallel walk: cloneNode preserves structure, so querySelectorAll order matches.
  const origAll = [el, ...Array.from(el.querySelectorAll('*'))];
  const cloneAll = [clone, ...Array.from(clone.querySelectorAll('*'))];

  for (let i = 0; i < cloneAll.length; i++) {
    const o = origAll[i];
    const c = cloneAll[i];
    if (!o || !c) continue;
    const known = peekId(o);
    // Live form state is not in attributes; copy it over.
    if (o.localName === 'input') {
      const oi = o as HTMLInputElement;
      if (oi.type === 'password') {
        if (oi.value) c.setAttribute('value', '••••');
        else c.removeAttribute('value');
      } else if (oi.type === 'checkbox' || oi.type === 'radio') {
        if (oi.checked) c.setAttribute('checked', '');
        else c.removeAttribute('checked');
      } else if (oi.type !== 'file') c.setAttribute('value', oi.value);
    } else if (o.localName === 'textarea') {
      c.textContent = (o as HTMLTextAreaElement).value;
    }
    for (const attr of Array.from(c.attributes)) {
      const n = attr.name;
      if (KEEP_ATTRS.has(n) || n.startsWith('aria-')) c.setAttribute(n, cleanAttr(n, attr.value));
      else c.removeAttribute(n);
    }
    if (known !== undefined) c.setAttribute('data-k', String(known));
  }

  for (const c of Array.from(clone.querySelectorAll('*'))) {
    if (DROP_TAGS.has(c.localName)) c.remove();
    else if (c.localName === 'svg') c.innerHTML = '';
  }
  if (clone.localName === 'svg') clone.innerHTML = '';

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const drop: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.COMMENT_NODE) {
      drop.push(n);
      continue;
    }
    const t = (n.nodeValue ?? '').replace(/\s+/g, ' ');
    n.nodeValue = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t;
  }
  for (const n of drop) n.parentNode?.removeChild(n);

  let html = clone.outerHTML.replace(/>\s+</g, '> <').replace(/\s{2,}/g, ' ').trim();
  if (html.length > maxChars) {
    const cut = html.length - maxChars;
    html = html.slice(0, maxChars) + `…[truncated ${cut} chars]`;
  }
  return html;
}
