import test from 'node:test';
import assert from 'node:assert/strict';

import { withApp } from '../helpers/app.mjs';

const FIXTURE = {
  people: [{ name: 'Alice', hasPass: true, passCost: 100 }],
  locations: [{ name: 'OG', defaultMealPrice: 11.11, defaultToppingPrice: 2.22 }],
  visits: [{
    date: '2026-08-24',
    location: 'OG',
    mealPrice: 11.11,
    toppingPrice: 2.22,
    bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }],
  }],
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

async function clickRowButton(app, title, button) {
  const ok = await app.eval(`(() => {
    const row = [...document.querySelectorAll('#view .list__item')]
      .find((node) => node.querySelector('.list__title')?.textContent.trim() === ${JSON.stringify(title)});
    const btn = row && [...row.querySelectorAll('button')]
      .find((node) => node.textContent.includes(${JSON.stringify(button)}));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  assert.equal(ok, true, `button "${button}" was not available for ${title}`);
}

async function setField(app, label, value) {
  const ok = await app.eval(`(() => {
    const field = [...document.querySelectorAll('#view .field')]
      .find((node) => node.querySelector('.field__label')?.textContent.trim() === ${JSON.stringify(label)});
    const input = field?.querySelector('input, select');
    if (!input) return false;
    input.value = ${JSON.stringify(String(value))};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(ok, true, `field "${label}" was not found`);
}

async function selectOptionsFor(app, label) {
  return app.eval(`(() => {
    const field = [...document.querySelectorAll('#view .field')]
      .find((node) => node.querySelector('.field__label')?.textContent.trim() === ${JSON.stringify(label)});
    return field ? [...field.querySelector('select').options].map((o) => o.textContent.trim()) : [];
  })()`);
}

async function addMenuItem(app, kind, name) {
  await app.goto('/settings');
  await app.click(`Add ${kind}`);
  await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'add menu modal' });
  await app.setInput('#modal-host input[type=text]', name);
  await app.click('Save', '#modal-host button');
  await app.waitFor(`document.getElementById('view').innerText.includes(${JSON.stringify(name)})`);
}

test('menu editor mutations update pickers, cached menu data, history, and combo totals immediately', async () => {
  await withApp(async (app) => {
    await addMenuItem(app, 'pasta', 'Bucatini');
    const uiText = await app.text();
    let active = await app.run("return (await menu.listMenu('pasta')).map((i) => i.name);");
    assert.ok(active.includes('Bucatini'));
    assert.match(uiText, /Bucatini/);

    await app.goto('/visits/new');
    await app.click('Add bowl');
    assert.ok((await selectOptionsFor(app, 'Pasta')).includes('Bucatini'));

    await app.goto('/settings');
    await clickRowButton(app, 'Fettuccine', 'Rename');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'rename modal' });
    await app.setInput('#modal-host input[type=text]', 'Fettuccine Finale');
    await app.click('Save', '#modal-host button');
    active = await app.run("return (await menu.listMenu('pasta')).map((i) => i.name);");
    assert.ok(active.includes('Fettuccine Finale'));

    const visitId = (await app.store('visits'))[0].id;
    await app.goto(`/visits/${visitId}`);
    assert.match(await app.text(), /Fettuccine Finale/);

    await app.goto('/settings');
    await clickRowButton(app, 'Bucatini', 'Retire');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'retire modal' });
    await app.click('Retire', '#modal-host button');
    active = await app.run("return (await menu.listMenu('pasta')).map((i) => i.name);");
    assert.ok(!active.includes('Bucatini'));
    const retired = await app.run("return (await db.getAll('menuItems')).find((i) => i.name === 'Bucatini');");
    assert.ok(retired.deletedAt, 'retiring should soft-delete with deletedAt');

    await app.goto('/visits/new');
    await app.click('Add bowl');
    assert.ok(!(await selectOptionsFor(app, 'Pasta')).includes('Bucatini'));

    await app.goto('/settings');
    await clickRowButton(app, 'Bucatini', 'Restore');
    await app.waitFor("document.getElementById('view').innerText.includes('Bucatini')");
    active = await app.run("return (await menu.listMenu('pasta')).map((i) => i.name);");
    assert.ok(active.includes('Bucatini'));

    const counts = await app.run(`return {
      p: (await menu.listMenu('pasta')).length,
      s: (await menu.listMenu('sauce')).length,
      t: (await menu.listMenu('topping')).length,
      c: await menu.comboCount(),
    };`);
    assert.equal(counts.c, counts.p * counts.s * (counts.t + 1));
    assert.match(await app.text(), new RegExp(`${counts.p} pastas x ${counts.s} sauces x ${counts.t + 1} topping options = ${counts.c}`));
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('delete forever is offered only for unreferenced menu items', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    const availability = await app.eval(`(() => {
      const found = {};
      for (const name of ['Alfredo', 'Creamy Mushroom']) {
        const row = [...document.querySelectorAll('#view .list__item')]
          .find((node) => node.querySelector('.list__title')?.textContent.trim() === name);
        found[name] = !![...(row?.querySelectorAll('button') || [])]
          .find((button) => button.textContent.includes('Delete forever'));
      }
      return found;
    })()`);
    assert.equal(availability.Alfredo, false, 'referenced sauce must not be hard-deletable');
    assert.equal(availability['Creamy Mushroom'], true, 'unused sauce should be hard-deletable');

    await clickRowButton(app, 'Creamy Mushroom', 'Delete forever');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'delete modal' });
    await app.click('Delete forever', '#modal-host button');
    const sauces = await app.run("return (await db.getAll('menuItems')).filter((i) => i.kind === 'sauce').map((i) => i.name);");
    assert.ok(!sauces.includes('Creamy Mushroom'));
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('appearance choices apply to the document, meta theme color, localStorage, and survive reloads', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    for (const [label, expected] of [['Light', 'light'], ['Dark', 'dark'], ['System', null]]) {
      await app.click(label, '.chip');
      const scheme = await app.eval("document.documentElement.getAttribute('data-scheme')");
      if (expected) assert.equal(scheme, expected);
      else assert.match(scheme, /^(light|dark)$/);
      await app.reload();
      assert.equal(JSON.parse(await app.eval("localStorage.getItem('ppt.theme')")).mode, label.toLowerCase());
    }

    const before = await app.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
    await app.click('Basil', '.chip');
    assert.equal(await app.eval("document.documentElement.getAttribute('data-theme')"), 'basil');
    assert.notEqual(await app.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"), before);
    assert.equal(JSON.parse(await app.eval("localStorage.getItem('ppt.theme')")).palette, 'basil');

    const metaBefore = await app.eval("document.querySelector('meta[name=theme-color]').content");
    await app.click('Chianti', '.chip');
    assert.notEqual(await app.eval("document.querySelector('meta[name=theme-color]').content"), metaBefore);

    await app.click('Custom', '.chip');
    await setField(app, 'Custom palette accent', '#336699');
    assert.equal(await app.eval("document.documentElement.style.getPropertyValue('--accent').trim()"), '#336699');
    await app.reload();
    assert.equal(await app.eval("document.documentElement.getAttribute('data-theme')"), 'custom');
    assert.equal(await app.eval("document.documentElement.style.getPropertyValue('--accent').trim()"), '#336699');
    app.assertNoErrors();
  });
});

