// Klippy "eyes": everything that reads the page. Pure DOM code, no extension APIs,
// so the same bundle runs as a content script or injected over CDP (headless/VPS/workers).
import { accessibleName, roleOf } from './accname';
import { beginChange, diffMaps, endChange, formatReport, settle } from './diff';
import { buildPageMap, formatItem, formatPageMap, type SnapshotOptions } from './pagemap';
import { readHtml } from './readhtml';
import { elementFor, idFor } from './registry';
import { collectSignals } from './signals';

export { accessibleName, beginChange, buildPageMap, collectSignals, diffMaps, elementFor, endChange, formatItem, formatPageMap, formatReport, idFor, readHtml, roleOf, settle };
export type { SnapshotOptions };

export function snapshot(opts: SnapshotOptions = {}): string {
  return formatPageMap(buildPageMap(opts));
}

/** Short label for an element id, e.g. `[12] button "Save"`. */
export function describe(id: number): string {
  const el = elementFor(id);
  if (!el) return `[${id}] (gone)`;
  const name = accessibleName(el);
  return `[${id}] ${roleOf(el)}${name ? ` "${name}"` : ''}`;
}

export interface TargetInfo {
  x: number;
  y: number;
  rect: { left: number; top: number; width: number; height: number };
  occludedBy?: string;
}

/**
 * Scrolls an element into view and returns the point to act on.
 * Uses elementFromPoint to detect when something else (a cookie banner, a modal) covers it.
 */
export async function target(id: number): Promise<TargetInfo> {
  const el = elementFor(id);
  if (!el) throw new Error(`No element with id [${id}] on this page (it may have been removed). Take a new snapshot.`);
  let r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) throw new Error(`${describe(id)} has no size (not rendered).`);
  if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    r = el.getBoundingClientRect();
  }
  const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2));
  const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2));
  const info: TargetInfo = { x, y, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
    // Walk up to the nearest element worth naming.
    let cover: Element | null = hit;
    while (cover && cover.parentElement && !accessibleName(cover)) cover = cover.parentElement;
    const coverEl = cover ?? hit;
    info.occludedBy = `[${idFor(coverEl)}] ${roleOf(coverEl)} "${accessibleName(coverEl)}"`;
  }
  return info;
}
