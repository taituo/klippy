// GatePolicy: pure unit tests.
import { test, expect } from 'playwright/test';
import { evaluateGate, riskyWords, type ActionSignals } from '../src/shared/gate';

const base: ActionSignals = {
  action: 'click', role: 'button', name: 'Open menu', tag: 'button', inForm: false, formMethod: null, submitsForm: false,
  formHasPassword: false, formHasPayment: false, formHasFile: false, fieldKind: null, multiline: false, linkDownload: false, pageOrigin: 'https://shop.test',
};
const s = (o: Partial<ActionSignals>): ActionSignals => ({ ...base, ...o });

test('benign click is allowed without confirmation', () => {
  const v = evaluateGate(base);
  expect(v).toMatchObject({ allow: true, requireConfirm: false });
});

test('purchase / send / delete words need confirmation (EN and FI)', () => {
  expect(evaluateGate(s({ name: 'Place order' })).categories).toContain('purchase');
  expect(evaluateGate(s({ name: 'Buy now' })).categories).toContain('purchase');
  expect(evaluateGate(s({ name: 'Delete account' })).categories).toContain('delete');
  expect(evaluateGate(s({ name: 'Send' })).categories).toContain('send');
  expect(evaluateGate(s({ name: 'Osta nyt' })).categories).toContain('purchase');
  expect(evaluateGate(s({ name: 'Lähetä viesti' })).categories).toContain('send');
  expect(evaluateGate(s({ name: 'Poista tili' })).categories).toContain('delete');
  expect(evaluateGate(s({ name: 'Maksa tilaus' })).categories).toContain('purchase');
});

test('whole-word matching avoids obvious false positives', () => {
  expect(riskyWords('Blog posts')).toEqual([]);
  expect(riskyWords('Sender settings')).toEqual([]);
  expect(riskyWords('Paypal help center')).toEqual([]);
  expect(evaluateGate(s({ name: 'Show more' })).requireConfirm).toBe(false);
});

test('GET search submit is allowed, POST submit needs confirmation', () => {
  expect(evaluateGate(s({ name: 'Search', inForm: true, formMethod: 'get', submitsForm: true })).requireConfirm).toBe(false);
  const post = evaluateGate(s({ name: 'Go', inForm: true, formMethod: 'post', submitsForm: true }));
  expect(post.requireConfirm).toBe(true);
  expect(post.categories).toContain('submit');
});

test('credentials and payment forms', () => {
  const login = evaluateGate(s({ name: 'Sign in', inForm: true, formMethod: 'post', submitsForm: true, formHasPassword: true }));
  expect(login.categories).toEqual(['credentials']);
  const pay = evaluateGate(s({ name: 'Continue', inForm: true, formMethod: 'post', submitsForm: true, formHasPayment: true }));
  expect(pay.categories).toEqual(['payment']);
  const enter = evaluateGate(s({ action: 'press', key: 'Enter', role: 'textbox', tag: 'input', inForm: true, formMethod: 'post', submitsForm: true, formHasPassword: true }));
  expect(enter.categories).toEqual(['credentials']);
  const esc = evaluateGate(s({ action: 'press', key: 'Escape', role: 'textbox', tag: 'input', inForm: true, formMethod: 'post', submitsForm: true, formHasPassword: true }));
  expect(esc.requireConfirm).toBe(false);
});

test('typing into password, payment and one-time-code fields needs confirmation', () => {
  expect(evaluateGate(s({ action: 'type', role: 'textbox', fieldKind: 'password' })).categories).toEqual(['credentials']);
  expect(evaluateGate(s({ action: 'type', role: 'textbox', fieldKind: 'payment' })).categories).toEqual(['payment']);
  expect(evaluateGate(s({ action: 'type', role: 'textbox', fieldKind: 'otp' })).categories).toEqual(['2fa']);
  expect(evaluateGate(s({ action: 'type', role: 'textbox', name: 'Send to', fieldKind: 'text' })).requireConfirm).toBe(false);
});

test('navigation: only http(s)', () => {
  expect(evaluateGate(s({ action: 'navigate', url: 'https://example.org' })).allow).toBe(true);
  expect(evaluateGate(s({ action: 'navigate', url: 'javascript:alert(1)' })).allow).toBe(false);
  expect(evaluateGate(s({ action: 'navigate', url: 'file:///etc/passwd' })).allow).toBe(false);
  expect(evaluateGate(s({ action: 'navigate', url: 'not a url' })).allow).toBe(false);
});

test('model signals are monotonic: they can add a confirmation, never remove one', () => {
  const stricter = evaluateGate(base, [{ category: 'send', probability: 0.9 }]);
  expect(stricter.requireConfirm).toBe(true);
  const ignored = evaluateGate(base, [{ category: 'send', probability: 0.2 }]);
  expect(ignored.requireConfirm).toBe(false);
  const ruleWins = evaluateGate(s({ name: 'Place order' }), [{ category: 'purchase', probability: 0 }]);
  expect(ruleWins.requireConfirm).toBe(true);
});

test('Enter in a message box (textarea / contenteditable) needs confirmation', () => {
  const chat = evaluateGate(s({ action: 'press', key: 'Enter', role: 'textbox', tag: 'div', multiline: true, fieldKind: 'text' }));
  expect(chat.categories).toEqual(['send']);
  const search = evaluateGate(s({ action: 'press', key: 'Enter', role: 'searchbox', tag: 'input', multiline: false, fieldKind: 'text' }));
  expect(search.requireConfirm).toBe(false);
  const tab = evaluateGate(s({ action: 'press', key: 'Tab', role: 'textbox', tag: 'textarea', multiline: true, fieldKind: 'text' }));
  expect(tab.requireConfirm).toBe(false);
});
