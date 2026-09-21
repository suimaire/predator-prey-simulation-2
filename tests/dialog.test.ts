import assert from 'node:assert/strict';
import test from 'node:test';
import { DialogController } from '../src/dialog.ts';

test('modal registration is stable across repeated opens, restores scroll/styles/focus and allows only one dialog', () => {
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  let focused: unknown; let scroll: unknown; let closed = 0;
  const makeButton = () => ({ tabIndex: 0, isConnected: true, matches: () => false,
    getClientRects: () => [1], focus() { focused = this; document.activeElement = this; } });
  const opener = makeButton(); const first = makeButton(); const last = makeButton();
  const events = new Map<string, Function[]>();
  const emit = (type: string, event = {}) => { for (const fn of events.get(type) ?? []) fn(event); };
  const dialog = { returnValue: '',
    addEventListener(type: string, fn: Function) { events.set(type, [...events.get(type) ?? [], fn]); },
    querySelector: () => first, querySelectorAll: () => [first, last], showModal() {},
    close() { emit('close'); }, focus() {},
  };
  Object.assign(globalThis, {
    document: { body: { style: { cssText: 'color: green;' } }, activeElement: opener },
    window: { scrollX: 0, scrollY: 350, scrollTo(x: number, y: number) { scroll = [x, y]; } },
  });
  try {
    const controller = new DialogController();
    controller.register(dialog as unknown as HTMLDialogElement, { onClose: () => closed++ });
    for (let i = 0; i < 20; i++) {
      assert.equal(controller.open(dialog as unknown as HTMLDialogElement, opener as unknown as HTMLElement), true);
      assert.equal(focused, first);
      assert.equal(controller.open(dialog as unknown as HTMLDialogElement, opener as unknown as HTMLElement), false);
      let prevented = false;
      emit('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
      assert.equal(prevented, true); assert.equal(focused, last);
      emit('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
      assert.equal(focused, first);
      dialog.close();
      assert.equal(focused, opener); assert.deepEqual(scroll, [0, 350]);
      assert.equal(document.body.style.cssText, 'color: green;');
    }
    assert.equal(closed, 20);
    assert.ok([...events.values()].every((listeners) => listeners.length === 1));
  } finally {
    Object.assign(globalThis, { document: savedDocument, window: savedWindow });
  }
});
