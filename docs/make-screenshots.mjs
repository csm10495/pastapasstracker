/**
 * Generates the README screenshots.
 *
 * Seeds a realistic mid-season dataset, then captures each key screen at phone
 * size across several themes. Re-run this whenever the UI changes:
 *
 *   node docs/make-screenshots.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { startServer } from '../tests/helpers/server.mjs';
import { launchBrowser, Cdp, sleep } from '../tests/helpers/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 'screenshots');

const PASTAS = ['Fettuccine', 'Spaghetti', 'Angel Hair', 'Rigatoni'];
const SAUCES = [
  'Spicy Alfredo', 'Alfredo', 'Meat Sauce',
  'Five Cheese Marinara', 'Traditional Marinara', 'Creamy Mushroom',
];
const TOPPINGS = [
  null, 'Crispy Chicken Fritta', 'Meatballs', 'Italian Sausage', 'Crispy Shrimp Fritta',
];

const DATES = [
  '2026-08-24', '2026-08-27', '2026-08-31', '2026-09-04', '2026-09-08',
  '2026-09-12', '2026-09-17', '2026-09-21', '2026-09-25', '2026-09-29',
];

/** A season already under way, so the numbers on screen look believable. */
function buildFixture() {
  const visits = DATES.map((date, i) => {
    const bowls = [];
    for (let b = 0; b < 2 + (i % 4); b++) {
      bowls.push({
        person: b % 2 === 0 ? 'Alice' : 'Bob',
        pasta: PASTAS[(i + b) % PASTAS.length],
        sauce: SAUCES[(i * 2 + b) % SAUCES.length],
        topping: TOPPINGS[(i + b) % TOPPINGS.length],
        rating: 3 + ((i + b) % 3),
      });
    }
    return {
      date,
      location: i % 3 === 2 ? 'Olive Garden - Madison' : 'Olive Garden - Brookfield',
      notes: i === 0 ? 'First trip of the season.' : '',
      bowls,
    };
  });

  return {
    people: [
      { name: 'Alice', hasPass: true, passCost: 100, passPurchasedOn: '2026-07-16', color: '#9a2820' },
      { name: 'Bob', hasPass: false, color: '#2f6b3a' },
    ],
    locations: [
      {
        name: 'Olive Garden - Brookfield',
        city: 'Brookfield',
        state: 'WI',
        defaultMealPrice: 15.99,
        defaultToppingPrice: 4.99,
      },
      { name: 'Olive Garden - Madison', city: 'Madison', state: 'WI', defaultMealPrice: 14.99 },
    ],
    settings: { seasonStart: '2026-08-24', seasonEnd: '2026-11-22' },
    visits,
  };
}

const SHOTS = [
  { name: 'dashboard', route: '/', palette: 'marinara', mode: 'light' },
  { name: 'add-bowl', route: '/', palette: 'marinara', mode: 'light', openSheet: true },
  { name: 'visits', route: '/visits', palette: 'marinara', mode: 'light' },
  { name: 'stats', route: '/stats', palette: 'marinara', mode: 'light' },
  { name: 'combos', route: '/combos', palette: 'basil', mode: 'light', scrollTo: 420 },
  { name: 'dashboard-dark', route: '/', palette: 'marinara', mode: 'dark' },
  { name: 'stats-dark', route: '/stats', palette: 'chianti', mode: 'dark' },
  { name: 'settings-dark', route: '/settings', palette: 'breadstick', mode: 'dark' },
];

