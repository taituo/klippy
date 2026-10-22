// Service worker: connects out to the local klippy-mcp bridge, runs tools, owns the hands
// and enforces the GatePolicy. The brain (whatever drives the bridge) can only ask; the body decides.
import { describeVerdict, evaluateGate, type ActionSignals } from '../shared/gate';
import type { ContentRequest, ContentResponse, TargetResult } from '../shared/messages';
import { DEFAULT_BRIDGE_PORT, PROTOCOL_VERSION, type BridgeToExt, type ExtToBridge } from '../shared/bridge-protocol';
import { DebuggerHands, isSupportedKey } from './hands';

declare const chrome: any;

const VERSION: string = chrome.runtime.getManifest().version;
const hands = new DebuggerHands();

// ---------------------------------------------------------------------------
// Content script plumbing

class ContentGone extends Error {}

async function toContent<T>(tabId: number, msg: ContentRequest, retry = true): Promise<T> {
  let res: ContentResponse<T> | undefined;
  try {
    res = await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (retry && /Receiving end does not exist|Could not establish connection/.test(m)) {
      await injectContent(tabId);
      return toContent<T>(tabId, msg, false);
    }
    // The page navigated away (or the tab closed) while we were waiting.
    throw new ContentGone(m);
  }
  if (!res) throw new ContentGone('no response from page');
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

async function injectContent(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    throw new Error(`Klippy cannot run on this page (${(e as Error).message}). Browser-internal pages like chrome:// are off limits.`);
  }
}

async function resolveTab(args: Record<string, unknown>): Promise<number> {
  if (typeof args.tabId === 'number') return args.tabId;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) return tab.id;
  const [any] = await chrome.tabs.query({ active: true });
  if (any?.id === undefined) throw new Error('No active tab.');
  return any.id;
}

function waitForLoad(tabId: number, timeoutMs = 15000): Promise<{ url: string; title: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      const t = await chrome.tabs.get(tabId).catch(() => null);
      resolve({ url: t?.url ?? '', title: t?.title ?? '' });
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.get(tabId).then((t: { status?: string }) => {
      if (t.status === 'complete') setTimeout(() => chrome.tabs.get(tabId).then((t2: { status?: string }) => t2.status === 'complete' && finish()), 150);
    });
  });
}

// ---------------------------------------------------------------------------
// Gates

