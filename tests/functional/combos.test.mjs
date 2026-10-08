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

async function openIngredients(app) {
  await app.eval(`(() => {
    const details = [...document.querySelectorAll('#view details')]
      .find((node) => node.querySelector('summary')?.textContent.includes('Ingredients'));
    if (details) details.open = true;
    return !!details;
  })()`);
}

async function toggleIngredient(app, groupLabel, name) {
  const ok = await app.eval(`(() => {
    const group = document.querySelector('[aria-label="${groupLabel} used for suggestions"]');
    const chip = group && [...group.querySelectorAll('.chip')]
      .find((node) => node.textContent.trim() === ${JSON.stringify(name)});
    if (!chip) return false;
    chip.click();
    return true;
  })()`);
  assert.equal(ok, true, `no "${name}" chip in ${groupLabel}`);
  await app.waitFor('true');
}

async function suggestionText(app) {
  await app.click('Suggest something new');
  await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'suggestion modal' });
  const text = await app.text('#modal-host');
  await app.click('Close', '#modal-host button');
  await app.waitFor('document.getElementById("modal-host").hidden', { label: 'suggestion closed' });
  return text;
}

const DINERS = { people: [{ name: 'Alice', hasPass: true }, { name: 'Bob', hasPass: false }] };

/** Opens a visit for today whose last bowl is `bowl`, as if already at the table. */
async function sitDown(app, bowl = {
  person: 'Alice', pasta: 'Spaghetti', sauce: 'Meat Sauce', topping: 'Meatballs',
}) {
  return app.run(`
    const want = ${JSON.stringify(bowl)};
    const ui = await import('${app.origin}/js/ui.js');
    const ids = Object.fromEntries((await db.getAll('menuItems')).map((i) => [i.name, i.id]));
    const people = Object.fromEntries((await db.getAll('people')).map((p) => [p.name, p.id]));
    const visit = await db.startVisit({ date: ui.todayISO() });
    await db.save('bowls', {
      visitId: visit.id,
      personId: people[want.person],
      pastaId: ids[want.pasta],
      sauceId: ids[want.sauce],
      toppingId: want.topping ? ids[want.topping] : null,
      rating: null,
      notes: '',
      seq: 0,
    });
    return visit;
  `);
}

