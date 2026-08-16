/**
 * Unit tests for pure UI formatting and date helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  money, moneyShort, num, pct, todayISO, toISODate, fromISODate,
  daysBetween, plural, initials, debounce,
} from '../../js/ui.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('money formats normal values, zero, and negatives as US currency', () => {
  assert.equal(money(12.34), '$12.34');
  assert.equal(money(0), '$0.00');
  assert.equal(money(-3.5), '-$3.50');
});

test('money returns a dash for null and non-finite values', () => {
  assert.equal(money(null), '—');
  assert.equal(money(undefined), '—');
  assert.equal(money(NaN), '—');
  assert.equal(money(Infinity), '—');
});

test('moneyShort drops cents for whole dollars and keeps cents otherwise', () => {
  assert.equal(moneyShort(12), '$12');
  assert.equal(moneyShort(12.5), '$12.50');
  assert.equal(moneyShort(0), '$0');
  assert.equal(moneyShort(null), '—');
});

test('num rounds to the requested fixed decimal places', () => {
  assert.equal(num(12.345), '12');
  assert.equal(num(12.345, 2), '12.35');
  assert.equal(num(-1.235, 2), '-1.24');
});

test('num returns a dash for null and non-finite values', () => {
  assert.equal(num(null), '—');
  assert.equal(num(undefined), '—');
  assert.equal(num(NaN), '—');
  assert.equal(num(Infinity), '—');
});

test('pct rounds fractions to whole percentages', () => {
  assert.equal(pct(0), '0%');
  assert.equal(pct(0.124), '12%');
  assert.equal(pct(0.125), '13%');
  assert.equal(pct(1.5), '150%');
});

test('pct returns a dash for null and non-finite values', () => {
  assert.equal(pct(null), '—');
  assert.equal(pct(undefined), '—');
  assert.equal(pct(NaN), '—');
  assert.equal(pct(Infinity), '—');
});

test('fromISODate parses a YYYY-MM-DD string as local midnight', () => {
  const d = fromISODate('2026-08-24');

  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 24);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test('toISODate round-trips local dates across boundaries and leap days', () => {
  for (const iso of ['2026-08-24', '2026-08-31', '2026-12-31', '2027-01-01', '2028-02-29']) {
    assert.equal(toISODate(fromISODate(iso)), iso);
  }
});

test('fromISODate returns null for empty values', () => {
  assert.equal(fromISODate(''), null);
  assert.equal(fromISODate(null), null);
});

// Regression: malformed and impossible dates used to be silently normalized
// by Date (2026-02-31 became March 3), corrupting visit dates.
test('fromISODate returns null for malformed input instead of normalized dates', () => {
  assert.equal(fromISODate('not-a-date'), null);
  assert.equal(fromISODate('2026-02-31'), null);
  assert.equal(fromISODate('2026-13-01'), null);
  assert.equal(fromISODate('2026-08-24-extra'), null);
});

test('daysBetween reports positive, negative, and zero day differences', () => {
  assert.equal(daysBetween('2026-08-24', '2026-08-27'), 3);
  assert.equal(daysBetween('2026-08-27', '2026-08-24'), -3);
  assert.equal(daysBetween('2026-08-24', '2026-08-24'), 0);
});

test('daysBetween handles month and year boundaries', () => {
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 1);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('daysBetween returns null when either input is missing', () => {
  assert.equal(daysBetween(null, '2026-08-24'), null);
  assert.equal(daysBetween('2026-08-24', null), null);
});

test('todayISO returns the current local date in YYYY-MM-DD format', () => {
  const today = todayISO();

  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today, toISODate(new Date()));
});

test('plural uses the singular only for exactly one item', () => {
  assert.equal(plural(1, 'visit'), '1 visit');
  assert.equal(plural(0, 'visit'), '0 visits');
  assert.equal(plural(2, 'visit'), '2 visits');
});

test('plural uses a custom plural form when one is supplied', () => {
  assert.equal(plural(0, 'person', 'people'), '0 people');
  assert.equal(plural(1, 'person', 'people'), '1 person');
  assert.equal(plural(2, 'person', 'people'), '2 people');
});

test('initials derives initials from single, two, and three part names', () => {
  assert.equal(initials('alice'), 'AL');
  assert.equal(initials('Alice Baker'), 'AB');
  assert.equal(initials('Alice B Carol'), 'AC');
});

test('initials handles empty names, null, and extra whitespace', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
  assert.equal(initials('  Alice   Baker  '), 'AB');
});

test('debounce only fires once for rapid calls with the latest arguments', async () => {
  const calls = [];
  const fn = debounce((...args) => calls.push(args), 20);

  fn('first', 1);
  fn('second', 2);
  fn('latest', 3);
  await sleep(40);

  assert.deepEqual(calls, [['latest', 3]]);
});
