import test from 'node:test';
import assert from 'node:assert/strict';

import { withApp } from '../helpers/app.mjs';

const money = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);

const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const RICH_FIXTURE = {
  people: [
    { name: 'Alice', hasPass: true, passCost: 50 },
    { name: 'Bob', hasPass: false },
    { name: 'Charlie', hasPass: true, passCost: 100 },
  ],
  locations: [{ name: 'OG Brookfield', city: 'Brookfield', state: 'WI' }],
  visits: [
    {
      date: '2026-08-24',
      location: 'OG Brookfield',
      mealPrice: 15,
      toppingPrice: 5,
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null },
        { person: 'Alice', pasta: 'Spaghetti', sauce: 'Alfredo', topping: 'Meatballs' },
        { person: 'Bob', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: null },
      ],
    },
    {
      date: '2026-08-31',
      location: null,
      mealPrice: 20,
      toppingPrice: 5,
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null },
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: null },
        { person: 'Bob', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: 'Meatballs' },
      ],
    },
    {
      date: '2026-09-07',
      location: null,
      mealPrice: 40,
      toppingPrice: 5,
      bowls: [
        { person: 'Alice', pasta: 'Angel Hair', sauce: 'Traditional Marinara', topping: null },
        { person: 'Charlie', pasta: 'Spaghetti', sauce: 'Alfredo', topping: null },
      ],
    },
  ],
};

async function screenStats(app) {
  return app.run(`return (async () => {
    const computed = stats.computeStats({
      people: await db.getAll('people'),
      visits: await db.getAll('visits'),
      bowls: await db.getAll('bowls'),
      settings: await db.getSettings(),
    });
    return { totals: computed.totals, perPerson: computed.perPerson, priceStats: computed.priceStats };
  })();`);
}

async function cardText(app, title) {
  return app.eval(`(() => {
    const card = [...document.querySelectorAll('#view .card')]
      .find((node) => node.querySelector('.card__title')?.textContent.trim() === ${JSON.stringify(title)}
        || node.textContent.includes(${JSON.stringify(title)}));
    return card ? card.innerText.replace(/\\s+/g, ' ').trim() : '';
  })()`);
}

test('headline tiles display computed total bowls, visits, cost per bowl, and money saved', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const expected = await screenStats(app);
    const text = await app.text();
    assert.match(text, new RegExp(String(expected.totals.bowls)));
    assert.match(text, new RegExp(String(expected.totals.visits)));
    assert.match(text, new RegExp(money(expected.totals.costPerBowl).replace('$', '\\$')));
    assert.match(text, new RegExp(money(expected.totals.saved).replace('$', '\\$')));
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });
});

test('pass holder and payer cards show spend, retail value, savings, break-even, and paid amounts', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const expected = await screenStats(app);
    const alice = expected.perPerson.find((p) => p.person.name === 'Alice');
    const charlie = expected.perPerson.find((p) => p.person.name === 'Charlie');
    const bob = expected.perPerson.find((p) => p.person.name === 'Bob');
    const text = await app.text();

    assert.match(text, new RegExp(`Spent ${money(alice.spend).replace('$', '\\$')}`));
    assert.match(text, new RegExp(`retail value ${money(alice.retailValue).replace('$', '\\$')}`));
    assert.match(text, new RegExp(`saved ${money(alice.saved).replace('$', '\\$')}`));
    assert.match(text, /Broke even|more visits? to break even/);
    assert.match(text, new RegExp(`saved ${money(charlie.saved).replace('$', '\\$')}`));
    assert.match(text, new RegExp(`Paid ${money(bob.spend).replace('$', '\\$')}`));
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });
});

test('diners are ordered by bowl count descending', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const names = await app.eval(`(() => [...document.querySelectorAll('#view .card .row strong')]
      .map((node) => node.textContent.trim())
      .filter((name) => ['Alice', 'Bob', 'Charlie'].includes(name)))()`);
    assert.deepEqual(names, ['Alice', 'Bob', 'Charlie']);
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });
});

