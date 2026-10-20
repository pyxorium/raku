import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabs, current } from '../src/tabs.js';

const A = 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/aaaa';
const B = 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/bbbb';

test('starts with one first screen; go, back and forward per tab', () => {
  const t = createTabs();
  assert.equal(t.list.length, 1);
  assert.equal(current(t.active), null);
  const id = t.active.id;
  t.go(id, A);
  t.go(id, B);
  assert.equal(current(t.active), B);
  assert.equal(t.canBack(id), true);
  t.back(id);
  assert.equal(current(t.active), A);
  assert.equal(t.canForward(id), true);
  t.go(id, B);                         // a new address drops forward history
  t.back(id); t.back(id);
  assert.equal(current(t.active), null);
  assert.equal(t.canBack(id), false);
});

test('the tab cap', () => {
  const t = createTabs({ max: 3 });
  assert.ok(t.open(A));
  assert.ok(t.open(B));
  assert.equal(t.full, true);
  assert.equal(t.open(A), null);
});

test('closing: the next tab comes to the front; the last one leaves a first screen', () => {
  const t = createTabs();
  const first = t.active.id;
  const a = t.open(A).id;
  t.open(B);
  t.activate(a);
  t.close(a);
  assert.equal(current(t.active), B);
  t.close(t.active.id);
  t.close(first);
  assert.equal(t.list.length, 1);
  assert.equal(current(t.active), null);
});

test('tabs survive in the hash; bad addresses become first screens', () => {
  const t = createTabs();
  t.go(t.active.id, A);
  t.open(B);
  t.open();
  t.activate(t.list[1].id);
  const hash = t.toHash();
  const u = createTabs();
  assert.equal(u.fromHash(hash), true);
  assert.deepEqual(u.list.map(current), [A, B, null]);
  assert.equal(current(u.active), B);
  u.fromHash(`#t=${encodeURIComponent('javascript:alert(1)')},${encodeURIComponent(A)}&a=9`);
  assert.deepEqual(u.list.map(current), [null, A]);
  assert.equal(u.active.id, u.list[1].id);
  assert.equal(u.fromHash(''), false);
});

test('changes are announced', () => {
  const t = createTabs();
  const seen = [];
  t.onChange((w) => seen.push(w.type));
  t.go(t.active.id, A);
  t.go(t.active.id, A);
  t.open();
  assert.deepEqual(seen, ['go', 'reload', 'open']);
});
