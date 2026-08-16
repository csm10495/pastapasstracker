/**
 * Unit tests for the cost, savings, and pace engine.
 *
 * These are the numbers the whole app exists to produce, so they are pinned
 * precisely rather than checked loosely.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStats, seasonProgress, projectCostPerBowl, visitsToBreakEven,
} from '../../js/stats.js';

const SETTINGS = { toppingChargeMode: 'perVisit', mealPrice: 14.99, passCost: 100 };

const near = (actual, expected, tolerance = 0.005) => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );
};

function fixture({ toppingChargeMode = 'perVisit' } = {}) {
  const people = [
    { id: 'p1', name: 'Alice', hasPass: true, passCost: 100 },
    { id: 'p2', name: 'Bob', hasPass: false },
  ];
  const visits = [
    { id: 'v1', date: '2026-08-24', locationId: 'l1', mealPrice: 14.99, toppingPrice: 4.99 },
    { id: 'v2', date: '2026-08-31', locationId: null, mealPrice: 15.99, toppingPrice: 4.99 },
  ];
  const bowls = [
    // Alice: 2 bowls at v1 (one topped), 1 bowl at v2 (untopped)
    { id: 'b1', visitId: 'v1', personId: 'p1', pastaId: 'pa1', sauceId: 'sa1', toppingId: 't1' },
    { id: 'b2', visitId: 'v1', personId: 'p1', pastaId: 'pa1', sauceId: 'sa2', toppingId: null },
    { id: 'b3', visitId: 'v2', personId: 'p1', pastaId: 'pa2', sauceId: 'sa1', toppingId: null },
    // Bob: 1 bowl at v1 (topped)
    { id: 'b4', visitId: 'v1', personId: 'p2', pastaId: 'pa2', sauceId: 'sa2', toppingId: 't1' },
  ];
  return { people, visits, bowls, settings: { ...SETTINGS, toppingChargeMode } };
}

test('a pass holder spends the pass cost regardless of how much they eat', () => {
  const { perPerson } = computeStats(fixture());
  const alice = perPerson.find((p) => p.person.id === 'p1');

  assert.equal(alice.bowls, 3);
  assert.equal(alice.visits, 2);
  assert.equal(alice.spend, 100);
  // v1: 14.99 meal + 4.99 topping (one topped bowl, charged once per visit)
  // v2: 15.99 meal, no toppings
  near(alice.retailValue, 14.99 + 4.99 + 15.99);
  near(alice.saved, 35.97 - 100);
  near(alice.costPerBowl, 100 / 3);
});

test('a payer spends exactly the retail value they incurred', () => {
  const { perPerson } = computeStats(fixture());
  const bob = perPerson.find((p) => p.person.id === 'p2');

  assert.equal(bob.bowls, 1);
  assert.equal(bob.visits, 1);
  near(bob.retailValue, 14.99 + 4.99);
  near(bob.spend, 19.98);
  near(bob.saved, 0, 0.0001);
  near(bob.costPerBowl, 19.98);
});

test('topping surcharge is charged once per visit in perVisit mode', () => {
  const { perPerson } = computeStats(fixture({ toppingChargeMode: 'perVisit' }));
  const alice = perPerson.find((p) => p.person.id === 'p1');
  // Only one of Alice's two v1 bowls is topped, so one surcharge.
  near(alice.retailValue, 14.99 + 4.99 + 15.99);
});

test('topping surcharge is charged per topped bowl in perBowl mode', () => {
  const base = fixture({ toppingChargeMode: 'perBowl' });
  base.bowls.push({
    id: 'b5', visitId: 'v1', personId: 'p1', pastaId: 'pa1', sauceId: 'sa1', toppingId: 't2',
  });
  const { perPerson } = computeStats(base);
  const alice = perPerson.find((p) => p.person.id === 'p1');
  // v1 now has two topped bowls for Alice -> 2 x 4.99
  near(alice.retailValue, 14.99 + 9.98 + 15.99);
});

test('untopped bowls never attract a surcharge', () => {
  const data = {
    people: [{ id: 'p1', name: 'A', hasPass: false }],
    visits: [{ id: 'v1', date: '2026-09-01', mealPrice: 10, toppingPrice: 5 }],
    bowls: [
      { id: 'b1', visitId: 'v1', personId: 'p1', pastaId: 'x', sauceId: 'y', toppingId: null },
      { id: 'b2', visitId: 'v1', personId: 'p1', pastaId: 'x', sauceId: 'y', toppingId: null },
    ],
    settings: SETTINGS,
  };
  const { perPerson } = computeStats(data);
  near(perPerson[0].retailValue, 10);
});

test('break-even is detected on the visit that crosses the pass cost', () => {
  const visits = [];
  const bowls = [];
  for (let i = 0; i < 8; i++) {
    const id = 'v' + i;
    visits.push({ id, date: `2026-09-0${i + 1}`, mealPrice: 15, toppingPrice: 0 });
    bowls.push({ id: 'b' + i, visitId: id, personId: 'p1', pastaId: 'x', sauceId: 'y', toppingId: null });
  }
  const { perPerson } = computeStats({
    people: [{ id: 'p1', name: 'A', hasPass: true, passCost: 100 }],
    visits, bowls, settings: SETTINGS,
  });

  // 15 * 7 = 105, the first cumulative total at or above 100.
  assert.equal(perPerson[0].breakEvenAt.visitNumber, 7);
  assert.equal(perPerson[0].breakEvenAt.date, '2026-09-07');
  assert.equal(perPerson[0].remainingToBreakEven, 0);
});

test('break-even accumulates across differing per-visit prices', () => {
  // Deliberately uneven prices: a fixed 100/14.99 estimate would be wrong.
  const prices = [20, 20, 20, 20, 25];
  const visits = prices.map((mealPrice, i) => ({
    id: 'v' + i, date: `2026-09-1${i}`, mealPrice, toppingPrice: 0,
  }));
  const bowls = visits.map((v, i) => ({
    id: 'b' + i, visitId: v.id, personId: 'p1', pastaId: 'x', sauceId: 'y', toppingId: null,
  }));
  const { perPerson } = computeStats({
    people: [{ id: 'p1', name: 'A', hasPass: true, passCost: 100 }],
    visits, bowls, settings: SETTINGS,
  });
  // 20+20+20+20 = 80, then +25 = 105 crosses on visit 5.
  assert.equal(perPerson[0].breakEvenAt.visitNumber, 5);
});

test('a pass holder short of break-even reports the shortfall', () => {
  const { perPerson } = computeStats({
    people: [{ id: 'p1', name: 'A', hasPass: true, passCost: 100 }],
    visits: [{ id: 'v1', date: '2026-09-01', mealPrice: 14.99, toppingPrice: 0 }],
    bowls: [{ id: 'b1', visitId: 'v1', personId: 'p1', pastaId: 'x', sauceId: 'y', toppingId: null }],
    settings: SETTINGS,
  });
  assert.equal(perPerson[0].breakEvenAt, null);
  near(perPerson[0].remainingToBreakEven, 85.01);
});

test('totals aggregate spend, retail and savings across everyone', () => {
  const { totals } = computeStats(fixture());
  assert.equal(totals.bowls, 4);
  assert.equal(totals.visits, 2);
  assert.equal(totals.people, 2);
  near(totals.spend, 100 + 19.98);
  near(totals.retail, 35.97 + 19.98);
  near(totals.saved, totals.retail - totals.spend);
  near(totals.costPerBowl, 119.98 / 4);
  near(totals.bowlsPerVisit, 2);
});

test('locations are counted only when assigned', () => {
  const { totals } = computeStats(fixture());
  assert.equal(totals.locations, 1);
  assert.equal(totals.visitsWithoutLocation, 1);
});

test('price statistics report the spread across visits', () => {
  const { priceStats } = computeStats(fixture());
  near(priceStats.min, 14.99);
  near(priceStats.max, 15.99);
  near(priceStats.average, 15.49);
  assert.equal(priceStats.varies, true);
});

test('price statistics flag a flat season', () => {
  const data = fixture();
  data.visits = data.visits.map((v) => ({ ...v, mealPrice: 14.99 }));
  const { priceStats } = computeStats(data);
  assert.equal(priceStats.varies, false);
});

test('tried combos treat "no topping" as its own combination', () => {
  const { triedCombos } = computeStats(fixture());
  // b1 (pa1/sa1/t1), b2 (pa1/sa2/none), b3 (pa2/sa1/none), b4 (pa2/sa2/t1)
  assert.equal(triedCombos.size, 4);
  assert.ok(triedCombos.has('pa1|sa2|'));
  assert.ok(triedCombos.has('pa1|sa1|t1'));
});

test('identical combos collapse to one tried entry', () => {
  const data = fixture();
  data.bowls.push({
    id: 'dup', visitId: 'v1', personId: 'p1', pastaId: 'pa1', sauceId: 'sa1', toppingId: 't1',
  });
  assert.equal(computeStats(data).triedCombos.size, 4);
});

test('favourite tallies are ordered by frequency', () => {
  const { pastaCounts, sauceCounts } = computeStats(fixture());
  assert.equal(pastaCounts[0][1] >= pastaCounts[pastaCounts.length - 1][1], true);
  assert.equal(pastaCounts.reduce((s, [, n]) => s + n, 0), 4);
  assert.equal(sauceCounts.reduce((s, [, n]) => s + n, 0), 4);
});

test('the timeline aggregates bowls per date in order', () => {
  const { timeline, firstVisit, lastVisit } = computeStats(fixture());
  assert.deepEqual(timeline, [
    { date: '2026-08-24', count: 3 },
    { date: '2026-08-31', count: 1 },
  ]);
  assert.equal(firstVisit, '2026-08-24');
  assert.equal(lastVisit, '2026-08-31');
});

test('bowls pointing at a deleted visit are ignored', () => {
  const data = fixture();
  data.bowls.push({
    id: 'orphan', visitId: 'gone', personId: 'p1', pastaId: 'pa1', sauceId: 'sa1', toppingId: null,
  });
  const { totals, perPerson } = computeStats(data);
  assert.equal(totals.bowls, 4);
  assert.equal(perPerson.find((p) => p.person.id === 'p1').bowls, 3);
});

test('empty input produces zeroes rather than NaN', () => {
  const { totals, perPerson, priceStats } = computeStats({
    people: [], visits: [], bowls: [], settings: SETTINGS,
  });
  assert.equal(totals.bowls, 0);
  assert.equal(totals.visits, 0);
  assert.equal(totals.costPerBowl, null);
  assert.equal(totals.bowlsPerVisit, null);
  assert.equal(priceStats, null);
  assert.deepEqual(perPerson, []);
});

test('a person with no bowls reports null averages, not division by zero', () => {
  const { perPerson } = computeStats({
    people: [{ id: 'p1', name: 'Idle', hasPass: false }],
    visits: [], bowls: [], settings: SETTINGS,
  });
  assert.equal(perPerson[0].bowls, 0);
  assert.equal(perPerson[0].costPerBowl, null);
  assert.equal(perPerson[0].bowlsPerVisit, null);
  assert.equal(perPerson[0].spend, 0);
});

/* ---------------------------------------------------------- season ------ */