async function gate(tabId: number, label: string, signals: ActionSignals, verb: string): Promise<string | null> {
  const verdict = evaluateGate(signals);
  if (!verdict.allow) throw new Error(`Klippy blocked this: ${describeVerdict(verdict)}`);
  if (!verdict.requireConfirm) return null;
  const question = `Allow Klippy to ${verb} ${label}? (${verdict.categories.join(', ')})`;
  const allowed = await toContent<boolean>(tabId, { op: 'confirm', question });
  if (!allowed) throw new Error(`The user denied: ${verb} ${label} — ${verdict.reasons.join('; ')}`);
  return `confirmed by user (${verdict.categories.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Change tracking around an action

/** Resolves when the tab starts a real (document) navigation. SPA pushState does not count. */
function navigationStarted(tabId: number): { promise: Promise<'navigated'>; cancel: () => void } {
  let listener: (id: number, info: { status?: string }) => void = () => {};
  const promise = new Promise<'navigated'>((resolve) => {
    listener = (id, info) => {
      if (id === tabId && info.status === 'loading') resolve('navigated');
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  return { promise, cancel: () => chrome.tabs.onUpdated.removeListener(listener) };
}

async function afterAction(tabId: number, urlBefore: string, nav: ReturnType<typeof navigationStarted>): Promise<string> {
  try {
    const r = await Promise.race([toContent<{ text: string }>(tabId, { op: 'endChange' }, false), nav.promise]);
    if (r !== 'navigated') return r.text;
  } catch (e) {
    if (!(e instanceof ContentGone)) throw e;
  } finally {
    nav.cancel();
  }
  // The old page (and its content script) is gone: report the navigation instead of a diff.
  const t = await waitForLoad(tabId);
  return `url: ${urlBefore} → ${t.url}\ntitle: "${t.title}"\n(new page loaded — take a snapshot)`;
}

async function tabUrl(tabId: number): Promise<string> {
  return (await chrome.tabs.get(tabId)).url ?? '';
}

/** Runs an input action between a "before" picture and the settled "after" diff. */
async function withChanges(tabId: number, act: () => Promise<string>): Promise<{ input: string; changes: string }> {
  const urlBefore = await tabUrl(tabId);
  await toContent(tabId, { op: 'beginChange' });
  const nav = navigationStarted(tabId);
  try {
    const input = await act();
    const changes = await afterAction(tabId, urlBefore, nav);
    return { input, changes };
  } finally {
    nav.cancel();
  }
}

function report(what: string, input: string, note: string | null, changes: string): string {
  return [what, `input: ${input}`, ...(note ? [note] : []), '', changes].join('\n');
}

// ---------------------------------------------------------------------------
// Tools

type Args = Record<string, unknown>;

function int(args: Args, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`"${key}" must be an integer`);
  return v;
}

function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`"${key}" must be a string`);
  return v;
}

async function runTool(tool: string, args: Args): Promise<string> {
  switch (tool) {
    case 'tabs': {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t: any) => `[${t.id}]${t.active ? ' (active)' : ''} ${t.title ?? ''} — ${t.url ?? ''}`).join('\n') || '(no tabs)';
    }
    case 'snapshot': {
      const tabId = await resolveTab(args);
      return toContent<string>(tabId, {
        op: 'snapshot',
        maxItems: typeof args.maxItems === 'number' ? args.maxItems : undefined,
        includeText: typeof args.includeText === 'boolean' ? args.includeText : undefined,
      });
    }
    case 'read_html': {
      const tabId = await resolveTab(args);
      return toContent<string>(tabId, { op: 'readHtml', id: int(args, 'id'), maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined });
    }
    case 'point': {
      const tabId = await resolveTab(args);
      const t = await toContent<TargetResult>(tabId, { op: 'target', id: int(args, 'id'), action: 'click' });
      await toContent(tabId, { op: 'moveCursor', x: t.x, y: t.y });
      return `pointing at ${t.label}${t.occludedBy ? ` (note: covered by ${t.occludedBy})` : ''}`;
    }
    case 'highlight': {
      const tabId = await resolveTab(args);
      const ids = Array.isArray(args.ids) ? args.ids.filter((x): x is number => Number.isInteger(x)) : [];
      if (!ids.length) throw new Error('"ids" must be a non-empty array of element ids');
      const r = await toContent<{ shown: number; missing: number[] }>(tabId, {
        op: 'highlight',
        ids,
        label: typeof args.label === 'string' ? args.label : undefined,
      });
      return `highlighted ${r.shown} element(s)${r.missing.length ? `; not found: ${r.missing.map((i) => `[${i}]`).join(', ')}` : ''}`;
    }
    case 'clear_highlights': {
      const tabId = await resolveTab(args);
      await toContent(tabId, { op: 'clearHighlights' });
      return 'cleared';
    }
    case 'say': {
      const tabId = await resolveTab(args);
      await toContent(tabId, { op: 'say', text: str(args, 'text').slice(0, 500) });
      return 'said';
    }
    case 'click': {
      const tabId = await resolveTab(args);
      const id = int(args, 'id');
      const t = await toContent<TargetResult>(tabId, { op: 'target', id, action: 'click' });
      if (t.occludedBy) throw new Error(`${t.label} is covered by ${t.occludedBy}. Deal with that first (e.g. close it), then snapshot again.`);
      const note = await gate(tabId, t.label, t.signals, 'click');
      const { input, changes } = await withChanges(tabId, async () => {
        const path = await toContent<[number, number][]>(tabId, { op: 'moveCursor', x: t.x, y: t.y });
        let input = 'cdp';
        try {
          await hands.click(tabId, path, t.x, t.y);
        } catch (e) {
          input = `synthetic (untrusted; CDP unavailable: ${(e as Error).message})`;
          await toContent(tabId, { op: 'syntheticClick', id });
        }
        toContent(tabId, { op: 'clickFx' }, false).catch(() => {});
        return input;
      });
      return report(`clicked ${t.label}`, input, note, changes);
    }
    case 'type': {
      const tabId = await resolveTab(args);
      const id = int(args, 'id');
      const text = str(args, 'text');
      const clear = args.clear !== false;
      const t = await toContent<TargetResult>(tabId, { op: 'target', id, action: 'type' });
      if (t.signals.fieldKind === null && t.signals.role !== 'textbox' && t.signals.role !== 'searchbox' && t.signals.role !== 'combobox') {
        throw new Error(`${t.label} is not a text field.`);
      }
      const note = await gate(tabId, t.label, t.signals, 'type into');
      const { input, changes } = await withChanges(tabId, async () => {
        await toContent(tabId, { op: 'moveCursor', x: t.x, y: t.y });
        try {
          const focused = await toContent<boolean>(tabId, { op: 'prepareType', id, clear });
          if (!focused) throw new Error('could not focus the field');
          if (clear && !text) await hands.key(tabId, 'Backspace');
          else await hands.insertText(tabId, text);
          return 'cdp';
        } catch (e) {
          await toContent(tabId, { op: 'syntheticType', id, text, clear });
          return `synthetic (untrusted; ${(e as Error).message})`;
        }
      });
      return report(`typed into ${t.label}`, input, note, changes);
    }
    case 'press': {
      const tabId = await resolveTab(args);
      const key = str(args, 'key');
      if (!isSupportedKey(key)) throw new Error(`Unsupported key "${key}".`);
      const f = await toContent<{ label: string; signals: ActionSignals }>(tabId, { op: 'focusInfo', key });
      const note = await gate(tabId, f.label, f.signals, `press ${key} in`);
      const { input, changes } = await withChanges(tabId, async () => {
        try {
          await hands.key(tabId, key);
          return 'cdp';
        } catch (e) {
          await toContent(tabId, { op: 'syntheticKey', key });
          return `synthetic (untrusted; ${(e as Error).message})`;
        }
      });
      return report(`pressed ${key} in ${f.label}`, input, note, changes);
    }
    case 'scroll': {
      const tabId = await resolveTab(args);
      const direction = str(args, 'direction');
      if (!['up', 'down', 'top', 'bottom'].includes(direction)) throw new Error('direction must be up, down, top or bottom');
      const r = await toContent<{ y: number; max: number }>(tabId, { op: 'scroll', direction: direction as 'up' });
      return `scrolled ${direction}: y=${r.y} of ${r.max}`;
    }
    case 'navigate': {
      const tabId = await resolveTab(args);
      const url = str(args, 'url');
      const verdict = evaluateGate({
        action: 'navigate', url, role: '', name: '', tag: '', inForm: false, formMethod: null, submitsForm: false,
        formHasPassword: false, formHasPayment: false, formHasFile: false, fieldKind: null, multiline: false, linkDownload: false, pageOrigin: '',
      });
      if (!verdict.allow) throw new Error(`Klippy blocked this: ${describeVerdict(verdict)}`);
      await chrome.tabs.update(tabId, { url });
      await new Promise((r) => setTimeout(r, 100));
      const t = await waitForLoad(tabId);
      return `navigated to ${t.url}\ntitle: "${t.title}"`;
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

// One action at a time: the cursor can only be in one place.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// ---------------------------------------------------------------------------
// Bridge connection (extension is the WebSocket client; the bridge listens on 127.0.0.1)

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let backoff = 1000;

async function setStatus(status: string) {
  await chrome.storage.local.set({ bridgeStatus: status, bridgeStatusAt: Date.now() });
}

async function connect() {
  clearTimeout(reconnectTimer);
  const { bridgePort = DEFAULT_BRIDGE_PORT, bridgeToken = '' } = await chrome.storage.local.get(['bridgePort', 'bridgeToken']);
  if (!bridgeToken) {
    await setStatus('not configured: set the bridge token in Klippy options');
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const sock = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  ws = sock;
  sock.onopen = () => {
    const hello: ExtToBridge = { type: 'hello', token: bridgeToken, protocol: PROTOCOL_VERSION, version: VERSION, extensionId: chrome.runtime.id };
    sock.send(JSON.stringify(hello));
  };
  sock.onmessage = (ev) => {
    let msg: BridgeToExt;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      backoff = 1000;
      setStatus(`connected to bridge on port ${bridgePort}`);
      clearInterval(pingTimer);
      // Keep the service worker alive while connected (Chrome extends SW lifetime on WebSocket activity).
      pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ type: 'ping' })), 20000);
    } else if (msg.type === 'call') {
      const { id, tool, args } = msg;
      enqueue(() => runTool(tool, args ?? {})).then(
        (text) => sock.send(JSON.stringify({ type: 'result', id, ok: true, text } satisfies ExtToBridge)),
        (err: unknown) => sock.send(JSON.stringify({ type: 'result', id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ExtToBridge)),
      );
    }
  };
  sock.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ws === sock) ws = null;
    setStatus(ev.code === 4001 ? 'rejected by bridge: wrong token' : 'disconnected (is klippy-mcp running?)');
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
  sock.onerror = () => {};
}

chrome.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
  if (area === 'local' && ('bridgePort' in changes || 'bridgeToken' in changes)) {
    ws?.close();
    ws = null;
    backoff = 1000;
    connect();
  }
});

// Wake up periodically so a killed service worker reconnects.
chrome.alarms.create('klippy-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a: { name: string }) => {
  if (a.name === 'klippy-reconnect') connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

chrome.action.onClicked.addListener(async (tab: { id?: number }) => {
  if (tab.id === undefined) return;
  const { bridgeStatus = '' } = await chrome.storage.local.get(['bridgeStatus']);
  await toContent(tab.id, { op: 'say', text: `Hi, I'm Klippy. Bridge: ${bridgeStatus || 'unknown'}.` }).catch(() => {});
});

connect();
