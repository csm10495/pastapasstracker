/**
 * Functional tests for routing, rendering, and the PWA shell.
 *
 * These guard the promise that every screen loads without console errors and
 * that the app still works with the network cut.
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
  ],
  visits: [
    {
      date: '2026-08-24',
      location: 'OG Brookfield',
      notes: 'First trip of the season.',
      bowls: [
        { person: 'Alice', pasta: 'Fettuccine', sauce: 'Spicy Alfredo', topping: null, rating: 5 },
        { person: 'Bob', pasta: 'Spaghetti', sauce: 'Alfredo', topping: 'Meatballs', rating: 4 },
      ],
    },
    {
      date: '2026-09-02',
      location: null,
      bowls: [
        { person: 'Alice', pasta: 'Rigatoni', sauce: 'Meat Sauce', topping: 'Crispy Shrimp Fritta' },
      ],
    },
  ],
};

const ROUTES = [
  ['/', 'dashboard'],
  ['/visits', 'visit list'],
  ['/visits/new', 'new visit form'],
  ['/people', 'diners'],
  ['/locations', 'locations'],
  ['/combos', 'combo explorer'],
  ['/stats', 'stats'],
  ['/settings', 'settings'],
];

test('every route renders content without console errors', async () => {
  await withApp(async (app) => {
    for (const [route, label] of ROUTES) {
      app.clearErrors();
      await app.goto(route);
      const text = await app.text();
      assert.ok(text.length > 20, `${label} (${route}) rendered only ${text.length} chars`);
      app.assertNoErrors(`${label} (${route})`);
    }
  }, { seed: FIXTURE });
});

test('visit detail and edit routes render for a real visit', async () => {
  await withApp(async (app) => {
    const visits = await app.store('visits');
    const id = visits[0].id;

    app.clearErrors();
    await app.goto(`/visits/${id}`);
    const detail = await app.text();
    assert.match(detail, /Aug 24, 2026|2026/);
    app.assertNoErrors('visit detail');

    app.clearErrors();
    await app.goto(`/visits/${id}/edit`);
    assert.match(await app.text(), /Edit visit/i);
    app.assertNoErrors('visit edit');
  }, { seed: FIXTURE });
});

test('an unknown route shows a not-found message rather than a blank page', async () => {
  await withApp(async (app) => {
    await app.goto('/definitely-not-a-route');
    assert.match(await app.text(), /does not exist/i);
  }, { seed: FIXTURE });
});

test('a missing visit id is handled gracefully', async () => {
  await withApp(async (app) => {
    app.clearErrors();
    await app.goto('/visits/no-such-id');
    assert.match(await app.text(), /not found/i);
    app.assertNoErrors('missing visit');
  }, { seed: FIXTURE });
});

test('the dashboard shows the empty state with no data', async () => {
  await withApp(async (app) => {
    await app.resetData();
    await app.reload();
    assert.match(await app.text(), /Welcome to Pasta Pass Tracker/i);
  });
});

test('navigation marks the active tab', async () => {
  await withApp(async (app) => {
    await app.goto('/stats');
    const current = await app.eval(
      `document.querySelector('[data-nav][aria-current="page"]')?.getAttribute('data-nav')`,
    );
    assert.equal(current, '/stats');
  }, { seed: FIXTURE });
});

/* ------------------------------------------------------------- PWA ------ */

test('the manifest is relative so it works from a repo subpath', async () => {
  await withApp(async (app) => {
    const manifest = await app.eval(
      `(async () => (await (await fetch('./manifest.webmanifest')).json()))()`,
    );
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok(manifest.icons.length >= 2);
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'),
      'a maskable icon is required for a good Android install');
  });
});

test('the service worker installs and caches the app shell', async () => {
  await withApp(async (app) => {
    const state = await app.waitFor(
      `(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg && reg.active ? { active: true } : false;
      })()`,
      { timeout: 15000, label: 'service worker activation' },
    );
    assert.equal(state.active, true);

    const cache = await app.eval(`(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return { keys, entries: (await c.keys()).length };
    })()`);
    assert.ok(cache.entries > 10, `only ${cache.entries} shell entries cached`);
  });
});

test('the app still loads and navigates with the network offline', async () => {
  await withApp(async (app) => {
    await app.waitFor(
      `(async () => !!(await navigator.serviceWorker.getRegistration())?.active)()`,
      { timeout: 15000, label: 'service worker activation' },
    );
    // Reload once so the worker is controlling the page.
    await app.reload();

    await app.setOffline(true);
    try {
      await app.reload();
      const home = await app.text();
      assert.ok(home.length > 20, 'dashboard did not render offline');

      // A lazily imported route must also come from cache.
      await app.goto('/stats');
      assert.ok((await app.text()).length > 20, '/stats did not render offline');
    } finally {
      await app.setOffline(false);
    }
  }, { seed: FIXTURE });
});
