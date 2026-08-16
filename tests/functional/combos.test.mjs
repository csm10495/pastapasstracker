import test from 'node:test';
import assert from 'node:assert/strict';

import { withApp } from '../helpers/app.mjs';

const COMBO_FIXTURE = {
  people: [{ name: 'Alice', hasPass: true }, { name: 'Bob', hasPass: false }],
  visits: [
    {
      date: '2026-09-01',
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: null },
        { person: 'Alice', pasta: 'Spaghetti', sauce: 'Alfredo', topping: 'Meatballs' },
        { person: 'Bob', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: 'Crispy Shrimp Fritta' },
      ],
    },
    {
      date: '2026-09-02',
      bowls: [
        { person: 'Bob', pasta: 'Angel Hair', sauce: 'Traditional Marinara', topping: null },
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: null },
      ],
    },
  ],
};

async function comboState(app) {
  return app.run(`
    const [pastas, sauces, toppings, bowls] = await Promise.all([
      menu.listMenu('pasta'), menu.listMenu('sauce'), menu.listMenu('topping'), db.getAll('bowls'),
    ]);
    const possible = new Set();
    for (const pasta of pastas) for (const sauce of sauces) {
      possible.add(menu.comboKey(pasta.id, sauce.id, null));
      for (const topping of toppings) possible.add(menu.comboKey(pasta.id, sauce.id, topping.id));
    }
    const tried = new Set();
    for (const bowl of bowls) {
      const key = menu.comboKey(bowl.pastaId, bowl.sauceId, bowl.toppingId);
      if (possible.has(key)) tried.add(key);
    }
    return {
      total: pastas.length * sauces.length * (toppings.length + 1),
      tried: tried.size,
      triedKeys: [...tried],
      pastas, sauces, toppings,
    };
  `);
}

function cellSelector(pasta, sauce, topping = 'No topping') {
  return `[role=gridcell][aria-label="${pasta}, ${sauce}, ${topping} — tried"], [role=gridcell][aria-label="${pasta}, ${sauce}, ${topping} — not tried yet"]`;
}

async function trimMenuTo(app, { pastaName, sauceName, keepToppings = [] }) {
  await app.run(`
    const keep = ${JSON.stringify({ pastaName, sauceName, keepToppings })};
    const items = await db.getAll('menuItems');
    for (const item of items) {
      const keepItem =
        (item.kind === 'pasta' && item.name === keep.pastaName) ||
        (item.kind === 'sauce' && item.name === keep.sauceName) ||
        (item.kind === 'topping' && keep.keepToppings.includes(item.name));
      if (!keepItem) await menu.retireMenuItem(item.id);
    }
    menu.invalidateMenuCache();
    return true;
  `);
}

