/** Tag name of the overlay host element. The eyes never look inside it. */
export const KLIPPY_HOST_TAG = 'klippy-overlay';

export type ItemKind = 'control' | 'heading' | 'live' | 'text';

/** One entry in the page map: a compact, model-friendly description of an element. */
export interface PageItem {
  /** Stable id for this element for as long as the node lives in this document. */
  id: number;
  kind: ItemKind;
  role: string;
  name: string;
  tag: string;
  /** Boolean-ish states: disabled, checked, expanded, collapsed, selected, pressed, required, readonly, invalid, password. */
  states: string[];
  /** Current value for form controls (passwords are masked). */
  value?: string;
  /** Shortened link target for links. */
  href?: string;
  /** Heading level. */
  level?: number;
  /** True when the element is outside the viewport. Not part of diffs. */
  offscreen?: boolean;
  /** Fingerprint used to match re-rendered nodes across snapshots. */
  fp: string;
}

export interface PageMap {
  url: string;
  title: string;
  items: PageItem[];
  /** Number of items left out because of the item cap. */
  omitted: number;
  /** Id of the focused element, if it is in the map. */
  focusedId?: number;
}

export interface ChangedItem {
  before: PageItem;
  after: PageItem;
  changes: string[];
}

export interface ChangeReport {
  url?: [string, string];
  title?: [string, string];
  added: PageItem[];
  removed: PageItem[];
  changed: ChangedItem[];
  focus?: [PageItem | undefined, PageItem | undefined];
  /** True when the page kept changing until the settle timeout. */
  unsettled: boolean;
}
