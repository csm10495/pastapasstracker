import test from 'node:test';
import assert from 'node:assert/strict';

import { fixturePng, withApp } from '../helpers/app.mjs';

const BASE_VISIT = {
  people: [{ name: 'Alice', hasPass: true }, { name: 'Bob', hasPass: false }],
  locations: [{ name: 'OG Brookfield', city: 'Brookfield', state: 'WI', defaultMealPrice: 15.99, defaultToppingPrice: 4.99 }],
};

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

async function submitModal(app) {
  await app.clickSelector('#modal-host button[type=submit]');
  await app.waitFor('document.getElementById("modal-host").hidden');
}

test('creating a diner through the modal persists the entered name and pass details', async () => {
  await withApp(async (app) => {
    await app.goto('/people');
    await app.click('Add diner');
    assert.doesNotMatch(await app.text('#modal-host'), /Pass cost/);

    await app.clickSelector('#modal-host input[type=checkbox]', 0);
    assert.match(await app.text('#modal-host'), /Pass cost/);
    await app.setInput('#modal-host input[type=text]', 'Carla');
    await app.setInput('#modal-host input[type=number]', '125.50');
    await app.setInput('#modal-host input[type=date]', '2026-08-24');
    await submitModal(app);

    let people = await app.store('people');
    assert.equal(people.length, 1);
    assert.equal(people[0].name, 'Carla');
    assert.equal(people[0].hasPass, true);
    assert.equal(people[0].passCost, 125.50);
    assert.match(await app.text(), /Carla/);

    await app.click('Carla');
    await app.clickSelector('#modal-host input[type=checkbox]', 0);
    assert.doesNotMatch(await app.text('#modal-host'), /Pass cost/);
    await submitModal(app);

    people = await app.store('people');
    assert.equal(people[0].hasPass, false);
    app.assertNoErrors();
  });
});

test('uploading an avatar stores a person photo and renders the avatar image', async () => {
  const png = fixturePng('person-avatar.png');
  try {
    await withApp(async (app) => {
      await app.goto('/people');
      await app.click('Add diner');
      await app.setInput('#modal-host input[type=text]', 'Photo Fan');
      await app.upload('#modal-host input[type=file]', png.path);
      await submitModal(app);

      const people = await app.store('people');
      const photos = await app.store('photos');
      assert.equal(photos.length, 1);
      assert.equal(photos[0].ownerType, 'person');
      assert.equal(photos[0].ownerId, people[0].id);
      assert.equal(await app.exists('#view .list__item img'), true);
      app.assertNoErrors();
    });
  } finally {
    png.cleanup();
  }
});

test('editing a diner renames them and flips pass status', async () => {
  await withApp(async (app) => {
    await app.goto('/people');
    await app.click('Alice');
    await app.setInput('#modal-host input[type=text]', 'Alice Updated');
    await app.clickSelector('#modal-host input[type=checkbox]', 0);
    await submitModal(app);

    const alice = (await app.store('people')).find((p) => p.name === 'Alice Updated');
    assert.ok(alice);
    assert.equal(alice.hasPass, false);
    assert.match(await app.text(), /Alice Updated/);
    app.assertNoErrors();
  }, { seed: BASE_VISIT });
});

test('break-even progress reports broken even and remaining amounts from computed stats', async () => {
  const fixture = {
    people: [
      { name: 'Even', hasPass: true, passCost: 100 },
      { name: 'Short', hasPass: true, passCost: 100 },
    ],
    visits: [
      { date: '2026-09-01', mealPrice: 60, toppingPrice: 0, bowls: [{ person: 'Even', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] },
      { date: '2026-09-02', mealPrice: 45, toppingPrice: 0, bowls: [{ person: 'Even', pasta: 'Spaghetti', sauce: 'Alfredo', topping: null }] },
      { date: '2026-09-03', mealPrice: 40, toppingPrice: 0, bowls: [{ person: 'Short', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: null }] },
    ],
  };

  await withApp(async (app) => {
    const expected = await app.run(`
      const [people, visits, bowls, settings] = await Promise.all([
        db.getAll('people'), db.getAll('visits'), db.getAll('bowls'), db.getSettings(),
      ]);
      return stats.computeStats({ people, visits, bowls, settings }).perPerson
        .map((row) => ({ name: row.person.name, remaining: row.remainingToBreakEven }));
    `);
    const short = expected.find((row) => row.name === 'Short');

    await app.goto('/people');
    const text = await app.text();
    assert.match(text, /Broken even!/);
    assert.match(text, new RegExp(`${money(short.remaining).replace('$', '\\$')} to break even`));
    app.assertNoErrors();
  }, { seed: fixture });
});

test('deleting a diner rerenders the screen and cascades only their bowls', async () => {
  const fixture = {
    people: [{ name: 'Alice', hasPass: true }, { name: 'Bob', hasPass: false }],
    visits: [{
      date: '2026-09-01',
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null },
        { person: 'Alice', pasta: 'Spaghetti', sauce: 'Meat Sauce', topping: null },
        { person: 'Bob', pasta: 'Rigatoni', sauce: 'Alfredo', topping: 'Meatballs' },
      ],
    }],
  };

  await withApp(async (app) => {
    const bobId = (await app.store('people')).find((p) => p.name === 'Bob').id;
    await app.goto('/people');
    await app.click('Alice');
    await app.clickSelector('#modal-host .btn--danger');
    await app.click('Delete diner');
    await app.waitFor('document.getElementById("view").innerText.includes("Bob") && !document.getElementById("view").innerText.includes("Alice")');

    const people = await app.store('people');
    const bowls = await app.store('bowls');
    assert.deepEqual(people.map((p) => p.name), ['Bob']);
    assert.equal(bowls.length, 1);
    assert.equal(bowls[0].personId, bobId);
    app.assertNoErrors();
  }, { seed: fixture });
});

