// Collects deterministic facts about an action target for the GatePolicy.
import type { ActionSignals, FieldKind, GateAction } from '../shared/gate';
import { accessibleName, inputType, roleOf, tagOf } from './accname';

function formOf(el: Element): HTMLFormElement | null {
  const owned = (el as HTMLInputElement).form;
  if (owned) return owned;
  return el.closest('form');
}

function fieldKind(el: Element): FieldKind {
  if (tagOf(el) === 'input' && inputType(el) === 'password') return 'password';
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (/(^|\s)cc-/.test(ac)) return 'payment';
  if (/one-time-code/.test(ac)) return 'otp';
  if (/current-password|new-password/.test(ac)) return 'password';
  const n = `${el.getAttribute('name') ?? ''} ${el.id}`.toLowerCase();
  if (/(card.?number|cardnum|cc.?num|cvv|cvc|security.?code)/.test(n)) return 'payment';
  if (/(otp|2fa|totp|verification.?code)/.test(n)) return 'otp';
  return isTextual(el) ? 'text' : null;
}

function isTextual(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'textarea') return true;
  if (tag === 'input') return !['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'hidden', 'range', 'color'].includes(inputType(el));
  return (el as HTMLElement).isContentEditable;
}

function submitsForm(el: Element, action: GateAction, form: HTMLFormElement | null): boolean {
  if (!form) return false;
  const tag = tagOf(el);
  if (action === 'press') return tag === 'input' && isTextual(el);
  if (tag === 'button') return ((el as HTMLButtonElement).type || 'submit') === 'submit';
  if (tag === 'input') return ['submit', 'image'].includes(inputType(el));
  return false;
}

export function collectSignals(el: Element, action: GateAction, extra: { key?: string } = {}): ActionSignals {
  const form = formOf(el);
  const fields = form ? Array.from(form.elements) : [];
  const method = form ? ((form.getAttribute('method') ?? 'get').toLowerCase() as 'get' | 'post' | 'dialog') : null;
  return {
    action,
    key: extra.key,
    role: roleOf(el),
    name: accessibleName(el),
    tag: tagOf(el),
    inForm: !!form,
    formMethod: !form ? null : method === 'post' || method === 'dialog' ? method : 'get',
    submitsForm: submitsForm(el, action, form),
    formHasPassword: fields.some((f) => fieldKind(f) === 'password'),
    formHasPayment: fields.some((f) => fieldKind(f) === 'payment'),
    formHasFile: fields.some((f) => tagOf(f) === 'input' && inputType(f) === 'file' && ((f as HTMLInputElement).files?.length ?? 0) > 0),
    fieldKind: fieldKind(el),
    multiline: tagOf(el) === 'textarea' || (el as HTMLElement).isContentEditable,
    linkDownload: tagOf(el) === 'a' && el.hasAttribute('download'),
    pageOrigin: location.origin,
  };
}
