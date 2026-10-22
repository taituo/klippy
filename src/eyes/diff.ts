// Deterministic "what changed" between two page maps, plus a settle helper.
import { buildPageMap, formatItem } from './pagemap';
import { KLIPPY_HOST_TAG, type ChangeReport, type ChangedItem, type PageItem, type PageMap } from './types';

const DIFF_CAP = 3000;
const MAX_LINES = 40;

function compare(a: PageItem, b: PageItem): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`name: "${a.name}" → "${b.name}"`);
  if ((a.value ?? '') !== (b.value ?? '')) out.push(`value: "${a.value ?? ''}" → "${b.value ?? ''}"`);
  if ((a.href ?? '') !== (b.href ?? '')) out.push(`href: ${a.href ?? '-'} → ${b.href ?? '-'}`);
  if (a.role !== b.role) out.push(`role: ${a.role} → ${b.role}`);
  const sa = new Set(a.states);
  const sb = new Set(b.states);
  for (const s of sb) if (!sa.has(s)) out.push(`+${s}`);
  for (const s of sa) if (!sb.has(s)) out.push(`-${s}`);
  return out;
}

/** Pure function: diff two page maps by id, matching re-rendered nodes by fingerprint. */
export function diffMaps(before: PageMap, after: PageMap): Omit<ChangeReport, 'unsettled'> {
  const a = new Map(before.items.map((i) => [i.id, i]));
  const b = new Map(after.items.map((i) => [i.id, i]));
  const changed: ChangedItem[] = [];
  let removed: PageItem[] = [];
  let added: PageItem[] = [];

  for (const [id, bi] of b) {
    const ai = a.get(id);
    if (!ai) added.push(bi);
    else {
      const c = compare(ai, bi);
      if (c.length) changed.push({ before: ai, after: bi, changes: c });
    }
  }
  for (const [id, ai] of a) if (!b.has(id)) removed.push(ai);

  // Re-render matching: a removed and an added item with the same fingerprint are the same thing.
  if (removed.length && added.length) {
    const byFp = new Map<string, PageItem[]>();
    for (const r of removed) {
      const list = byFp.get(r.fp) ?? [];
      list.push(r);
      byFp.set(r.fp, list);
    }
    const stillAdded: PageItem[] = [];
    const matched = new Set<PageItem>();
    for (const ad of added) {
      const cand = byFp.get(ad.fp)?.shift();
      if (cand) {
        matched.add(cand);
        const c = compare(cand, ad);
        if (c.length) changed.push({ before: cand, after: ad, changes: c });
      } else stillAdded.push(ad);
    }
    added = stillAdded;
    removed = removed.filter((r) => !matched.has(r));
  }

  const report: Omit<ChangeReport, 'unsettled'> = { added, removed, changed };
  if (before.url !== after.url) report.url = [before.url, after.url];
  if (before.title !== after.title) report.title = [before.title, after.title];
  if (before.focusedId !== after.focusedId) {
    report.focus = [
      before.focusedId !== undefined ? a.get(before.focusedId) : undefined,
      after.focusedId !== undefined ? b.get(after.focusedId) : undefined,
    ];
  }
  return report;
}

export function isEmptyReport(r: Omit<ChangeReport, 'unsettled'>): boolean {
  return !r.url && !r.title && !r.added.length && !r.removed.length && !r.changed.length && !r.focus;
}

export function formatReport(r: ChangeReport): string {
  if (isEmptyReport(r)) return r.unsettled ? 'no stable change (page kept changing)' : 'no visible change';
  const lines: string[] = [];
  if (r.url) lines.push(`url: ${r.url[0]} → ${r.url[1]}`);
  if (r.title) lines.push(`title: "${r.title[0]}" → "${r.title[1]}"`);
  const body: string[] = [];
  for (const it of r.added) body.push(`+ ${formatItem(it)}`);
  for (const c of r.changed) {
    const idPart = c.before.id === c.after.id ? `[${c.after.id}]` : `[${c.after.id}] (was [${c.before.id}])`;
    const label = `${c.after.role}${c.after.name ? ` "${c.after.name}"` : ''}`;
    body.push(`~ ${idPart} ${label}  ${c.changes.join(', ')}`);
  }
  for (const it of r.removed) body.push(`- ${formatItem(it)}`);
  if (body.length > MAX_LINES) {
    const rest = body.length - MAX_LINES;
    body.length = MAX_LINES;
    body.push(`… ${rest} more changes`);
  }
  lines.push(...body);
  if (r.focus) {
    const f = r.focus[1];
    lines.push(`focus: ${f ? formatItem(f) : 'none'}`);
  }
  if (r.unsettled) lines.push('(page still changing after timeout)');
  return lines.join('\n');
}

export interface SettleOptions {
  /** Quiet period without DOM mutations. */
  quietMs?: number;
  /** Hard cap. */
  maxMs?: number;
  /** Minimum wait, gives the page a chance to react at all. */
  minMs?: number;
}

/** Waits until the DOM has been quiet for quietMs (or maxMs passes). Returns true if it settled. */
export function settle(opts: SettleOptions = {}): Promise<boolean> {
  const quietMs = opts.quietMs ?? 300;
  const maxMs = opts.maxMs ?? 3000;
  const minMs = opts.minMs ?? 80;
  const start = performance.now();
  let last = start;
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target as Element;
      if (t.nodeType === Node.ELEMENT_NODE && t.localName === KLIPPY_HOST_TAG) continue;
      last = performance.now();
      return;
    }
  });
  obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (now - start >= minMs && now - last >= quietMs) {
        obs.disconnect();
        resolve(true);
      } else if (now - start >= maxMs) {
        obs.disconnect();
        resolve(false);
      } else setTimeout(tick, 40);
    };
    setTimeout(tick, 40);
  });
}

let pending: PageMap | null = null;

/** Takes the "before" picture. Call right before an action. */
export function beginChange(): void {
  pending = buildPageMap({ maxItems: DIFF_CAP });
}

/** Waits for the page to settle and returns what changed since beginChange(). */
export async function endChange(opts: SettleOptions = {}): Promise<{ report: ChangeReport; text: string; empty: boolean }> {
  const before = pending ?? buildPageMap({ maxItems: DIFF_CAP });
  pending = null;
  const settled = await settle(opts);
  const after = buildPageMap({ maxItems: DIFF_CAP });
  const report: ChangeReport = { ...diffMaps(before, after), unsettled: !settled };
  return { report, text: formatReport(report), empty: isEmptyReport(report) };
}
