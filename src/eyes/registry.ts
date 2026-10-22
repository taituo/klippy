// Element <-> id registry. Ids are small integers, stable while the node lives.
// WeakMap/WeakRef so the registry never keeps page nodes alive.

const ids = new WeakMap<Element, number>();
const refs = new Map<number, WeakRef<Element>>();
let nextId = 1;

export function idFor(el: Element): number {
  let id = ids.get(el);
  if (id === undefined) {
    id = nextId++;
    ids.set(el, id);
    refs.set(id, new WeakRef(el));
  }
  return id;
}

export function peekId(el: Element): number | undefined {
  return ids.get(el);
}

/** Returns the live, connected element for an id, or null. */
export function elementFor(id: number): Element | null {
  const el = refs.get(id)?.deref();
  return el && el.isConnected ? el : null;
}

/** Drops registry entries whose nodes were garbage collected. */
export function sweep(): void {
  for (const [id, ref] of refs) {
    if (!ref.deref()) refs.delete(id);
  }
}
