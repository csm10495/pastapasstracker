/**
 * Unit tests for pure menu helpers and seeded menu data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { comboKey, KINDS, KIND_LABEL } from '../../js/menu.js';
import { DEFAULT_SETTINGS, SEED_MENU, SETTING_KEYS } from '../../js/schema.js';

test('comboKey is stable for the same pasta, sauce, and topping', () => {
  assert.equal(comboKey('p1', 's1', 't1'), 'p1|s1|t1');
  assert.equal(comboKey('p1', 's1', 't1'), comboKey('p1', 's1', 't1'));
});

test('comboKey is order-sensitive across pasta, sauce, and topping', () => {
  assert.notEqual(comboKey('p1', 's1', 't1'), comboKey('s1', 'p1', 't1'));
  assert.notEqual(comboKey('p1', 's1', 't1'), comboKey('p1', 't1', 's1'));
});

test('comboKey collapses null, undefined, and empty toppings into the no-topping combo', () => {
  assert.equal(comboKey('p1', 's1', null), 'p1|s1|');
  assert.equal(comboKey('p1', 's1', undefined), 'p1|s1|');
  assert.equal(comboKey('p1', 's1', ''), 'p1|s1|');
});

test('comboKey produces different keys for different combinations', () => {
  const keys = new Set([
    comboKey('p1', 's1', null),
    comboKey('p2', 's1', null),
    comboKey('p1', 's2', null),
    comboKey('p1', 's1', 't1'),
  ]);

  assert.equal(keys.size, 4);
});

test('KINDS and KIND_LABEL agree on every menu kind', () => {
  assert.deepEqual(KINDS, ['pasta', 'sauce', 'topping']);
  assert.deepEqual(Object.keys(KIND_LABEL), KINDS);
  for (const kind of KINDS) {
    assert.equal(typeof KIND_LABEL[kind], 'string');
    assert.equal(KIND_LABEL[kind].length > 0, true);
  }
});

test('the seeded menu has exactly 120 advertised pasta pass combinations', () => {
  const pastas = SEED_MENU.filter((item) => item.kind === 'pasta');
  const sauces = SEED_MENU.filter((item) => item.kind === 'sauce');
  const toppings = SEED_MENU.filter((item) => item.kind === 'topping');

  assert.equal(pastas.length, 4);
  assert.equal(sauces.length, 6);
  assert.equal(toppings.length, 4);
  assert.equal(pastas.length * sauces.length * (toppings.length + 1), 120);
});

test('the seeded menu flags only Spicy Alfredo and Crispy Shrimp Fritta as new', () => {
  const newItems = SEED_MENU.filter((item) => item.isNew).map((item) => item.name).sort();

  assert.deepEqual(newItems, ['Crispy Shrimp Fritta', 'Spicy Alfredo']);
});

test('the seeded menu has no duplicate names within a kind', () => {
  for (const kind of KINDS) {
    const names = SEED_MENU.filter((item) => item.kind === kind).map((item) => item.name);
    assert.equal(new Set(names).size, names.length, `${kind} names should be unique`);
  }
});

test('DEFAULT_SETTINGS exposes the expected persisted defaults', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), [
    SETTING_KEYS.mealPrice,
    SETTING_KEYS.passCost,
    SETTING_KEYS.seasonEnd,
    SETTING_KEYS.seasonStart,
    SETTING_KEYS.toppingChargeMode,
    SETTING_KEYS.toppingPrice,
  ].sort());
});

test('DEFAULT_SETTINGS has sane numeric prices and charge mode', () => {
  assert.equal(DEFAULT_SETTINGS.mealPrice > 0, true);
  assert.equal(DEFAULT_SETTINGS.toppingPrice >= 0, true);
  assert.equal(DEFAULT_SETTINGS.passCost > 0, true);
  assert.equal(DEFAULT_SETTINGS.toppingChargeMode, 'perVisit');
});

test('DEFAULT_SETTINGS season dates are valid YYYY-MM-DD values in order', () => {
  assert.match(DEFAULT_SETTINGS.seasonStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(DEFAULT_SETTINGS.seasonEnd, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(DEFAULT_SETTINGS.seasonStart < DEFAULT_SETTINGS.seasonEnd, true);
});