test('inactive diners are marked inactive and omitted from new visit person select', async () => {
  await withApp(async (app) => {
    await app.goto('/people');
    const peopleText = await app.text();
    assert.match(peopleText, /Retired Diner/);
    assert.match(peopleText, /Inactive/);

    await app.goto('/visits/new');
    await app.click('Add bowl');
    const options = await app.optionTexts('#view select', 1);
    assert.ok(options.includes('Active Diner'));
    assert.ok(!options.includes('Retired Diner'));
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Active Diner' }, { name: 'Retired Diner', active: false }] } });
});

test('diners empty state appears when there are no people', async () => {
  await withApp(async (app) => {
    await app.resetData();
    await app.goto('/people');
    assert.match(await app.text(), /No diners yet/i);
    app.assertNoErrors();
  });
});

test('creating a location stores city, state, and default prices', async () => {
  await withApp(async (app) => {
    await app.goto('/locations');
    await app.click('Add location');
    await app.setInput('#modal-host input[type=text]', 'OG Madison', 0);
    await app.setInput('#modal-host input[type=text]', 'Madison', 1);
    await app.setInput('#modal-host input[type=text]', 'WI', 2);
    await app.setInput('#modal-host input[type=number]', '16.49', 0);
    await app.setInput('#modal-host input[type=number]', '5.49', 1);
    await submitModal(app);

    const location = (await app.store('locations'))[0];
    assert.equal(location.name, 'OG Madison');
    assert.equal(location.city, 'Madison');
    assert.equal(location.state, 'WI');
    assert.equal(location.defaultMealPrice, 16.49);
    assert.equal(location.defaultToppingPrice, 5.49);
    assert.match(await app.text(), /Madison, WI/);
    app.assertNoErrors();
  });
});

test('blank location prices store null and new visits fall back to global meal price', async () => {
  await withApp(async (app) => {
    await app.goto('/locations');
    await app.click('Add location');
    await app.setInput('#modal-host input[type=text]', 'OG Blank', 0);
    await app.setInput('#modal-host input[type=text]', 'Blankville', 1);
    await submitModal(app);

    const location = (await app.store('locations'))[0];
    assert.equal(location.defaultMealPrice, null);
    assert.equal(location.defaultToppingPrice, null);

    await app.goto('/visits/new');
    await app.setSelectByText('#view select', 'OG Blank', 0);
    const prices = await app.eval(`([...document.querySelectorAll('#view input[type=number]')].map((n) => n.value))`);
    const settings = await app.settings();
    assert.equal(Number(prices[0]), settings.mealPrice);
    app.assertNoErrors();
  }, { seed: { people: [{ name: 'Alice' }] } });
});

test('editing a location default price does not rewrite frozen visit prices', async () => {
  await withApp(async (app) => {
    const before = (await app.store('visits'))[0].mealPrice;
    await app.goto('/locations');
    await app.click('OG Brookfield');
    await app.setInput('#modal-host input[type=number]', '25.00', 0);
    await submitModal(app);

    const after = (await app.store('visits'))[0].mealPrice;
    const location = (await app.store('locations'))[0];
    assert.equal(before, 15.99);
    assert.equal(after, 15.99);
    assert.equal(location.defaultMealPrice, 25);
    app.assertNoErrors();
  }, {
    seed: {
      ...BASE_VISIT,
      visits: [{ date: '2026-09-01', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('location visit counts and no-location grammar are correct', async () => {
  await withApp(async (app) => {
    await app.goto('/locations');
    let text = await app.text();
    assert.match(text, /OG Brookfield .*2 visits/);
    assert.match(text, /1 visit has no location assigned\./);

    await app.seed({
      ...BASE_VISIT,
      visits: [
        { date: '2026-09-01', location: null, bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] },
        { date: '2026-09-02', location: null, bowls: [{ person: 'Bob', pasta: 'Spaghetti', sauce: 'Alfredo', topping: null }] },
      ],
    });
    await app.goto('/locations');
    text = await app.text();
    assert.match(text, /2 visits have no location assigned\./);
    app.assertNoErrors();
  }, {
    seed: {
      ...BASE_VISIT,
      visits: [
        { date: '2026-09-01', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] },
        { date: '2026-09-02', location: 'OG Brookfield', bowls: [{ person: 'Bob', pasta: 'Spaghetti', sauce: 'Alfredo', topping: null }] },
        { date: '2026-09-03', location: null, bowls: [{ person: 'Alice', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: null }] },
      ],
    },
  });
});

test('the no-location line is hidden when every visit has a location', async () => {
  await withApp(async (app) => {
    await app.goto('/locations');
    assert.doesNotMatch(await app.text(), /no location assigned/i);
    app.assertNoErrors();
  }, {
    seed: {
      ...BASE_VISIT,
      visits: [{ date: '2026-09-01', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('deleting a location rerenders the screen and detaches its visits', async () => {
  await withApp(async (app) => {
    await app.goto('/locations');
    await app.click('OG Brookfield');
    await app.clickSelector('#modal-host .btn--danger');
    await app.click('Delete location');
    await app.waitFor('document.getElementById("view").innerText.includes("No locations yet")');

    const visits = await app.store('visits');
    assert.equal(visits.length, 1);
    assert.equal(visits[0].locationId, null);
    app.assertNoErrors();
  }, {
    seed: {
      ...BASE_VISIT,
      visits: [{ date: '2026-09-01', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null }] }],
    },
  });
});

test('locations empty state appears when there are no locations', async () => {
  await withApp(async (app) => {
    await app.resetData();
    await app.goto('/locations');
    assert.match(await app.text(), /No locations yet/i);
    app.assertNoErrors();
  });
});