test('season reports the upcoming phase before it opens', () => {
  const s = seasonProgress('2026-08-20', '2026-08-24', '2026-11-22');
  assert.equal(s.phase, 'upcoming');
  assert.equal(s.daysUntilStart, 4);
  assert.equal(s.fraction, 0);
  assert.equal(s.totalDays, 91);
});

test('season reports the active phase on the opening day', () => {
  const s = seasonProgress('2026-08-24', '2026-08-24', '2026-11-22');
  assert.equal(s.phase, 'active');
  assert.equal(s.daysElapsed, 1);
  assert.equal(s.daysRemaining, 90);
});

test('season reports the ended phase after the close', () => {
  const s = seasonProgress('2026-11-23', '2026-08-24', '2026-11-22');
  assert.equal(s.phase, 'ended');
  assert.equal(s.fraction, 1);
  assert.equal(s.daysRemaining, 0);
});

test('the final day is still active', () => {
  const s = seasonProgress('2026-11-22', '2026-08-24', '2026-11-22');
  assert.equal(s.phase, 'active');
  assert.equal(s.daysRemaining, 0);
  assert.equal(s.daysElapsed, 91);
});

test('season handles missing dates without throwing', () => {
  assert.equal(seasonProgress('2026-09-01', null, '2026-11-22'), null);
  assert.equal(seasonProgress(null, '2026-08-24', '2026-11-22'), null);
});

