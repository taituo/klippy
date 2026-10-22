// End to end: real Chromium + the Klippy extension + klippy-mcp, driven over MCP like an agent would.
import { test, expect, chromium, type BrowserContext, type CDPSession, type Page, type Worker } from 'playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from './helpers/mcp-client';
import { serveFixtures } from './helpers/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(here, '..', 'dist', 'extension');
const BRIDGE = path.join(here, '..', 'dist', 'bridge', 'klippy-mcp.js');
const TOKEN = 'test-token-123';

let server: Awaited<ReturnType<typeof serveFixtures>>;
let mcp: McpClient;
let ctx: BrowserContext;
let page: Page;
let profile: string;
let sw: Worker;
let bridgePort: number;

test.describe.configure({ mode: 'serial' });

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

function idOf(snapshot: string, pattern: RegExp): number {
  const line = snapshot.split('\n').find((l) => pattern.test(l));
  if (!line) throw new Error(`no line matches ${pattern}\n${snapshot}`);
  return Number(/^\[(\d+)\]/.exec(line)![1]);
}

async function snapshot(): Promise<string> {
  const r = await mcp.call('snapshot', { maxItems: 1000 });
  expect(r.isError, r.text).toBe(false);
  return r.text;
}

type DomNode = { nodeId: number; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[] };

function findNode(n: DomNode, pred: (n: DomNode) => boolean): DomNode | null {
  if (pred(n)) return n;
  for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) {
    const r = findNode(c, pred);
    if (r) return r;
  }
  return null;
}

/** Finds Klippy's confirm button inside the closed shadow root (DevTools can see it; page scripts cannot). */
async function confirmButtonCenter(cdp: CDPSession, action: 'allow' | 'deny'): Promise<{ x: number; y: number } | null> {
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const node = findNode(root, (n) => {
    const a = n.attributes ?? [];
    const i = a.indexOf('data-klippy-action');
    return i >= 0 && a[i + 1] === action;
  });
  if (!node) return null;
  const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: { content: number[] } };
  const q = model.content;
  return { x: (q[0]! + q[4]!) / 2, y: (q[1]! + q[5]!) / 2 };
}

async function answerConfirm(action: 'allow' | 'deny', before?: (pt: { x: number; y: number }) => Promise<void>) {
  const cdp = await ctx.newCDPSession(page);
  try {
    let pt: { x: number; y: number } | null = null;
    await expect.poll(async () => (pt = await confirmButtonCenter(cdp, action)) !== null, { timeout: 10000 }).toBe(true);
    if (before) await before(pt!);
    await page.mouse.click(pt!.x, pt!.y); // a real, trusted click by "the user"
  } finally {
    await cdp.detach().catch(() => {});
  }
}


async function configure(port: number, token: string) {
  await sw.evaluate(([p, t]) => (globalThis as any).chrome.storage.local.set({ bridgePort: p, bridgeToken: t }), [port, token] as const);
}

async function bridgeStatus(): Promise<string> {
  return sw.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('bridgeStatus')).bridgeStatus as string) ?? '');
}

test.beforeAll(async () => {
  server = await serveFixtures(path.join(here, 'fixtures'));
  bridgePort = await freePort();
  mcp = new McpClient(process.execPath, [BRIDGE], { KLIPPY_PORT: String(bridgePort), KLIPPY_TOKEN: TOKEN });
  await mcp.initialize();

  profile = await mkdtemp(path.join(os.tmpdir(), 'klippy-e2e-'));
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  // Extension APIs are bound slightly after the worker starts.
  await expect.poll(() => sw.evaluate(() => !!(globalThis as any).chrome?.storage?.local), { timeout: 10000 }).toBe(true);
  await configure(bridgePort, TOKEN);
  await expect.poll(async () => (await mcp.call('status')).text, { timeout: 20000 }).toContain('connected: Klippy extension');

  page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${server.url}/basic.html`);
  await page.bringToFront();
});

test.afterAll(async () => {
  await ctx?.close();
  mcp?.close();
  await server?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('the bridge sees the extension and the tabs', async () => {
  const tabs = await mcp.call('tabs');
  expect(tabs.text).toContain('basic.html');
  expect(tabs.text).toContain('(active)');
});

test('a web page cannot connect to the bridge', async () => {
  const result = await page.evaluate(
    (p) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${p}`);
        ws.onopen = () => resolve('open');
        ws.onerror = () => resolve('refused');
      }),
    bridgePort,
  );
  expect(result).toBe('refused');
  expect((await mcp.call('status')).text).toContain('connected: Klippy extension');
});

test('a wrong token is rejected', async () => {
  const port = await freePort();
  const other = new McpClient(process.execPath, [BRIDGE], { KLIPPY_PORT: String(port), KLIPPY_TOKEN: 'a-different-token' });
  await other.initialize();
  try {
    await configure(port, TOKEN); // our token, their bridge
    await expect.poll(() => bridgeStatus(), { timeout: 10000 }).toContain('wrong token');
    expect((await other.call('status')).text).toContain('not connected');
    expect(other.stderr.join('\n')).toContain('wrong token');
  } finally {
    await configure(bridgePort, TOKEN);
    other.close();
  }
  await expect.poll(async () => (await mcp.call('status')).text, { timeout: 20000 }).toContain('connected: Klippy extension');
});

