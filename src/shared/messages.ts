// Messages between the service worker and the content script.
import type { ActionSignals } from './gate';

export type ContentRequest =
  | { op: 'ping' }
  | { op: 'snapshot'; maxItems?: number; includeText?: boolean }
  | { op: 'readHtml'; id: number; maxChars?: number }
  | { op: 'target'; id: number; action: 'click' | 'type' }
  | { op: 'focusInfo'; key: string }
  | { op: 'moveCursor'; x: number; y: number }
  | { op: 'clickFx' }
  | { op: 'hideCursor' }
  | { op: 'beginChange' }
  | { op: 'endChange'; quietMs?: number; maxMs?: number }
  | { op: 'highlight'; ids: number[]; label?: string }
  | { op: 'clearHighlights' }
  | { op: 'say'; text: string }
  | { op: 'confirm'; question: string; timeoutMs?: number }
  | { op: 'prepareType'; id: number; clear: boolean }
  | { op: 'syntheticClick'; id: number }
  | { op: 'syntheticType'; id: number; text: string; clear: boolean }
  | { op: 'syntheticKey'; key: string }
  | { op: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom' }
  | { op: 'describe'; id: number };

export interface TargetResult {
  x: number;
  y: number;
  label: string;
  occludedBy?: string;
  signals: ActionSignals;
}

export type ContentResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
