/**
 * Bottom tab bar clearance.
 *
 * The tab bar is `position: fixed`, so every scrollable screen has to reserve
 * space beneath its content. A fixed `height: 100%` on `body` kept that padding
 * inside the viewport box, and long screens scrolled their last rows under the
 * bar where they could not be read or tapped. Regression test for that.
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
    { name: 'OG Brookfield', city: 'Brookfield', state: 'WI', defaultMealPrice: 15.99 },
  ],
  visits: Array.from({ length: 12 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    location: i % 2 ? null : 'OG Brookfield',
    bowls: [{ person: i % 2 ? 'Bob' : 'Alice', pasta: 'Rigatoni', sauce: 'Alfredo', topping: null }],
  })),
};

const ROUTES = ['/', '/visits', '/people', '/locations', '/combos', '/stats', '/settings'];

/** Scrolls to the bottom and reports how far content sits under the tab bar. */
async function bottomOverlap(app) {
  return app.eval(`(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const view = document.getElementById('view');
    let lowest = -Infinity;
    for (const node of view.querySelectorAll('*')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      lowest = Math.max(lowest, box.bottom);
    }
    return { overlap: lowest - bar.top, scrollable: document.documentElement.scrollHeight > window.innerHeight };
  })()`);
}

test('no screen scrolls its last content under the bottom tab bar', async () => {
  await withApp(async (app) => {
    for (const route of ROUTES) {
      await app.goto(route);
      const { overlap } = await bottomOverlap(app);
      assert.ok(overlap <= 0,
        `${route} leaves ${overlap.toFixed(1)}px of content hidden behind the tab bar`);
    }
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('the page reserves clearance for the tab bar even when it scrolls', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    const { scrollable } = await bottomOverlap(app);
    assert.equal(scrollable, true, 'settings should be long enough to scroll on a phone');

    // The body must grow with its content; a viewport-height body swallows the
    // reserved padding and reintroduces the bug.
    const grows = await app.eval(
      'document.body.getBoundingClientRect().height > window.innerHeight',
    );
    assert.equal(grows, true);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});