test('pricing and season settings persist, reload, affect dashboard countdown, and do not rewrite visit prices', async () => {
  await withApp(async (app) => {
    const originalVisit = (await app.store('visits'))[0];
    await app.goto('/settings');
    assert.notEqual(await app.eval("document.querySelector('#view input[type=number]').value"), '');

    const today = new Date();
    const start = addDays(today, 3);
    const end = addDays(today, 15);
    await setField(app, 'Meal price', '19.99');
    await setField(app, 'Topping surcharge', '6.50');
    await setField(app, 'Topping charge mode', 'perBowl');
    await setField(app, 'Pass cost', '125');
    await setField(app, 'Season start date', start);
    await setField(app, 'Season end date', end);

    let settings = await app.settings();
    assert.equal(settings.mealPrice, 19.99);
    assert.equal(settings.toppingPrice, 6.5);
    assert.equal(settings.toppingChargeMode, 'perBowl');
    assert.equal(settings.passCost, 125);
    assert.equal(settings.seasonStart, start);
    assert.equal(settings.seasonEnd, end);
    await app.reload();
    settings = await app.settings();
    assert.equal(settings.mealPrice, 19.99);

    assert.equal((await app.store('visits'))[0].mealPrice, originalVisit.mealPrice);
    await app.goto('/');
    assert.match(await app.text(), /days to go|days left|Starts today/);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('danger zone reset restores the default menu while historical bowls still render', async () => {
  await withApp(async (app) => {
    const visitId = await app.run(`const p = (await db.getAll('people'))[0];
      const pasta = await menu.saveMenuItem({ kind: 'pasta', name: 'Lost Pasta' });
      const sauce = (await menu.listMenu('sauce'))[0];
      const v = await db.save('visits', { date: '2026-09-01', locationId: null, mealPrice: 14.99, toppingPrice: 4.99 });
      await db.save('bowls', { visitId: v.id, personId: p.id, pastaId: pasta.id, sauceId: sauce.id, toppingId: null, seq: 0 });
      return v.id;`);
    await app.goto('/settings');
    await app.click('Reset menu to the 2026 defaults');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'reset modal' });
    await app.click('Reset menu', '#modal-host button');
    const counts = await app.run(`return {
      pastas: (await menu.listMenu('pasta')).length,
      sauces: (await menu.listMenu('sauce')).length,
      toppings: (await menu.listMenu('topping')).length,
    };`);
    assert.deepEqual(counts, { pastas: 4, sauces: 6, toppings: 4 });
    await app.goto(`/visits/${visitId}`);
    assert.match(await app.text(), /Deleted pasta/);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('erase all data can be cancelled and confirmed restore-seeds the app to a usable default menu', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    await app.click('Erase all data');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'erase modal' });
    await app.click('Cancel', '#modal-host button');
    assert.equal((await app.store('people')).length, 1);

    await app.click('Erase all data');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'erase modal' });
    await app.click('Erase all data', '#modal-host button');
    const counts = await app.run(`const out = {};
      for (const s of ['people', 'locations', 'visits', 'bowls', 'photos']) out[s] = (await db.getAll(s)).length;
      out.pastas = (await menu.listMenu('pasta')).length;
      out.sauces = (await menu.listMenu('sauce')).length;
      out.toppings = (await menu.listMenu('topping')).length;
      return out;`);
    assert.deepEqual(counts, { people: 0, locations: 0, visits: 0, bowls: 0, photos: 0, pastas: 4, sauces: 6, toppings: 4 });

    await app.run("await db.save('people', { name: 'Usable', color: '#9a2820', hasPass: false, active: true });");
    await app.goto('/visits/new');
    await app.click('Add bowl');
    assert.ok((await selectOptionsFor(app, 'Pasta')).length >= 4);
    assert.ok((await selectOptionsFor(app, 'Sauce')).length >= 6);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});
