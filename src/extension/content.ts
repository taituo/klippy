// Content script: the eyes and the overlay, living in every page.
// It never acts with trusted input itself; real input comes from the service worker via CDP.
import * as eyes from '../eyes/index';
import { Overlay } from '../overlay/overlay';
import type { ContentRequest, ContentResponse, TargetResult } from '../shared/messages';

declare const chrome: any;

// Avoid double-initialisation when the service worker injects us into a tab that already has us.
const G = globalThis as unknown as { __klippyContent?: boolean };
if (!G.__klippyContent) {
  G.__klippyContent = true;
  init();
}

function init() {
  let overlay: Overlay | null = null;
  const ui = () => (overlay ??= new Overlay());

  function el(id: number): Element {
    const e = eyes.elementFor(id);
    if (!e) throw new Error(`No element with id [${id}] on this page (it may have been removed). Take a new snapshot.`);
    return e;
  }

  function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    // React and friends track the value setter; use the prototype setter so they notice.
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function handle(msg: ContentRequest): Promise<unknown> {
    switch (msg.op) {
      case 'ping':
        return 'pong';
      case 'snapshot':
        return eyes.snapshot({ maxItems: msg.maxItems, includeText: msg.includeText });
      case 'readHtml':
        return eyes.readHtml(msg.id, msg.maxChars);
      case 'describe':
        return eyes.describe(msg.id);
      case 'target': {
        const t = await eyes.target(msg.id);
        const res: TargetResult = {
          x: t.x,
          y: t.y,
          label: eyes.describe(msg.id),
          occludedBy: t.occludedBy,
          signals: eyes.collectSignals(el(msg.id), msg.action),
        };
        if (!res.occludedBy && overlay?.coversPoint(t.x, t.y)) res.occludedBy = 'the Klippy character (move it)';
        return res;
      }
      case 'focusInfo': {
        let a: Element | null = document.activeElement;
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        const target = a && a !== document.body ? a : document.body;
        return { label: target === document.body ? 'page' : eyes.describe(eyes.idFor(target)), signals: eyes.collectSignals(target, 'press', { key: msg.key }) };
      }
      case 'moveCursor':
        return ui().moveCursor(msg.x, msg.y);
      case 'clickFx':
        ui().clickFx();
        return null;
      case 'hideCursor':
        overlay?.hideCursor();
        return null;
      case 'beginChange':
        eyes.beginChange();
        return null;
      case 'endChange':
        return eyes.endChange({ quietMs: msg.quietMs, maxMs: msg.maxMs }).then((r) => ({ text: r.text, empty: r.empty }));
      case 'highlight': {
        const found: Element[] = [];
        const missing: number[] = [];
        for (const id of msg.ids) {
          const e = eyes.elementFor(id);
          if (e) found.push(e);
          else missing.push(id);
        }
        ui().highlight(found, msg.label);
        return { shown: found.length, missing };
      }
      case 'clearHighlights':
        overlay?.clearHighlights();
        return null;
      case 'say':
        ui().say(msg.text);
        return null;
      case 'confirm':
        return ui().confirm(msg.question, { timeoutMs: msg.timeoutMs });
      case 'prepareType': {
        const e = el(msg.id) as HTMLElement;
        e.focus();
        if (msg.clear) {
          if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) e.select();
          else if (e.isContentEditable) {
            const range = document.createRange();
            range.selectNodeContents(e);
            const sel = getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
        return document.activeElement === e || e.contains(document.activeElement);
      }
      case 'syntheticClick': {
        const e = el(msg.id) as HTMLElement;
        const r = e.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        e.dispatchEvent(new PointerEvent('pointerdown', init));
        e.dispatchEvent(new MouseEvent('mousedown', init));
        e.focus?.();
        e.dispatchEvent(new PointerEvent('pointerup', init));
        e.dispatchEvent(new MouseEvent('mouseup', init));
        e.click();
        return null;
      }
      case 'syntheticType': {
        const e = el(msg.id);
        if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
          e.focus();
          setNativeValue(e, (msg.clear ? '' : e.value) + msg.text);
        } else if ((e as HTMLElement).isContentEditable) {
          (e as HTMLElement).focus();
          if (msg.clear) e.textContent = '';
          document.execCommand('insertText', false, msg.text);
        } else throw new Error(`${eyes.describe(msg.id)} is not a text field`);
        return null;
      }
      case 'syntheticKey': {
        const t = (document.activeElement ?? document.body) as HTMLElement;
        const init = { key: msg.key, bubbles: true, cancelable: true, composed: true };
        t.dispatchEvent(new KeyboardEvent('keydown', init));
        if (msg.key === 'Enter') {
          const form = (t as HTMLInputElement).form;
          if (form) form.requestSubmit();
        }
        t.dispatchEvent(new KeyboardEvent('keyup', init));
        return null;
      }
      case 'scroll': {
        const h = innerHeight * 0.8;
        if (msg.direction === 'top') scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        else if (msg.direction === 'bottom') scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior });
        else scrollBy({ top: msg.direction === 'down' ? h : -h, behavior: 'instant' as ScrollBehavior });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const max = document.documentElement.scrollHeight - innerHeight;
        return { y: Math.round(scrollY), max: Math.max(0, Math.round(max)) };
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender: unknown, sendResponse: (r: ContentResponse) => void) => {
    handle(msg).then(
      (value) => sendResponse({ ok: true, value }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });
}