test('snapshot over MCP', async () => {
  const s = await snapshot();
  expect(s).toContain('title: Klippy fixture');
  expect(s).toMatch(/button "Toggle save"/);
});

test('click uses trusted CDP input and returns what changed', async () => {
  const s = await snapshot();
  const toggle = idOf(s, /button "Toggle save"/);
  const save = idOf(s, /button "Save"/);
  const r = await mcp.call('click', { id: toggle });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain('input: cdp');
  expect(r.text).toContain(`~ [${save}] button "Save"  +disabled`);
  await expect(page.locator('#save')).toBeDisabled();
});

test('type replaces a field value', async () => {
  const s = await snapshot();
  const name = idOf(s, /textbox "Your name"/);
  const r = await mcp.call('type', { id: name, text: 'Grace' });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain('input: cdp');
  expect(r.text).toContain('value: "Ada" → "Grace"');
  await expect(page.locator('#name')).toHaveValue('Grace');
});

test('Enter in a GET search form needs no confirmation', async () => {
  const s = await snapshot();
  const q = idOf(s, /searchbox "Search products"/);
  expect((await mcp.call('type', { id: q, text: 'lamp' })).isError).toBe(false);
  const r = await mcp.call('press', { key: 'Enter' });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toMatch(/- \[\d+\] text "No results"/);
  expect(r.text).toMatch(/\+ \[\d+\] text "lamp result 1"/);
});

test('point, highlight and say', async () => {
  const s = await snapshot();
  const save = idOf(s, /button "Save"/);
  const order = idOf(s, /button "Place order"/);
  expect((await mcp.call('point', { id: save })).text).toContain('pointing at');
  expect((await mcp.call('highlight', { ids: [save, order, 99999], label: 'Look' })).text).toBe('highlighted 2 element(s); not found: [99999]');
  expect((await mcp.call('say', { text: 'Hei! Tässä Klippy.' })).text).toBe('said');
  expect((await mcp.call('clear_highlights')).text).toBe('cleared');
});

test('a risky click waits for the user to allow it', async () => {
  const s = await snapshot();
  const order = idOf(s, /button "Place order"/);
  const pending = mcp.call('click', { id: order });
  await answerConfirm('allow');
  const r = await pending;
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain('confirmed by user (purchase)');
  expect(r.text).toMatch(/status "Order placed"|name: "" → "Order placed"|text "Order placed"/);
  await expect(page.locator('#status')).toHaveText('Order placed');
});

test('a denied click is an error and nothing happens', async () => {
  const s = await snapshot();
  const del = idOf(s, /button "Delete account"/);
  const pending = mcp.call('click', { id: del });
  await answerConfirm('deny');
  const r = await pending;
  expect(r.isError).toBe(true);
  expect(r.text).toContain('The user denied');
  await expect(page.locator('#status')).toHaveText('Order placed');
});

test('page scripts cannot press the confirm button', async () => {
  const s = await snapshot();
  const send = idOf(s, /button "Lähetä viesti"/);
  const pending = mcp.call('click', { id: send });
  await answerConfirm('deny', async (pt) => {
    // Before the real user answers, the page tries to click "Allow" itself.
    const outcome = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      el?.click();
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y }));
      return el?.localName ?? 'none';
    }, pt);
    expect(outcome).toBe('klippy-overlay'); // all the page can reach is the closed host element
    await page.waitForTimeout(200);
  });
  const r = await pending;
  expect(r.isError).toBe(true);
  expect(r.text).toContain('The user denied');
});

test('a covered element is reported instead of clicked', async () => {
  let s = await snapshot();
  const covered = idOf(s, /button "Covered button"/);
  const r = await mcp.call('click', { id: covered });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('covered by');
  expect(r.text).toContain('Cookie banner');
  const accept = idOf(s, /button "Accept cookies"/);
  const a = await mcp.call('click', { id: accept });
  expect(a.text).toMatch(/- \[\d+\] button "Accept cookies"/);
  s = await snapshot();
  const ok = await mcp.call('click', { id: idOf(s, /button "Covered button"/) });
  expect(ok.isError, ok.text).toBe(false);
});

test('clicking a link reports the navigation', async () => {
  const s = await snapshot();
  const link = idOf(s, /link "Second page"/);
  const r = await mcp.call('click', { id: link });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toMatch(/url: .*basic\.html → .*page2\.html/);
  const s2 = await snapshot();
  expect(s2).toMatch(/heading\(1\) "Second page"/);
});

test('navigate allows http(s) only', async () => {
  const bad = await mcp.call('navigate', { url: 'javascript:alert(1)' });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('blocked');
  const ok = await mcp.call('navigate', { url: `${server.url}/basic.html` });
  expect(ok.isError, ok.text).toBe(false);
  expect(ok.text).toContain('title: "Klippy fixture"');
});