/* ------------------------------------------------------- projections ---- */

test('projection extrapolates a pass holder to the end of the season', () => {
  const stats = { person: { hasPass: true }, bowls: 10, spend: 100 };
  const season = { phase: 'active', daysElapsed: 10, daysRemaining: 10 };
  const p = projectCostPerBowl(stats, season);
  assert.equal(p.projectedBowls, 20);
  near(p.costPerBowl, 5);
});

test('projection does not apply to payers or before the season opens', () => {
  const season = { phase: 'active', daysElapsed: 10, daysRemaining: 10 };
  assert.equal(projectCostPerBowl({ person: { hasPass: false }, bowls: 5, spend: 50 }, season), null);
  assert.equal(projectCostPerBowl(
    { person: { hasPass: true }, bowls: 5, spend: 100 },
    { phase: 'upcoming', daysElapsed: 0, daysRemaining: 90 },
  ), null);
});

test('remaining visits to break even use the average price paid so far', () => {
  const stats = {
    person: { hasPass: true },
    remainingToBreakEven: 40,
    retailValue: 60,
    visits: 3,
  };
  // Average paid is 20, so 40 remaining needs 2 more visits.
  assert.equal(visitsToBreakEven(stats, 14.99), 2);
});

test('remaining visits is zero once broken even', () => {
  assert.equal(visitsToBreakEven({
    person: { hasPass: true }, remainingToBreakEven: 0, retailValue: 120, visits: 8,
  }), 0);
});

test('remaining visits falls back to the global price with no history', () => {
  assert.equal(visitsToBreakEven({
    person: { hasPass: true }, remainingToBreakEven: 100, retailValue: 0, visits: 0,
  }, 20), 5);
});

test('remaining visits is not applicable to payers', () => {
  assert.equal(visitsToBreakEven({
    person: { hasPass: false }, remainingToBreakEven: 0, retailValue: 0, visits: 0,
  }), null);
});
