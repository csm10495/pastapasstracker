/**
 * Functional tests for visit logging, editing, listing, and detail views.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { withApp } from '../helpers/app.mjs';

const FIXTURE = {
  people: [
    { name: 'Alice', hasPass: true, passCost: 100, passPurchasedOn: '2026-07-16' },
    { name: 'Bob', hasPass: false },
  ],
  locations: [
    { name: 'OG Brookfield', city: 'Brookfield', state: 'WI', defaultMealPrice: 15.99, defaultToppingPrice: 4.99 },
    { name: 'OG Madison', city: 'Madison', state: 'WI', defaultMealPrice: 17.49, defaultToppingPrice: 5.49 },
  ],
};

const VISIT_FIXTURE = {
  ...FIXTURE,
  visits: [
    {
      date: '2026-09-02',
      location: 'OG Brookfield',
      mealPrice: 15.99,
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: null, rating: 5 },
        { person: 'Bob', pasta: 'Spaghetti', sauce: 'Alfredo', topping: 'Meatballs', rating: 4 },
      ],
    },
  ],
};

async function addBowl(app) {
  await app.click('Add bowl');
}

async function fillBowl(app, index, { person, pasta, sauce, topping = null }) {
  const base = 1 + index * 5;
  if (person) await app.setSelectByText('select', person, base);
  if (pasta) await app.setSelectByText('select', pasta, base + 1);
  if (sauce) await app.setSelectByText('select', sauce, base + 2);
  await app.setSelectByText('select', topping || 'No topping', base + 3);
}

async function saveVisit(app) {
  await app.click('Save');
  await app.waitFor(
    `location.hash.startsWith('#/visits/') && !location.hash.endsWith('/new') && !location.hash.endsWith('/edit')`,
    { label: 'visit detail after save' },
  );
}

test('logging a visit persists the selected location, frozen price, local date, and bowls', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.setSelectByText('select', 'OG Brookfield', 0);
    assert.equal(await app.eval(`document.querySelectorAll('input[type=number]')[0].value`), '15.99');
    await app.setInput('input[type=date]', '2026-09-03');

    await addBowl(app);
    await fillBowl(app, 0, {
      person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: 'Meatballs',
    });
    await addBowl(app);
    await fillBowl(app, 1, {
      person: 'Bob', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: null,
    });

    await saveVisit(app);

    const visits = await app.store('visits');
    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    const people = new Map((await app.store('people')).map((p) => [p.name, p.id]));
    const menu = await app.run(`return Object.fromEntries((await db.getAll('menuItems')).map((i) => [i.name, i.id]));`);
    const location = (await app.store('locations')).find((l) => l.name === 'OG Brookfield');

    assert.equal(visits.length, 1);
    assert.equal(visits[0].date, '2026-09-03');
    assert.equal(visits[0].locationId, location.id);
    assert.equal(visits[0].mealPrice, 15.99);
    assert.equal(bowls.length, 2);
    assert.deepEqual(bowls.map((b) => b.visitId), [visits[0].id, visits[0].id]);
    assert.deepEqual(bowls.map((b) => [b.personId, b.pastaId, b.sauceId, b.toppingId]), [
      [people.get('Alice'), menu.Fettuccine, menu['Spicy Alfredo'], menu.Meatballs],
      [people.get('Bob'), menu.Rigatoni, menu['Meat Sauce'], null],
    ]);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('manual meal price entry is not clobbered when the location changes', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.setInput('input[type=number]', '12.34', 0);
    await app.setSelectByText('select', 'OG Madison', 0);
    assert.equal(await app.eval(`document.querySelectorAll('input[type=number]')[0].value`), '12.34');
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('saving with no location stores null and falls back to the global meal price', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.setInput('input[type=date]', '2026-09-04');
    await app.setSelectByText('select', '— No location —', 0);
    await addBowl(app);
    await fillBowl(app, 0, { person: 'Alice', pasta: 'Spaghetti', sauce: 'Meat Sauce' });

    await saveVisit(app);
    const [visit] = await app.store('visits');
    assert.equal(visit.locationId, null);
    assert.equal(visit.mealPrice, 18.25);
    app.assertNoErrors();
  }, { seed: { ...FIXTURE, settings: { mealPrice: 18.25 } } });
});

test('saving without required visit or bowl fields shows an error toast and creates no records', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.setInput('input[type=date]', '');
    await app.click('Save');
    assert.match(await app.toastText(), /Choose a date/i);
    assert.equal((await app.store('visits')).length, 0);

    await app.setInput('input[type=date]', '2026-09-05');
    await addBowl(app);
    await app.eval(`(() => {
      const node = document.querySelectorAll('select')[1];
      node.value = '';
      node.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await app.click('Save');
    assert.match(await app.toastText(), /Each bowl needs a person, pasta, and sauce/i);
    assert.equal((await app.store('visits')).length, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('repeat last bowl clones diner, menu choices, and no-topping selection', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.setInput('input[type=date]', '2026-09-06');
    await addBowl(app);
    await fillBowl(app, 0, {
      person: 'Bob', pasta: 'Rigatoni', sauce: 'Five Cheese Marinara', topping: null,
    });
    await app.click('Repeat last bowl');
    await saveVisit(app);

    const bowls = await app.store('bowls');
    assert.equal(bowls.length, 2);
    assert.equal(bowls[1].personId, bowls[0].personId);
    assert.equal(bowls[1].pastaId, bowls[0].pastaId);
    assert.equal(bowls[1].sauceId, bowls[0].sauceId);
    assert.equal(bowls[1].toppingId, null);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('menu options mark new items with NEW text', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await addBowl(app);
    const sauceOptions = await app.optionTexts('select', 3);
    const toppingOptions = await app.optionTexts('select', 4);
    assert.ok(sauceOptions.some((text) => /Spicy Alfredo.*NEW/.test(text)));
    assert.ok(toppingOptions.some((text) => /Crispy Shrimp Fritta.*NEW/.test(text)));
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('editing a visit keeps the frozen price, updates bowls, removes deleted bowls, and sequences new bowls', async () => {
  await withApp(async (app) => {
    const [visit] = await app.store('visits');
    const originalBowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    await app.run(`
      const loc = (await db.getAll('locations')).find((l) => l.name === 'OG Brookfield');
      await db.save('locations', { ...loc, defaultMealPrice: 99.99 });
    `);

    await app.goto(`/visits/${visit.id}/edit`);
    assert.equal(await app.eval(`document.querySelectorAll('input[type=number]')[0].value`), '15.99');
    await app.setSelectByText('select', 'Bob', 1);
    await app.clickSelector('button.btn--danger', 1);
    await addBowl(app);
    await fillBowl(app, 1, {
      person: 'Alice', pasta: 'Angel Hair', sauce: 'Traditional Marinara', topping: 'Italian Sausage',
    });
    await saveVisit(app);

    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    const people = new Map((await app.store('people')).map((p) => [p.name, p.id]));
    assert.equal(bowls.length, 2);
    assert.equal(bowls[0].id, originalBowls[0].id);
    assert.equal(bowls[0].personId, people.get('Bob'));
    assert.equal(bowls.some((b) => b.id === originalBowls[1].id), false);
    assert.deepEqual(bowls.map((b) => b.seq), [0, 1]);
    assert.equal(bowls[1].personId, people.get('Alice'));
    app.assertNoErrors();
  }, { seed: VISIT_FIXTURE });
});

test('visit list shows newest visits first, bowl counts, no-location labels, and the empty state', async () => {
  await withApp(async (app) => {
    await app.seed({
      ...FIXTURE,
      visits: [
        { date: '2026-08-24', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo' }] },
        { date: '2026-09-10', location: null, bowls: [{ person: 'Alice', pasta: 'Rigatoni', sauce: 'Meat Sauce' }, { person: 'Bob', pasta: 'Spaghetti', sauce: 'Alfredo' }] },
      ],
    });
    await app.goto('/visits');
    const titles = await app.eval(`[...document.querySelectorAll('.list__title')].map((n) => n.innerText)`);
    assert.match(titles[0], /Sep 10, 2026|2026/);
    assert.match(await app.text(), /No location.*2 bowls.*OG Brookfield.*1 bowl/i);

    await app.resetData();
    await app.goto('/visits');
    assert.match(await app.text(), /No visits yet/i);
    app.assertNoErrors();
  });
});

test('visit detail renders grouped bowls, no topping, and retired menu items without blanks', async () => {
  await withApp(async (app) => {
    const [visit] = await app.store('visits');
    const sauceId = (await app.store('bowls'))[1].sauceId;
    await app.run(`await menu.retireMenuItem(${JSON.stringify(sauceId)});`);
    await app.goto(`/visits/${visit.id}`);

    const text = await app.text();
    assert.match(text, /Alice.*Fettuccine.*Spicy Alfredo.*No topping/is);
    assert.match(text, /Bob.*Spaghetti.*Alfredo.*Meatballs/is);
    app.assertNoErrors();
  }, { seed: VISIT_FIXTURE });
});

test('deleting a visit from detail confirms first and cascades to its bowls', async () => {
  await withApp(async (app) => {
    const [visit] = await app.store('visits');
    await app.goto(`/visits/${visit.id}`);
    await app.click('Delete visit');
    assert.equal(await app.modalOpen(), true);
    await app.clickSelector('#modal-host button.btn--danger');
    await app.waitFor(`location.hash === '#/visits' && (await (await import('${app.origin}/js/db.js')).getAll('visits')).length === 0`);

    assert.equal((await app.store('visits')).length, 0);
    assert.equal((await app.store('bowls')).length, 0);
    app.assertNoErrors();
  }, { seed: VISIT_FIXTURE });
});
