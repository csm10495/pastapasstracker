/**
 * Functional tests for the open/ended visit lifecycle and quick bowl sheet.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fixturePng, withApp } from '../helpers/app.mjs';

const FIXTURE = {
  people: [
    { name: 'Alice', hasPass: true, passCost: 100, passPurchasedOn: '2026-07-16' },
    { name: 'Bob', hasPass: false },
  ],
  locations: [
    { name: 'OG Brookfield', city: 'Brookfield', state: 'WI', defaultMealPrice: 15.99, defaultToppingPrice: 4.99 },
    { name: 'OG Global Fallback', city: 'Milwaukee', state: 'WI', defaultMealPrice: null, defaultToppingPrice: null },
  ],
  settings: { mealPrice: 18.25, toppingPrice: 5.25 },
};

async function today(app) {
  return app.eval(`(async () => (await import('${app.origin}/js/ui.js')).todayISO())()`);
}

async function idsByName(app, store) {
  return app.run(`return Object.fromEntries((await db.getAll(${JSON.stringify(store)})).map((r) => [r.name, r.id]));`);
}

async function menuIds(app) {
  return app.run(`return Object.fromEntries((await db.getAll('menuItems')).map((i) => [i.name, i.id]));`);
}

async function startVisit(app, overrides = {}) {
  const arg = JSON.stringify(overrides);
  return app.run(`return db.startVisit(${arg});`);
}

async function seedEndedVisit(app, overrides = {}) {
  const record = {
    date: '2026-08-01',
    locationId: null,
    notes: '',
    mealPrice: 18.25,
    toppingPrice: 5.25,
    endedAt: '2026-08-01T20:00:00.000Z',
    ...overrides,
  };
  return app.run(`return db.save('visits', ${JSON.stringify(record)});`);
}

async function openQuickSheet(app, route = '/visits') {
  await app.goto(route);
  await app.click('Add bowl');
  await app.waitFor(`!document.getElementById('modal-host').hidden`, { label: 'quick-add sheet' });
}

async function saveQuickSheet(app) {
  await app.clickSelector('#modal-host button.btn--primary');
  await app.waitFor(`document.getElementById('modal-host').hidden`, { label: 'quick-add saved' });
}

async function clickModalButton(app, text) {
  const ok = await app.eval(`(() => {
    const nodes = [...document.querySelectorAll('#modal-host button')];
    const target = nodes.find((n) => n.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!ok) throw new Error(`No modal button: ${text}`);
}

async function openVisits(app) {
  return (await app.store('visits')).filter((visit) => !visit.endedAt);
}

async function gotoLog(app) {
  await app.eval(`(() => {
    if (location.hash === '#/log') {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = '#/log';
    }
  })()`);
  await app.waitFor(`!document.getElementById('modal-host').hidden`, { label: 'log quick-add sheet' });
}

test('starting from the dashboard creates an open visit for today with fallback prices', async () => {
  await withApp(async (app) => {
    const expectedToday = await today(app);
    await app.goto('/');
    await app.click('🍝 Start a visit');
    await app.waitFor(`!document.getElementById('modal-host').hidden`, { label: 'start opens bowl sheet' });
    await clickModalButton(app, 'Cancel');
    await app.waitFor(`document.getElementById('modal-host').hidden`, { label: 'cancel quick sheet' });

    const [visit] = await app.store('visits');
    assert.equal(visit.date, expectedToday);
    assert.equal(visit.endedAt, null);
    assert.equal(visit.mealPrice, 18.25);
    assert.equal(visit.toppingPrice, 5.25);

    const locations = await idsByName(app, 'locations');
    const withLocation = await startVisit(app, { date: expectedToday, locationId: locations['OG Brookfield'] });
    assert.equal(withLocation.mealPrice, 15.99);
    assert.equal(withLocation.toppingPrice, 4.99);
    assert.equal((await openVisits(app)).length, 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('quick-add sheet saves a bowl on the open visit with the next sequence', async () => {
  await withApp(async (app) => {
    const visit = await startVisit(app, { date: await today(app) });
    await openQuickSheet(app);
    const labels = await app.eval(`[...document.querySelectorAll('#modal-host .field__label')].map((n) => n.textContent.trim())`);
    assert.deepEqual(labels.slice(0, 4), ['Who', 'Pasta', 'Sauce', 'Topping']);
    await app.setSelectByText('#modal-host select', 'Bob', 0);
    await app.setSelectByText('#modal-host select', 'Rigatoni', 1);
    await app.setSelectByText('#modal-host select', 'Meat Sauce', 2);
    await app.setSelectByText('#modal-host select', 'Meatballs', 3);
    await saveQuickSheet(app);

    const [bowl] = await app.store('bowls');
    const people = await idsByName(app, 'people');
    const menu = await menuIds(app);
    assert.equal(bowl.visitId, visit.id);
    assert.equal(bowl.seq, 0);
    assert.equal(bowl.personId, people.Bob);
    assert.equal(bowl.pastaId, menu.Rigatoni);
    assert.equal(bowl.sauceId, menu['Meat Sauce']);
    assert.equal(bowl.toppingId, menu.Meatballs);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('quick-add pre-fills from the previous bowl so saving immediately repeats it', async () => {
  await withApp(async (app) => {
    const visit = await startVisit(app, { date: await today(app) });
    const people = await idsByName(app, 'people');
    const menu = await menuIds(app);
    await app.run(`
      await db.save('bowls', {
        visitId: ${JSON.stringify(visit.id)},
        personId: ${JSON.stringify(people.Alice)},
        pastaId: ${JSON.stringify(menu.Fettuccine)},
        sauceId: ${JSON.stringify(menu['Spicy Alfredo'])},
        toppingId: ${JSON.stringify(menu.Meatballs)},
        rating: null,
        notes: '',
        seq: 0,
      });
    `);

    await openQuickSheet(app);
    await saveQuickSheet(app);

    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    assert.equal(bowls.length, 2);
    assert.deepEqual(
      [bowls[1].pastaId, bowls[1].sauceId, bowls[1].toppingId],
      [bowls[0].pastaId, bowls[0].sauceId, bowls[0].toppingId],
    );
    assert.equal(bowls[1].seq, 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('save and add another saves a bowl and reopens the quick-add sheet', async () => {
  await withApp(async (app) => {
    await startVisit(app, { date: await today(app) });
    await openQuickSheet(app);
    await clickModalButton(app, 'Save & add another');
    await app.waitFor(`!document.getElementById('modal-host').hidden && (await (await import('${app.origin}/js/db.js')).getAll('bowls')).length === 1`);
    await saveQuickSheet(app);

    const bowls = (await app.store('bowls')).sort((a, b) => a.seq - b.seq);
    assert.equal(bowls.length, 2);
    assert.deepEqual(bowls.map((b) => b.seq), [0, 1]);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('no topping is selectable in the quick-add sheet and stores null', async () => {
  await withApp(async (app) => {
    await startVisit(app, { date: await today(app) });
    await openQuickSheet(app);
    const toppingOptions = await app.optionTexts('#modal-host select', 3);
    assert.ok(toppingOptions.includes('No topping'));
    await app.setSelectByText('#modal-host select', 'No topping', 3);
    await saveQuickSheet(app);

    const [bowl] = await app.store('bowls');
    assert.equal(bowl.toppingId, null);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('ending a visit confirms first, cancel keeps it open, and confirm returns the dashboard to start mode', async () => {
  await withApp(async (app) => {
    await startVisit(app, { date: await today(app) });
    await app.goto('/');
    await app.click('End visit');
    assert.equal(await app.modalOpen(), true);
    await clickModalButton(app, 'Cancel');
    await app.waitFor(`document.getElementById('modal-host').hidden`);
    assert.equal((await openVisits(app)).length, 1);

    await app.click('End visit');
    await clickModalButton(app, 'End visit');
    await app.waitFor(`document.getElementById('view').innerText.includes('🍝 Start a visit')`);
    const [visit] = await app.store('visits');
    assert.match(visit.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(await app.text(), /Start a visit/);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('reopening an ended visit clears endedAt and ends any other open visit', async () => {
  await withApp(async (app) => {
    const ended = await seedEndedVisit(app, { date: '2026-08-02' });
    const other = await startVisit(app, { date: await today(app) });
    await app.goto(`/visits/${ended.id}`);
    await app.click('Reopen visit');
    await app.waitFor(`document.getElementById('view').innerText.includes('OPEN')`);

    const visits = await app.store('visits');
    const reopened = visits.find((visit) => visit.id === ended.id);
    const closed = visits.find((visit) => visit.id === other.id);
    assert.equal(reopened.endedAt, null);
    assert.match(closed.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(visits.filter((visit) => !visit.endedAt).length, 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('starting a second visit ends the first so only one visit is open', async () => {
  await withApp(async (app) => {
    const first = await startVisit(app, { date: '2026-08-10' });
    const second = await startVisit(app, { date: await today(app) });

    const visits = await app.store('visits');
    assert.equal(visits.filter((visit) => !visit.endedAt).length, 1);
    assert.match(visits.find((visit) => visit.id === first.id).endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(visits.find((visit) => visit.id === second.id).endedAt, null);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('the log route adds to an existing open visit and starts one when nothing is open', async () => {
  await withApp(async (app) => {
    const existing = await startVisit(app, { date: await today(app) });
    await gotoLog(app);
    await saveQuickSheet(app);
    await app.waitFor(`location.hash === '#/visits/${existing.id}'`);
    assert.equal((await app.store('visits')).length, 1);
    assert.equal((await app.store('bowls')).length, 1);

    await app.run(`await db.endVisit(${JSON.stringify(existing.id)});`);
    await gotoLog(app);
    await saveQuickSheet(app);
    await app.waitFor(`location.hash.startsWith('#/visits/') && location.hash !== '#/visits/${existing.id}'`);
    assert.equal((await app.store('visits')).length, 2);
    assert.equal((await app.store('bowls')).length, 2);
    assert.equal((await openVisits(app)).length, 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('visit form defaults today to open, can save history as ended, and opening one ends any other open visit', async () => {
  await withApp(async (app) => {
    const current = await startVisit(app, { date: await today(app) });
    await app.goto('/visits/new');
    assert.equal(await app.eval(`document.querySelector('input[type=checkbox]').checked`), true);
    await app.setInput('input[type=date]', '2026-08-01');
    if (await app.eval(`document.querySelector('input[type=checkbox]').checked`)) {
      await app.clickSelector('input[type=checkbox]');
    }
    await app.click('Save');
    await app.waitFor(`location.hash.startsWith('#/visits/') && !location.hash.endsWith('/new')`);
    let visits = await app.store('visits');
    const backdated = visits.find((visit) => visit.date === '2026-08-01');
    assert.match(backdated.endedAt, /^\d{4}-\d{2}-\d{2}T/);

    await app.goto('/visits/new');
    await app.setInput('input[type=date]', '2026-08-02');
    await app.click('Save');
    await app.waitFor(`location.hash.startsWith('#/visits/') && !location.hash.endsWith('/new')`);
    visits = await app.store('visits');
    const opened = visits.find((visit) => visit.date === '2026-08-02');
    assert.equal(opened.endedAt, null);
    assert.match(visits.find((visit) => visit.id === current.id).endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(visits.filter((visit) => !visit.endedAt).length, 1);

    await app.goto(`/visits/${backdated.id}/edit`);
    assert.equal(await app.eval(`document.querySelector('input[type=checkbox]').checked`), false);
    await app.clickSelector('input[type=checkbox]');
    await app.click('Save');
    await app.waitFor(`location.hash === '#/visits/${backdated.id}'`);
    visits = await app.store('visits');
    assert.equal(visits.find((visit) => visit.id === backdated.id).endedAt, null);
    assert.match(visits.find((visit) => visit.id === opened.id).endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(visits.filter((visit) => !visit.endedAt).length, 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('visit form saves a backdated visit as ended when the open checkbox is unticked', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await app.clickSelector('input[type=checkbox]');
    await app.setInput('input[type=date]', '2026-08-03');
    await app.click('Save');
    await app.waitFor(`location.hash.startsWith('#/visits/') && !location.hash.endsWith('/new')`);

    const [visit] = await app.store('visits');
    assert.equal(visit.date, '2026-08-03');
    assert.match(visit.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('visits list and detail show OPEN only for the open visit', async () => {
  await withApp(async (app) => {
    const ended = await seedEndedVisit(app, { date: '2026-08-01' });
    const open = await startVisit(app, { date: await today(app) });
    await app.goto('/visits');
    assert.equal(await app.count('.badge'), 1);
    assert.match(await app.text(), /OPEN/);

    await app.goto(`/visits/${ended.id}`);
    assert.doesNotMatch(await app.text('#view header'), /OPEN/);
    await app.goto(`/visits/${open.id}`);
    assert.match(await app.text('#view header'), /OPEN/);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('quick-add photo cancel cleans the reserved bowl and saving keeps one bowl with one photo', async () => {
  const png = fixturePng('ppt-lifecycle-quick-add.png');
  try {
    await withApp(async (app) => {
      await startVisit(app, { date: await today(app) });
      await openQuickSheet(app);
      await app.upload('#modal-host input[type=file]', png.path);
      await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length === 1`);
      assert.equal((await app.store('bowls')).length, 1);
      await clickModalButton(app, 'Cancel');
      await app.waitFor(`document.getElementById('modal-host').hidden && (await (await import('${app.origin}/js/db.js')).getAll('bowls')).length === 0`);
      assert.equal((await app.store('photos')).length, 0);

      await openQuickSheet(app);
      await app.upload('#modal-host input[type=file]', png.path);
      await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length === 1`);
      await saveQuickSheet(app);

      const bowls = await app.store('bowls');
      const photos = await app.store('photos');
      assert.equal(bowls.length, 1);
      assert.equal(photos.length, 1);
      assert.equal(photos[0].ownerType, 'bowl');
      assert.equal(photos[0].ownerId, bowls[0].id);
      app.assertNoErrors();
    }, { seed: FIXTURE });
  } finally {
    png.cleanup();
  }
});
