// Eyes: page map, names, diff and read_html, tested by injecting the standalone bundle.
import { test, expect, type Page } from 'playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveFixtures } from './helpers/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const EYES = path.join(here, '..', 'dist', 'eyes.iife.js');
let server: Awaited<ReturnType<typeof serveFixtures>>;

test.beforeAll(async () => {
  server = await serveFixtures(path.join(here, 'fixtures'));
});
test.afterAll(async () => server.close());

declare global {
  // eslint-disable-next-line no-var
  var __klippyEyes: typeof import('../src/eyes/index');
}

async function open(page: Page) {
  await page.goto(`${server.url}/basic.html`);
  await page.addScriptTag({ path: EYES });
}

const snap = (page: Page) => page.evaluate(() => __klippyEyes.snapshot());

/** Finds the id of the first line matching the pattern. */
function idOf(snapshot: string, pattern: RegExp): number {
  const line = snapshot.split('\n').find((l) => pattern.test(l));
  if (!line) throw new Error(`no line matches ${pattern}\n${snapshot}`);
  return Number(/^\[(\d+)\]/.exec(line)![1]);
}

async function act(page: Page, fn: () => Promise<void>): Promise<string> {
  await page.evaluate(() => __klippyEyes.beginChange());
  await fn();
  return page.evaluate(() => __klippyEyes.endChange({ quietMs: 150 }).then((r) => r.text));
}

test('snapshot lists visible controls, headings and text; skips hidden ones', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  expect(s).toContain('title: Klippy fixture');
  expect(s).toMatch(/\] heading\(1\) "Shop"/);
  expect(s).toMatch(/\] button "Save"/);
  expect(s).toMatch(/\] link "Second page" → \/page2\.html/);
  expect(s).toMatch(/\] link "External docs" → example\.org\/docs/);
  expect(s).toMatch(/\] text "Plain paragraph text"/);
  expect(s).not.toContain('Hidden by CSS');
  expect(s).not.toContain('Hidden by aria');
  expect(s).not.toContain('Invisible button');
  expect(s).toMatch(/\] button "Shadow button"/); // open shadow root
  expect(s).toMatch(/\] button "Far down button" \(offscreen\)/);
});

test('accessible names, values and states', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  expect(s).toMatch(/\] textbox "Your name" value="Ada"/);
  expect(s).toMatch(/\] textbox "Email address"/);
  expect(s).toMatch(/\] button "Close panel"/);
  expect(s).toMatch(/\] button "Settings"/); // svg aria-label inside an icon button
  expect(s).toMatch(/\] checkbox "Remember me"/);
  expect(s).toMatch(/\] combobox "Size" value="Medium"/);
  expect(s).toMatch(/\] textbox "Password" value="••••" password/);
  expect(s).not.toContain('hunter2');
  expect(s).toMatch(/\] status/);
});

test('ids stay stable across snapshots', async ({ page }) => {
  await open(page);
  const a = await snap(page);
  const b = await snap(page);
  expect(idOf(a, /button "Save"/)).toBe(idOf(b, /button "Save"/));
  expect(a.split('\n').slice(3)).toEqual(b.split('\n').slice(3));
});

test('diff: state change on another element', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  const save = idOf(s, /button "Save"/);
  const diff = await act(page, () => page.click('#toggle'));
  expect(diff).toContain(`~ [${save}] button "Save"  +disabled`);
  expect(diff).toMatch(/focus: \[\d+\] button "Toggle save"/);
});

test('diff: a dialog appears', async ({ page }) => {
  await open(page);
  await snap(page);
  const diff = await act(page, () => page.click('#open-dialog'));
  expect(diff).toMatch(/\+ \[\d+\] dialog "Confirm action"/);
  expect(diff).toMatch(/\+ \[\d+\] button "OK"/);
});

test('diff: results replace the empty-state text', async ({ page }) => {
  await open(page);
  await snap(page);
  await page.fill('#q', 'lamp');
  const diff = await act(page, () => page.press('#q', 'Enter'));
  expect(diff).toMatch(/- \[\d+\] text "No results"/);
  expect(diff).toMatch(/\+ \[\d+\] text "lamp result 1"/);
  expect(diff).toMatch(/\+ \[\d+\] text "lamp result 3"/);
});

test('diff: re-rendered node is matched by fingerprint, not reported as add/remove', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  const like = idOf(s, /button "Like"/);
  const diff = await act(page, () => page.click('#like'));
  expect(diff).toMatch(new RegExp(`~ \\[\\d+\\] \\(was \\[${like}\\]\\) button "Like"  \\+pressed`));
  expect(diff).not.toMatch(/^[+-] .*"Like"/m);
});

test('diff: an action that changes nothing says so', async ({ page }) => {
  await open(page);
  await page.focus('#noop');
  await snap(page);
  const diff = await act(page, () => page.click('#noop'));
  expect(diff).toBe('no visible change');
});

test('read_html is cleaned and annotated', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  const form = idOf(s, /textbox "Password"/);
  const html = await page.evaluate((id) => {
    const pw = __klippyEyes.elementFor(id)!;
    const formId = __klippyEyes.idFor(pw.closest('form')!);
    return __klippyEyes.readHtml(formId);
  }, form);
  expect(html).toContain('<form');
  expect(html).toContain('method="post"');
  expect(html).not.toContain('onsubmit');
  expect(html).not.toContain('hunter2');
  expect(html).toContain('value="••••"');
  expect(html).toMatch(new RegExp(`data-k="${form}"`));
  const truncated = await page.evaluate(() => __klippyEyes.readHtml(__klippyEyes.idFor(document.body), 300));
  expect(truncated).toMatch(/…\[truncated \d+ chars\]$/);
  expect(truncated).not.toContain('<script');
});

test('target detects an element covered by something else', async ({ page }) => {
  await open(page);
  const s = await snap(page);
  const covered = idOf(s, /button "Covered button"/);
  const info = await page.evaluate((id) => __klippyEyes.target(id), covered);
  expect(info.occludedBy).toContain('Cookie banner');
  const far = idOf(s, /button "Far down button"/);
  const t = await page.evaluate((id) => __klippyEyes.target(id), far);
  expect(t.occludedBy).toBeUndefined();
  expect(t.y).toBeGreaterThan(0);
  expect(t.y).toBeLessThan(800);
});