test('coverage summary counts distinct seeded combos against the live menu total', async () => {
  await withApp(async (app) => {
    const state = await comboState(app);
    await app.goto('/combos');
    assert.match(await app.text(), new RegExp(`${state.tried} of ${state.total} tried`));
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('known logged combos are marked tried while missing combos are untried', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Fettuccine', 'Spicy Alfredo', 'No topping'))}).textContent`), '✓');
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Rigatoni', 'Meat Sauce', 'Crispy Shrimp Fritta'))}).textContent`), '✓');
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Fettuccine', 'Alfredo', 'Meatballs'))}).textContent`), '·');
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('No topping is its own combo column and can be tried', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    const headers = await app.eval(`[...document.querySelectorAll('[role=columnheader]')].map((n) => n.textContent.trim())`);
    assert.ok(headers.includes('No topping'));
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Angel Hair', 'Traditional Marinara', 'No topping'))}).textContent`), '✓');
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('person filter chips recompute tried combos per person and everyone restores the union', async () => {
  await withApp(async (app) => {
    const counts = await app.run(`
      const [people, pastas, sauces, toppings, bowls] = await Promise.all([
        db.getAll('people'), menu.listMenu('pasta'), menu.listMenu('sauce'), menu.listMenu('topping'), db.getAll('bowls'),
      ]);
      const possible = new Set();
      for (const pasta of pastas) for (const sauce of sauces) {
        possible.add(menu.comboKey(pasta.id, sauce.id, null));
        for (const topping of toppings) possible.add(menu.comboKey(pasta.id, sauce.id, topping.id));
      }
      const countFor = (personName) => {
        const person = people.find((p) => p.name === personName);
        return new Set(bowls
          .filter((b) => !person || b.personId === person.id)
          .map((b) => menu.comboKey(b.pastaId, b.sauceId, b.toppingId))
          .filter((key) => possible.has(key))).size;
      };
      return { everyone: countFor(null), alice: countFor('Alice'), bob: countFor('Bob'), total: pastas.length * sauces.length * (toppings.length + 1) };
    `);

    await app.goto('/combos');
    assert.match(await app.text(), new RegExp(`${counts.everyone} of ${counts.total} tried`));
    await app.click('Alice', '.chip');
    assert.match(await app.text(), new RegExp(`${counts.alice} of ${counts.total} tried`));
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Rigatoni', 'Meat Sauce', 'Crispy Shrimp Fritta'))}).textContent`), '·');
    await app.click('Bob', '.chip');
    assert.match(await app.text(), new RegExp(`${counts.bob} of ${counts.total} tried`));
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Rigatoni', 'Meat Sauce', 'Crispy Shrimp Fritta'))}).textContent`), '✓');
    await app.click('Everyone', '.chip');
    assert.match(await app.text(), new RegExp(`${counts.everyone} of ${counts.total} tried`));
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('Suggest something new proposes a genuinely untried combo', async () => {
  await withApp(async (app) => {
    const state = await comboState(app);
    await app.goto('/combos');
    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden');
    const suggestion = await app.text('#modal-host');
    const pasta = state.pastas.find((item) => suggestion.includes(item.name));
    const sauce = state.sauces.find((item) => suggestion.includes(item.name));
    const topping = state.toppings.find((item) => suggestion.includes(item.name)) || { id: null, name: 'No topping' };
    assert.ok(pasta, suggestion);
    assert.ok(sauce, suggestion);
    const key = `${pasta.id}|${sauce.id}|${topping.id || ''}`;
    assert.ok(!state.triedKeys.includes(key), `${suggestion} was already in ${state.triedKeys.join(', ')}`);
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('Suggest something new handles an all-tried tiny combo space', async () => {
  await withApp(async (app) => {
    await trimMenuTo(app, { pastaName: 'Fettuccine', sauceName: 'Alfredo' });
    await app.reload();
    await app.goto('/combos');
    assert.match(await app.text(), /1 of 1 tried/);
    await app.click('Suggest something new');
    assert.match(await app.text('#modal-host'), /All combos tried/i);
    app.assertNoErrors();
  }, {
    seed: {
      people: [{ name: 'Alice' }],
      visits: [{ date: '2026-09-01', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('clicking a combo cell opens a modal that names tried and untried combos', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    await app.clickSelector(cellSelector('Fettuccine', 'Spicy Alfredo', 'No topping'));
    assert.match(await app.text('#modal-host'), /Fettuccine with Spicy Alfredo/);
    assert.match(await app.text('#modal-host'), /Tried \d+ times?\./);
    await app.click('Close');

    await app.clickSelector(cellSelector('Fettuccine', 'Alfredo', 'Meatballs'));
    assert.match(await app.text('#modal-host'), /Fettuccine with Alfredo and Meatballs/);
    assert.match(await app.text('#modal-host'), /Not tried yet\./);
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('retiring a menu item shrinks the displayed combo total after reload', async () => {
  await withApp(async (app) => {
    const before = await comboState(app);
    await app.goto('/combos');
    assert.match(await app.text(), new RegExp(`of ${before.total} tried`));
    await app.run(`
      const toppings = await menu.listMenu('topping');
      await menu.retireMenuItem(toppings[0].id);
      menu.invalidateMenuCache();
      return true;
    `);
    await app.reload();
    const after = await comboState(app);
    assert.ok(after.total < before.total);
    assert.match(await app.text(), new RegExp(`of ${after.total} tried`));
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('the combo matrix renders with no bowls as all untried plus a hint', async () => {
  await withApp(async (app) => {
    const state = await comboState(app);
    await app.goto('/combos');
    assert.match(await app.text(), new RegExp(`0 of ${state.total} tried`));
    assert.match(await app.text(), /Log a visit to start filling this in\./);
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(cellSelector('Fettuccine', 'Alfredo', 'No topping'))}).textContent`), '·');
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Alice' }] } });
});

test('empty combo explorer state appears when there are no active menu items', async () => {
  await withApp(async (app) => {
    await app.run(`
      for (const item of await db.getAll('menuItems')) await menu.retireMenuItem(item.id);
      menu.invalidateMenuCache();
      return true;
    `);
    await app.reload();
    await app.goto('/combos');
    assert.match(await app.text(), /No menu items/i);
    app.assertNoErrors();
  });
});
