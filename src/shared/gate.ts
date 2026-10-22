// GatePolicy: deterministic safety rules that live in the body.
// The brain (any agent driving Klippy) cannot bypass or loosen them: every action goes
// through evaluateGate() inside the extension. Model signals may only make it stricter.

export type GateAction = 'click' | 'type' | 'press' | 'navigate';

export type FieldKind = 'password' | 'payment' | 'otp' | 'text' | null;

/** Facts about an action, collected deterministically from the DOM by the body. */
export interface ActionSignals {
  action: GateAction;
  role: string;
  name: string;
  tag: string;
  /** For press: the key. */
  key?: string;
  /** For navigate: the target URL. */
  url?: string;
  inForm: boolean;
  formMethod: 'get' | 'post' | 'dialog' | null;
  /** The element submits its form when activated (submit button, or Enter in a form field). */
  submitsForm: boolean;
  formHasPassword: boolean;
  formHasPayment: boolean;
  formHasFile: boolean;
  fieldKind: FieldKind;
  /** Target is a textarea or contenteditable (chat/message boxes often send on Enter). */
  multiline: boolean;
  linkDownload: boolean;
  pageOrigin: string;
}

/** Optional classifier output. Can only add confirmations, never remove them. */
export interface ModelSignal {
  category: GateCategory;
  probability: number;
}

export type GateCategory = 'purchase' | 'send' | 'delete' | 'credentials' | 'payment' | '2fa' | 'submit' | 'download' | 'transfer';

export interface Verdict {
  allow: boolean;
  requireConfirm: boolean;
  categories: GateCategory[];
  reasons: string[];
}

const MODEL_THRESHOLD = 0.5;

// Word lists. English matched as whole words; Finnish matched as word-initial stems (inflection).
const EN_WORDS: Record<string, GateCategory> = {
  buy: 'purchase', purchase: 'purchase', checkout: 'purchase', 'check out': 'purchase', pay: 'purchase', 'place order': 'purchase',
  'order now': 'purchase', 'complete order': 'purchase', subscribe: 'purchase', 'add payment': 'payment', donate: 'purchase',
  send: 'send', post: 'send', publish: 'send', tweet: 'send', share: 'send', reply: 'send', submit: 'send', comment: 'send',
  delete: 'delete', remove: 'delete', erase: 'delete', destroy: 'delete', 'empty trash': 'delete', unsubscribe: 'delete',
  transfer: 'transfer', withdraw: 'transfer',
};
const FI_STEMS: Record<string, GateCategory> = {
  osta: 'purchase', maksa: 'purchase', tilaa: 'purchase', kassalle: 'purchase', 'vahvista tilaus': 'purchase', lahjoita: 'purchase',
  lähetä: 'send', julkaise: 'send', jaa: 'send', vastaa: 'send', kommentoi: 'send',
  poista: 'delete', tyhjennä: 'delete',
  siirrä: 'transfer', 'nosta rahaa': 'transfer',
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Risky categories implied by an element's accessible name. */
export function riskyWords(name: string): { word: string; category: GateCategory }[] {
  const n = name.toLowerCase();
  const out: { word: string; category: GateCategory }[] = [];
  for (const [w, c] of Object.entries(EN_WORDS)) {
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(w)}($|[^\\p{L}])`, 'u').test(n)) out.push({ word: w, category: c });
  }
  for (const [w, c] of Object.entries(FI_STEMS)) {
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(w)}`, 'u').test(n)) out.push({ word: w, category: c });
  }
  return out;
}

function add(v: Verdict, c: GateCategory, reason: string) {
  if (!v.categories.includes(c)) v.categories.push(c);
  v.reasons.push(reason);
  v.requireConfirm = true;
}

export function evaluateGate(s: ActionSignals, model: ModelSignal[] = []): Verdict {
  const v: Verdict = { allow: true, requireConfirm: false, categories: [], reasons: [] };

  if (s.action === 'navigate') {
    let proto = '';
    try {
      proto = new URL(s.url ?? '').protocol;
    } catch {
      v.allow = false;
      v.reasons.push('invalid URL');
      return v;
    }
    if (proto !== 'http:' && proto !== 'https:') {
      v.allow = false;
      v.reasons.push(`only http(s) navigation is allowed, got ${proto}`);
      return v;
    }
  }

  if (s.action === 'type') {
    if (s.fieldKind === 'password') add(v, 'credentials', 'typing into a password field');
    if (s.fieldKind === 'payment') add(v, 'payment', 'typing into a payment field');
    if (s.fieldKind === 'otp') add(v, '2fa', 'typing a one-time code');
  }

  const activatesSubmit = (s.action === 'click' || (s.action === 'press' && s.key === 'Enter')) && s.submitsForm;
  if (activatesSubmit) {
    if (s.formHasPassword) add(v, 'credentials', 'submits a form with a password');
    if (s.formHasPayment) add(v, 'payment', 'submits a form with payment details');
    if (s.formHasFile) add(v, 'send', 'submits a form with a file upload');
    if (s.formMethod === 'post' && !s.formHasPassword && !s.formHasPayment) add(v, 'submit', 'submits a POST form');
  }

  if (s.action === 'press' && s.key === 'Enter' && s.multiline) add(v, 'send', 'Enter in a message box may send it');

  if (s.action === 'click') {
    for (const { word, category } of riskyWords(s.name)) add(v, category, `"${s.name}" looks like ${category} ("${word}")`);
    if (s.linkDownload) add(v, 'download', 'starts a download');
  }

  // Model signals: monotonic. They can add a confirmation; they can never clear one.
  for (const m of model) {
    if (m.probability >= MODEL_THRESHOLD) add(v, m.category, `classifier: ${m.category} p=${m.probability.toFixed(2)}`);
  }
  return v;
}

export function describeVerdict(v: Verdict): string {
  if (!v.allow) return `blocked: ${v.reasons.join('; ')}`;
  if (v.requireConfirm) return `needs confirmation (${v.categories.join(', ')}): ${v.reasons.join('; ')}`;
  return 'allowed';
}