const seedScript = (origin, fixture) => `(async () => {
  const db = await import('${origin}/js/db.js');
  const menu = await import('${origin}/js/menu.js');
  const fx = ${JSON.stringify(fixture)};

  await db.ensureSeeded();
  for (const s of ['people', 'locations', 'visits', 'bowls', 'photos']) await db.clearStore(s);

  const people = new Map();
  for (const p of fx.people) {
    const rec = await db.save('people', {
      name: p.name, color: p.color, hasPass: !!p.hasPass,
      passCost: p.hasPass ? p.passCost : null,
      passPurchasedOn: p.passPurchasedOn || null, active: true,
    });
    people.set(p.name, rec.id);
  }

  const locs = new Map();
  for (const l of fx.locations) {
    const rec = await db.save('locations', {
      name: l.name, city: l.city || '', state: l.state || '', notes: '',
      defaultMealPrice: l.defaultMealPrice ?? null,
      defaultToppingPrice: l.defaultToppingPrice ?? null,
    });
    locs.set(l.name, rec.id);
  }

  for (const [k, v] of Object.entries(fx.settings || {})) await db.setSetting(k, v);

  const index = (items) => new Map(items.map((i) => [i.name, i.id]));
  const pastas = index(await menu.listMenu('pasta'));
  const sauces = index(await menu.listMenu('sauce'));
  const tops = index(await menu.listMenu('topping'));
  const settings = await db.getSettings();

  for (const v of fx.visits) {
    const locId = v.location ? locs.get(v.location) : null;
    const loc = locId ? await db.getById('locations', locId) : null;
    const rec = await db.save('visits', {
      date: v.date, locationId: locId, notes: v.notes || '',
      mealPrice: loc?.defaultMealPrice ?? settings.mealPrice,
      toppingPrice: loc?.defaultToppingPrice ?? settings.toppingPrice,
      endedAt: new Date(v.date + 'T20:30:00').toISOString(),
    });
    let seq = 0;
    for (const b of v.bowls) {
      await db.save('bowls', {
        visitId: rec.id, personId: people.get(b.person),
        pastaId: pastas.get(b.pasta), sauceId: sauces.get(b.sauce),
        toppingId: b.topping ? tops.get(b.topping) : null,
        rating: b.rating ?? null, notes: '', seq: seq++,
      });
    }
  }

  // Leave one visit open so the "at the table" card is on show.
  const open = await db.startVisit({
    date: '2026-10-02', locationId: locs.get('Olive Garden - Brookfield'),
  });
  const pastaIds = [...pastas.values()];
  const sauceIds = [...sauces.values()];
  for (let i = 0; i < 3; i++) {
    await db.save('bowls', {
      visitId: open.id,
      personId: i % 2 === 0 ? people.get('Alice') : people.get('Bob'),
      pastaId: pastaIds[i % pastaIds.length],
      sauceId: sauceIds[i % sauceIds.length],
      toppingId: null, rating: null, notes: '', seq: i,
    });
  }
  return true;
})()`;

mkdirSync(OUT, { recursive: true });

const server = await startServer({ root: ROOT });
const browser = await launchBrowser();
let cdp;

try {
  const page = browser.targets.find((t) => t.type === 'page') || browser.targets[0];
  cdp = await Cdp.attach(page.webSocketDebuggerUrl);

  // Pixel 10: 1080 x 2424 physical, 20:9. Chrome reports ~412 x 924 CSS px at
  // a 2.625 device pixel ratio, which is what a real phone screenshot looks
  // like. Keep this in step with the aspect ratio quoted in the README.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 412, height: 924, deviceScaleFactor: 2.625, mobile: true,
  });
  await cdp.send('Page.navigate', { url: `${server.origin}/index.html` });
  await sleep(2500);

  await cdp.eval(seedScript(server.origin, buildFixture()));
  await cdp.send('Page.reload');
  await sleep(2000);

  for (const shot of SHOTS) {
    // A sheet left open by a previous shot would bleed into this one.
    await cdp.eval(`(() => {
      const host = document.getElementById('modal-host');
      if (host && !host.hidden) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      window.scrollTo(0, 0);
    })()`);
    await sleep(400);

    await cdp.eval(`(async () => {
      const t = await import('${server.origin}/js/theme.js');
      t.applyTheme({ mode: '${shot.mode}', palette: '${shot.palette}' });
      location.hash = '#${shot.route}';
    })()`);
    await sleep(1600);

    if (shot.openSheet) {
      await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.includes('Add bowl'));
        if (btn) btn.click();
      })()`);
      await sleep(1400);
    }

    if (shot.scrollTo) {
      await cdp.eval(`window.scrollTo(0, ${shot.scrollTo})`);
      await sleep(500);
    }

    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      // Viewport-sized, not full-page: the tab bar is fixed to the bottom of
      // the screen, so a full-page capture would strand it mid-document.
      captureBeyondViewport: false,
    });
    writeFileSync(join(OUT, `${shot.name}.png`), Buffer.from(data, 'base64'));
    console.log('captured', shot.name);
  }
  console.log('\nscreenshots written to', OUT);
} finally {
  cdp?.close();
  await browser.close();
  await server.close();
}