test('singular labels render for exactly one bowl and one visit', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const text = await app.text();
    assert.match(text, /1 Total bowl/i);
    assert.match(text, /1 Total visit/i);
    assert.doesNotMatch(text, /1 BOWLS/i);
    assert.doesNotMatch(text, /1 VISITS/i);
    app.assertNoErrors();
  }, {
    seed: {
      people: [{ name: 'Solo', hasPass: false }],
      visits: [{ date: '2026-09-01', bowls: [{ person: 'Solo', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('price insight appears only for varying meal prices and reports min, max, and average', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const expected = await screenStats(app);
    const price = await cardText(app, 'Price insight');
    assert.match(price, new RegExp(money(expected.priceStats.min).replace('$', '\\$')));
    assert.match(price, new RegExp(money(expected.priceStats.max).replace('$', '\\$')));
    assert.match(price, new RegExp(money(expected.priceStats.average).replace('$', '\\$')));
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });

  await withApp(async (app) => {
    await app.goto('/stats');
    assert.doesNotMatch(await app.text(), /Price insight/i);
    app.assertNoErrors();
  }, {
    seed: {
      people: [{ name: 'Flat', hasPass: false }],
      visits: [
        { date: '2026-09-01', mealPrice: 14.99, bowls: [{ person: 'Flat', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] },
        { date: '2026-09-02', mealPrice: 14.99, bowls: [{ person: 'Flat', pasta: 'Spaghetti', sauce: 'Alfredo', topping: null }] },
      ],
    },
  });
});

test('places card counts assigned locations and unassigned visits with correct grammar', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const places = await cardText(app, 'Places');
    assert.match(places, /Visited 1 location/);
    assert.match(places, /2 visits have no location assigned/);
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });

  await withApp(async (app) => {
    await app.goto('/stats');
    const places = await cardText(app, 'Places');
    assert.match(places, /1 visit has no location assigned/);
    app.assertNoErrors();
  }, {
    seed: {
      people: [{ name: 'One', hasPass: false }],
      visits: [{ date: '2026-09-01', location: null, bowls: [{ person: 'One', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('season countdown shows upcoming, active, and ended phases from settings', async () => {
  await withApp(async (app) => {
    const cases = [
      { start: addDays(4), end: addDays(20), pattern: /Starts in \d+ days|\d+ days to go/ },
      { start: addDays(-1), end: addDays(3), pattern: /\d+ days left/ },
      { start: addDays(-20), end: addDays(-3), pattern: /season ended|Season complete/i },
    ];
    for (const c of cases) {
      await app.run(`await db.setSetting('seasonStart', ${JSON.stringify(c.start)});
        await db.setSetting('seasonEnd', ${JSON.stringify(c.end)});`);
      await app.goto('/stats');
      assert.match(await app.text(), c.pattern);
    }
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });
});

test('charts render without console errors for a single data point and for visits with no bowls', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    assert.match(await app.text(), /Bowls over time/i);
    app.assertNoErrors('single data point charts');
  }, {
    seed: {
      people: [{ name: 'Solo', hasPass: false }],
      visits: [{ date: '2026-09-01', bowls: [{ person: 'Solo', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });

  await withApp(async (app) => {
    await app.goto('/stats');
    assert.match(await app.text(), /Bowls over time/i);
    app.assertNoErrors('empty chart data');
  }, { seed: { visits: [{ date: '2026-09-01', bowls: [] }] } });
});

test('dashboard empty state and populated combo coverage render correctly', async () => {
  await withApp(async (app) => {
    await app.resetData();
    await app.reload();
    assert.match(await app.text(), /Welcome to Pasta Pass Tracker/i);
    app.assertNoErrors();
  });

  await withApp(async (app) => {
    await app.goto('/');
    const expected = await app.run(`const computed = stats.computeStats({
        people: await db.getAll('people'),
        visits: await db.getAll('visits'),
        bowls: await db.getAll('bowls'),
        settings: await db.getSettings(),
      });
      return { tried: computed.triedCombos.size, total: await menu.comboCount() };`);
    assert.match(await app.text(), new RegExp(`${expected.tried} of ${expected.total} tried`));
    app.assertNoErrors();
  }, { seed: RICH_FIXTURE });
});
