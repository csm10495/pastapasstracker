/**
 * Unit tests for pure menu helpers and seeded menu data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_TOPPING_KEY, allowedComboCount, allowedItems, comboKey, exclusionKey, untriedSuggestions,
  KINDS, KIND_LABEL,
} from '../../js/menu.js';
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
    SETTING_KEYS.comboExclusions,
    SETTING_KEYS.mealPrice,
    SETTING_KEYS.passCost,
    SETTING_KEYS.photoQuality,
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

/* --------------------------------------------- suggestion exclusions ---- */

const PASTAS = [{ id: 'p1', name: 'Fettuccine' }, { id: 'p2', name: 'Rigatoni' }];
const SAUCES = [{ id: 's1', name: 'Alfredo' }, { id: 's2', name: 'Creamy Mushroom' }];
const TOPPINGS = [
  { id: null, name: 'No topping' },
  { id: 't1', name: 'Meatballs' },
  { id: 't2', name: 'Italian Sausage' },
];

const suggest = (exclusions, tried = new Set()) => untriedSuggestions({
  pastas: PASTAS, sauces: SAUCES, toppingOptions: TOPPINGS, tried, exclusions,
});

test('exclusionKey uses the menu item id and a sentinel for "no topping"', () => {
  assert.equal(exclusionKey({ id: 't1', name: 'Meatballs' }), 't1');
  assert.equal(exclusionKey({ id: null, name: 'No topping' }), NO_TOPPING_KEY);
  assert.equal(exclusionKey(undefined), NO_TOPPING_KEY);
});

test('an unfiltered suggestion pool covers every combination', () => {
  assert.equal(suggest([]).length, 2 * 2 * 3);
  assert.equal(allowedComboCount({
    pastas: PASTAS, sauces: SAUCES, toppingOptions: TOPPINGS, exclusions: [],
  }), 12);
});

test('excluding a sauce and a topping removes only their combinations', () => {
  const picks = suggest(['s2', 't2']);

  assert.equal(picks.length, 2 * 1 * 2);
  assert.ok(!picks.some((pick) => pick.sauce.id === 's2'), 'no excluded sauce');
  assert.ok(!picks.some((pick) => pick.topping.id === 't2'), 'no excluded topping');
  assert.ok(picks.some((pick) => pick.topping.id === null), '"no topping" is still offered');
});

test('"no topping" can itself be excluded', () => {
  const picks = suggest([NO_TOPPING_KEY]);

  assert.equal(picks.length, 2 * 2 * 2);
  assert.ok(picks.every((pick) => pick.topping.id !== null));
});

// The view holds live state in a Set while the persisted setting is an array.
// Array.isArray is false for a Set, so a naive guard would drop every exclusion.
test('exclusions are honoured whether passed as a Set or an array', () => {
  assert.equal(suggest(new Set(['s2'])).length, suggest(['s2']).length);
  assert.equal(allowedComboCount({
    pastas: PASTAS, sauces: SAUCES, toppingOptions: TOPPINGS, exclusions: new Set(['s2']),
  }), 6);
  assert.deepEqual(allowedItems(SAUCES, new Set(['s2'])).map((item) => item.name), ['Alfredo']);
});

test('tried combinations are never suggested again', () => {
  const tried = new Set([comboKey('p1', 's1', null)]);
  const picks = suggest([], tried);

  assert.equal(picks.length, 11);
  assert.ok(!picks.some((pick) => comboKey(pick.pasta.id, pick.sauce.id, pick.topping.id) === comboKey('p1', 's1', null)));
});

test('excluding every item of one kind leaves nothing to suggest', () => {
  assert.equal(suggest(['p1', 'p2']).length, 0);
  assert.equal(allowedComboCount({
    pastas: PASTAS, sauces: SAUCES, toppingOptions: TOPPINGS, exclusions: ['p1', 'p2'],
  }), 0);
});

test('a stale exclusion for a removed menu item is simply ignored', () => {
  assert.equal(suggest(['deleted-item-id']).length, 12);
});

test('missing or malformed exclusions fall back to no filtering', () => {
  for (const value of [undefined, null, 'nope', 42]) {
    assert.equal(suggest(value).length, 12, `exclusions: ${String(value)}`);
  }
  assert.equal(untriedSuggestions().length, 0, 'no menu means nothing to suggest');
});

test('the default combo exclusions are empty and immutable', () => {
  assert.deepEqual([...DEFAULT_SETTINGS[SETTING_KEYS.comboExclusions]], []);
  // getSettings() shallow-copies the defaults, so a shared mutable array would
  // leak one screen's edit into every later read.
  assert.throws(() => {
    'use strict';
    DEFAULT_SETTINGS[SETTING_KEYS.comboExclusions].push('oops');
  }, TypeError);
});
