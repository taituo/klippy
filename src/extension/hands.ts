// Hands: real input through chrome.debugger (CDP inside the extension, no open port).
// CDP input events are trusted (isTrusted) and never move the user's own mouse.
// If attaching fails (chrome:// pages, enterprise policy, another debugger), callers fall back
// to synthetic DOM events in the content script and say so in the result.

declare const chrome: any;

type Point = [number, number];

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
};

export function isSupportedKey(key: string): boolean {
  return key in KEYS;
}

const IDLE_DETACH_MS = 20000;

export class DebuggerHands {
  private attached = new Set<number>();
  private idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    chrome.debugger.onDetach.addListener((source: { tabId?: number }) => {
      if (source.tabId !== undefined) this.attached.delete(source.tabId);
    });
  }

  private async ensure(tabId: number): Promise<void> {
    if (!this.attached.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attached.add(tabId);
    }
    clearTimeout(this.idleTimers.get(tabId));
    // Detach when idle so Chrome's "is debugging this browser" bar does not linger.
    this.idleTimers.set(
      tabId,
      setTimeout(() => {
        this.attached.delete(tabId);
        chrome.debugger.detach({ tabId }).catch(() => {});
      }, IDLE_DETACH_MS),
    );
  }

  private send(tabId: number, method: string, params: Record<string, unknown>): Promise<unknown> {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  async click(tabId: number, path: Point[], x: number, y: number): Promise<void> {
    await this.ensure(tabId);
    // Replay the tail of the ghost cursor's path so hover effects react like for a human.
    for (const [px, py] of path.slice(-6)) {
      await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none' });
    }
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async insertText(tabId: number, text: string): Promise<void> {
    await this.ensure(tabId);
    await this.send(tabId, 'Input.insertText', { text });
  }

  async key(tabId: number, key: string): Promise<void> {
    const k = KEYS[key];
    if (!k) throw new Error(`Unsupported key: ${key}`);
    await this.ensure(tabId);
    const base = { key: key === 'Space' ? ' ' : key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await this.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async detachAll(): Promise<void> {
    for (const tabId of this.attached) await chrome.debugger.detach({ tabId }).catch(() => {});
    this.attached.clear();
  }
}