async function clickModalButton(app, text) {
  const ok = await app.eval(`(() => {
    const target = [...document.querySelectorAll('#modal-host button, #modal-host a')]
      .find((n) => n.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(ok, true, `no "${text}" button in the open modal`);
}

async function waitForBowlSheet(app) {
  await app.waitFor(
    `!document.getElementById('modal-host').hidden
      && document.querySelector('#modal-host h2')?.textContent === 'Add a bowl'`,
    { label: 'add-bowl sheet' },
  );
}

/** What the add-bowl sheet is set to, by visible label. */
function sheetChoices(app) {
  return app.eval(`(() => {
    const [who, pasta, sauce, topping] = [...document.querySelectorAll('#modal-host select')]
      .map((select) => (select.selectedOptions[0]?.text || '').replace(/ \\(NEW\\)$/, ''));
    return { who, pasta, sauce, topping };
  })()`);
}

async function saveBowlSheet(app) {
  await clickModalButton(app, 'Save');
  await app.waitFor(`document.getElementById('modal-host').hidden`, { label: 'bowl sheet saved' });
}

async function triedCount(app) {
  const match = (await app.text()).match(/(\d+) of \d+ tried/);
  assert.ok(match, 'coverage summary is on screen');
  return Number(match[1]);
}

function idsByName(app, store) {
  return app.run(`return Object.fromEntries((await db.getAll(${JSON.stringify(store)})).map((r) => [r.name, r.id]));`);
}

async function today(app) {
  return app.eval(`(async () => (await import('${app.origin}/js/ui.js')).todayISO())()`);
}

test('ingredients switched off are skipped by suggestions and persist across reloads', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    const before = await app.text();
    assert.match(before, /of 120 tried/, 'coverage starts from the full menu');

    await openIngredients(app);
    await toggleIngredient(app, 'Sauces', 'Creamy Mushroom');
    await toggleIngredient(app, 'Toppings', 'Italian Sausage');

    await app.waitFor(`(async () => {
      const module = await import('${app.origin}/js/db.js');
      const saved = (await module.getSettings()).comboExclusions;
      return Array.isArray(saved) && saved.length === 2;
    })()`, { label: 'exclusions saved' });

    // 4 pastas x 5 remaining sauces x (3 remaining toppings + no topping).
    assert.match(await app.text(), /Picks from the 80 of 120 combos you eat/);
    // Coverage still measures the whole promotion, not one diner's preferences.
    assert.match(await app.text(), /of 120 tried/);
    assert.match(await app.text(), /SKIPPED/);

    await app.reload();
    await app.goto('/combos');
    assert.match(await app.text(), /Picks from the 80 of 120 combos you eat/);

    for (let i = 0; i < 6; i++) {
      const suggestion = await suggestionText(app);
      assert.ok(!suggestion.includes('Creamy Mushroom'), suggestion);
      assert.ok(!suggestion.includes('Italian Sausage'), suggestion);
    }
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('the only combination left after opting out is the one suggested', async () => {
  await withApp(async (app) => {
    // One pasta, one sauce, one topping leaves exactly two combos: with the
    // topping and without it. Opting out of "No topping" leaves precisely one.
    await trimMenuTo(app, {
      pastaName: 'Fettuccine', sauceName: 'Alfredo', keepToppings: ['Meatballs'],
    });
    await app.reload();
    await app.goto('/combos');
    assert.match(await app.text(), /0 of 2 tried/);

    await openIngredients(app);
    await toggleIngredient(app, 'Toppings', 'No topping');
    assert.match(await app.text(), /Picks from the 1 of 2 combos you eat/);

    assert.match(await suggestionText(app), /Fettuccine with Alfredo and Meatballs/);
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Alice' }] } });
});

test('opting out of every pasta explains that nothing matches', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    await openIngredients(app);
    for (const pasta of ['Fettuccine', 'Spaghetti', 'Angel Hair', 'Rigatoni']) {
      await toggleIngredient(app, 'Pastas', pasta);
    }

    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'no-match modal' });
    const text = await app.text('#modal-host');
    assert.match(text, /No combos match/i);
    assert.match(text, /Turn at least one of each back on/i);
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

test('use everything again clears every opt-out', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    await openIngredients(app);
    await toggleIngredient(app, 'Sauces', 'Creamy Mushroom');
    assert.match(await app.text(), /skipping 1 ingredient/);

    await app.click('Use everything again');
    await app.waitFor(`(async () => {
      const module = await import('${app.origin}/js/db.js');
      return (await module.getSettings()).comboExclusions.length === 0;
    })()`, { label: 'exclusions cleared' });

    const text = await app.text();
    assert.match(text, /using everything/i);
    assert.doesNotMatch(text, /SKIPPED/);
    app.assertNoErrors();
  }, { seed: COMBO_FIXTURE });
});

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

test('Log it on a suggestion opens the add-bowl sheet set to that combo for the open visit, not the visit form', async () => {
  await withApp(async (app) => {
    const visit = await sitDown(app);
    await app.goto('/combos');
    const before = await triedCount(app);

    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'suggestion modal' });
    const suggestion = await app.text('#modal-host');
    await clickModalButton(app, 'Log it');
    await waitForBowlSheet(app);

    assert.equal(await app.eval('location.hash'), '#/combos', 'stays on the explorer');
    const choices = await sheetChoices(app);
    const named = `Try ${choices.pasta} with ${choices.sauce}`
      + `${choices.topping === 'No topping' ? '' : ` and ${choices.topping}`}.`;
    assert.ok(suggestion.includes(named), `sheet is set to "${named}" but suggested: ${suggestion}`);
    assert.equal(choices.who, 'Alice', 'with no filter the last diner is kept');
    assert.match(await app.text('#modal-host'), /Pre-filled with the combo you picked/);

    await saveBowlSheet(app);

    const menu = await idsByName(app, 'menuItems');
    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    assert.equal(bowls.length, 2);
    assert.equal(bowls[1].visitId, visit.id);
    assert.equal(bowls[1].seq, 1);
    assert.deepEqual(
      [bowls[1].pastaId, bowls[1].sauceId, bowls[1].toppingId],
      [menu[choices.pasta], menu[choices.sauce], menu[choices.topping] ?? null],
    );
    const visits = await app.store('visits');
    assert.equal(visits.length, 1, 'no second visit is started');
    assert.equal(visits[0].endedAt, null);

    // The explorer redraws in place, so the combo just logged is now tried.
    await app.waitFor(`document.querySelector(${JSON.stringify(
      cellSelector(choices.pasta, choices.sauce, choices.topping),
    )})?.textContent === '✓'`, { label: 'logged square marked tried' });
    assert.equal(await triedCount(app), before + 1);
    assert.equal(await app.eval('location.hash'), '#/combos');
    app.assertNoErrors();
  }, { seed: DINERS });
});

test('Log it keeps a suggested No topping instead of the last bowl\'s topping', async () => {
  await withApp(async (app) => {
    // With one pasta, one sauce and one topping, trying the topped combo leaves
    // only the plain one to suggest — while the last bowl still has a topping.
    await trimMenuTo(app, {
      pastaName: 'Fettuccine', sauceName: 'Alfredo', keepToppings: ['Meatballs'],
    });
    await sitDown(app, {
      person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: 'Meatballs',
    });
    await app.reload();
    await app.goto('/combos');
    assert.match(await app.text(), /1 of 2 tried/);

    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'suggestion modal' });
    assert.match(await app.text('#modal-host'), /Try Fettuccine with Alfredo\./);
    await clickModalButton(app, 'Log it');
    await waitForBowlSheet(app);

    assert.deepEqual(await sheetChoices(app), {
      who: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: 'No topping',
    });
    await saveBowlSheet(app);

    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    assert.equal(bowls.length, 2);
    assert.equal(bowls[1].toppingId, null);
    await app.waitFor(`document.getElementById('view').innerText.includes('2 of 2 tried')`,
      { label: 'coverage complete' });
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Alice' }] } });
});

test('Log it starts a visit for today when none is open', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'suggestion modal' });
    await clickModalButton(app, 'Log it');
    await waitForBowlSheet(app);

    const [visit, ...others] = await app.store('visits');
    assert.equal(others.length, 0);
    assert.equal(visit.date, await today(app));
    assert.equal(visit.endedAt, null);

    const choices = await sheetChoices(app);
    await saveBowlSheet(app);
    const menu = await idsByName(app, 'menuItems');
    const [bowl] = await app.store('bowls');
    assert.equal(bowl.visitId, visit.id);
    assert.equal(bowl.pastaId, menu[choices.pasta]);
    assert.equal(bowl.sauceId, menu[choices.sauce]);
    assert.equal(bowl.toppingId, menu[choices.topping] ?? null);
    assert.equal(await app.eval('location.hash'), '#/combos');
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Alice' }] } });
});

test('Log this combo on a square pre-fills that combo for the filtered diner', async () => {
  await withApp(async (app) => {
    const visit = await sitDown(app);
    await app.goto('/combos');
    await app.click('Bob', '.chip');
    const square = cellSelector('Angel Hair', 'Five Cheese Marinara', 'Italian Sausage');
    assert.equal(await app.eval(`document.querySelector(${JSON.stringify(square)}).textContent`), '·');

    await app.clickSelector(square);
    await clickModalButton(app, 'Log this combo');
    await waitForBowlSheet(app);
    assert.deepEqual(await sheetChoices(app), {
      who: 'Bob', pasta: 'Angel Hair', sauce: 'Five Cheese Marinara', topping: 'Italian Sausage',
    });
    await saveBowlSheet(app);

    const people = await idsByName(app, 'people');
    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    assert.equal(bowls.length, 2);
    assert.equal(bowls[1].personId, people.Bob);
    assert.equal(bowls[1].visitId, visit.id);

    // Bob's filter survives the redraw and now shows the square as tried.
    await app.waitFor(`document.querySelector(${JSON.stringify(square)})?.textContent === '✓'`,
      { label: 'square marked tried for Bob' });
    const pressed = await app.eval(`[...document.querySelectorAll(
      '[aria-label="Combo person filter"] .chip[aria-pressed="true"]',
    )].map((n) => n.textContent.trim())`);
    assert.deepEqual(pressed, ['Bob']);
    app.assertNoErrors();
  }, { seed: DINERS });
});

test('the explorer\'s Log a bowl button opens the add-bowl sheet, not the visit form', async () => {
  await withApp(async (app) => {
    await sitDown(app);
    await app.goto('/combos');
    await app.click('Log a bowl', '#view header .btn');
    await waitForBowlSheet(app);

    assert.equal(await app.eval('location.hash'), '#/combos');
    assert.match(await app.text('#modal-host'), /Pre-filled with the last bowl/);
    assert.deepEqual(await sheetChoices(app), {
      who: 'Alice', pasta: 'Spaghetti', sauce: 'Meat Sauce', topping: 'Meatballs',
    });

    await clickModalButton(app, 'Cancel');
    await app.waitFor(`document.getElementById('modal-host').hidden`, { label: 'sheet cancelled' });
    assert.equal((await app.store('bowls')).length, 1);
    assert.equal((await app.store('visits')).length, 1);
    app.assertNoErrors();
  }, { seed: DINERS });
});

test('Log it with no diners asks for one instead of leaving an empty visit open', async () => {
  await withApp(async (app) => {
    await app.goto('/combos');
    await app.click('Suggest something new');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'suggestion modal' });
    await clickModalButton(app, 'Log it');
    await app.waitFor(`document.getElementById('modal-host').innerText.includes('Add a diner first')`,
      { label: 'add a diner prompt' });

    assert.equal((await app.store('visits')).length, 0);
    await clickModalButton(app, 'Close');
    await app.waitFor(`document.getElementById('modal-host').hidden`, { label: 'prompt closed' });
    app.assertNoErrors();
  });
});
