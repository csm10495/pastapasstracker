/**
 * High-level helper for functional tests.
 *
 * Wraps the CDP client in an API that reads like user actions, so tests
 * describe behaviour rather than protocol plumbing.
 *
 *   await withApp(async (app) => {
 *     await app.seed({ people: [{ name: 'Alice', hasPass: true }] });
 *     await app.goto('/visits/new');
 *     await app.click('Add bowl');
 *     app.assertNoErrors();
 *   });
 */

import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.mjs';
import { launchBrowser, Cdp, sleep } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..');

/** A tiny valid PNG, for exercising real file inputs. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAP0lEQVR42u3OMQEAAAgDoC1p'
  + 'b3vAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvA0K2AABtLuA'
  + 'CQAAAABJRU5ErkJggg==';

export function fixturePng(name = 'ppt-fixture.png') {
  const path = join(tmpdir(), name);
  writeFileSync(path, Buffer.from(PNG_BASE64, 'base64'));
  return {
    path,
    cleanup: () => { try { rmSync(path, { force: true }); } catch { /* ignore */ } },
  };
}

class App {
  constructor(cdp, origin) {
    this.cdp = cdp;
    this.origin = origin;
  }

  get errors() { return this.cdp.errors; }

  clearErrors() { this.cdp.errors.length = 0; }

  assertNoErrors(context = '') {
    if (this.cdp.errors.length) {
      const detail = this.cdp.errors.join('\n  ');
      throw new Error(`Console errors${context ? ' during ' + context : ''}:\n  ${detail}`);
    }
  }

  eval(expression) { return this.cdp.eval(expression); }

  /**
   * Runs an async body in the page with the app's modules pre-imported as
   * `db`, `menu`, `photos`, `transfer`, `theme`, `stats`.
   *
   * The body runs inside its own block so it can freely declare locals named
   * after those modules without colliding with them.
   */
  run(body) {
    return this.cdp.eval(`(async () => {
      const db = await import('${this.origin}/js/db.js');
      const menu = await import('${this.origin}/js/menu.js');
      const photos = await import('${this.origin}/js/photos.js');
      const transfer = await import('${this.origin}/js/transfer.js');
      const theme = await import('${this.origin}/js/theme.js');
      const stats = await import('${this.origin}/js/stats.js');
      void menu; void photos; void transfer; void theme; void stats;
      {
        ${body}
      }
    })()`);
  }

  /** Rows of one IndexedDB store. */
  store(name) { return this.run(`return db.getAll(${JSON.stringify(name)});`); }

  settings() { return this.run('return db.getSettings();'); }

  /** Polls a page expression until it returns truthy. */
  async waitFor(expression, { timeout = 8000, interval = 100, label = '' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await this.cdp.eval(`(async () => { try { return (${expression}); } catch { return false; } })()`);
      if (last) return last;
      await sleep(interval);
    }
    throw new Error(`waitFor timed out${label ? ` (${label})` : ''}: ${expression}`);
  }

  /** Waits until the router has finished painting a view. */
  async waitForView() {
    await this.waitFor(
      `(() => { const v = document.getElementById('view');
                return !!v && !v.querySelector('.loading') && v.textContent.trim().length > 0; })()`,
      { label: 'view render' },
    );
    // Views render some sections asynchronously (avatars, photos).
    await sleep(250);
  }

  async goto(route) {
    const hash = '#' + (route.startsWith('/') ? route : '/' + route);
    await this.cdp.eval(`(() => {
      if (location.hash === ${JSON.stringify(hash)}) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        location.hash = ${JSON.stringify(hash)};
      }
    })()`);
    await this.waitForView();
  }

  async reload() {
    await this.cdp.send('Page.reload');
    await sleep(600);
    await this.waitForView();
  }

  async navigate(url = `${this.origin}/index.html`) {
    await this.cdp.send('Page.navigate', { url });
    await sleep(800);
    await this.waitForView();
  }

  text(selector = '#view') {
    return this.cdp.eval(
      `(() => { const n = document.querySelector(${JSON.stringify(selector)});
                return n ? n.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`,
    );
  }

  count(selector) {
    return this.cdp.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  exists(selector) {
    return this.cdp.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  /** Clicks the first element whose text contains `text`. */
  async click(text, selector = 'button, a.btn, .chip, a') {
    const ok = await this.cdp.eval(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const target = nodes.find((n) =>
        n.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!ok) throw new Error(`No clickable element matching text: ${text}`);
    await sleep(350);
    return true;
  }

  async clickSelector(selector, index = 0) {
    const ok = await this.cdp.eval(`(() => {
      const nodes = document.querySelectorAll(${JSON.stringify(selector)});
      const target = nodes[${index}];
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!ok) throw new Error(`No element at ${selector}[${index}]`);
    await sleep(350);
    return true;
  }

  async setInput(selector, value, index = 0) {
    const ok = await this.cdp.eval(`(() => {
      const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!node) return false;
      node.value = ${JSON.stringify(String(value))};
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`No input at ${selector}[${index}]`);
    await sleep(200);
  }

  async setSelectIndex(selector, optionIndex, index = 0) {
    const ok = await this.cdp.eval(`(() => {
      const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!node) return false;
      node.selectedIndex = ${optionIndex};
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`No select at ${selector}[${index}]`);
    await sleep(200);
  }

  async setSelectByText(selector, optionText, index = 0) {
    const ok = await this.cdp.eval(`(() => {
      const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!node) return false;
      const opt = [...node.options].find((o) => o.text.includes(${JSON.stringify(optionText)}));
      if (!opt) return false;
      node.value = opt.value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`No option "${optionText}" in ${selector}[${index}]`);
    await sleep(200);
  }

  optionTexts(selector, index = 0) {
    return this.cdp.eval(`(() => {
      const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      return node ? [...node.options].map((o) => o.text) : [];
    })()`);
  }

  /** Uploads a real file through a real <input type=file>. */
  async upload(selector, filePath, index = 0) {
    const doc = await this.cdp.send('DOM.getDocument');
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', {
      nodeId: doc.root.nodeId, selector,
    });
    const nodeId = nodeIds?.[index];
    if (!nodeId) throw new Error(`No file input at ${selector}[${index}]`);
    await this.cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
    await sleep(1400);
  }

  /** Text of any toast currently on screen. */
  toastText() {
    return this.cdp.eval(
      `[...document.querySelectorAll('#toast-host .toast')].map((n) => n.textContent).join(' | ')`,
    );
  }

  modalOpen() {
    return this.cdp.eval(`!document.getElementById('modal-host').hidden`);
  }

  async setOffline(offline) {
    await this.cdp.send('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await sleep(200);
  }

  async screenshot(path) {
    const { data } = await this.cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
    });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  /** Empties every store except the seeded menu. */
  resetData() {
    return this.run(`
      for (const s of ['people', 'locations', 'visits', 'bowls', 'photos']) {
        await db.clearStore(s);
      }
      return true;
    `);
  }

  /**
   * Seeds data from a declarative fixture, resolving names to ids so tests
   * stay readable.
   *
   * {
   *   people:    [{ name, hasPass, passCost, color, active }],
   *   locations: [{ name, city, state, defaultMealPrice, defaultToppingPrice }],
   *   visits:    [{ date, location: 'name'|null, mealPrice, toppingPrice, notes,
   *                 bowls: [{ person, pasta, sauce, topping|null, rating }] }],
   *   settings:  { mealPrice: 14.99, ... }
   * }
   */
  async seed(fixture = {}) {
    return this.run(`
      const fx = ${JSON.stringify(fixture)};
      await db.ensureSeeded();
      for (const s of ['people', 'locations', 'visits', 'bowls', 'photos']) {
        await db.clearStore(s);
      }

      const peopleByName = new Map();
      for (const p of fx.people || []) {
        const rec = await db.save('people', {
          name: p.name,
          color: p.color || '#9a2820',
          hasPass: !!p.hasPass,
          passCost: p.hasPass ? (p.passCost ?? 100) : null,
          passPurchasedOn: p.passPurchasedOn || null,
          active: p.active !== false,
        });
        peopleByName.set(p.name, rec.id);
      }

      const locationsByName = new Map();
      for (const l of fx.locations || []) {
        const rec = await db.save('locations', {
          name: l.name,
          city: l.city || '',
          state: l.state || '',
          notes: l.notes || '',
          defaultMealPrice: l.defaultMealPrice ?? null,
          defaultToppingPrice: l.defaultToppingPrice ?? null,
        });
        locationsByName.set(l.name, rec.id);
      }

      const byName = (items) => new Map(items.map((i) => [i.name, i.id]));
      const pastas = byName(await menu.listMenu('pasta'));
      const sauces = byName(await menu.listMenu('sauce'));
      const toppings = byName(await menu.listMenu('topping'));
      const settings = await db.getSettings();

      const visitIds = [];
      for (const v of fx.visits || []) {
        const locId = v.location ? locationsByName.get(v.location) ?? null : null;
        const loc = locId ? await db.getById('locations', locId) : null;
        const rec = await db.save('visits', {
          date: v.date,
          locationId: locId,
          notes: v.notes || '',
          mealPrice: v.mealPrice ?? loc?.defaultMealPrice ?? settings.mealPrice,
          toppingPrice: v.toppingPrice ?? loc?.defaultToppingPrice ?? settings.toppingPrice,
        });
        visitIds.push(rec.id);
        let seq = 0;
        for (const b of v.bowls || []) {
          await db.save('bowls', {
            visitId: rec.id,
            personId: peopleByName.get(b.person),
            pastaId: pastas.get(b.pasta),
            sauceId: sauces.get(b.sauce),
            toppingId: b.topping ? toppings.get(b.topping) : null,
            rating: b.rating ?? null,
            notes: b.notes || '',
            seq: seq++,
          });
        }
      }

      for (const [k, val] of Object.entries(fx.settings || {})) {
        await db.setSetting(k, val);
      }

      return {
        people: [...peopleByName.entries()],
        locations: [...locationsByName.entries()],
        visits: visitIds,
      };
    `);
  }
}

/**
 * Boots a server + headless browser, hands an App to `fn`, and always tears
 * everything down. Reuses PPT_ORIGIN when the runner already started a server.
 */
export async function withApp(fn, { seed = null } = {}) {
  const existingOrigin = process.env.PPT_ORIGIN;
  const server = existingOrigin
    ? null
    : await startServer({ root: PROJECT_ROOT });
  const origin = existingOrigin || server.origin;

  const browser = await launchBrowser();
  let cdp;
  try {
    const page = browser.targets.find((t) => t.type === 'page') || browser.targets[0];
    cdp = await Cdp.attach(page.webSocketDebuggerUrl);

    const app = new App(cdp, origin);
    await cdp.send('Page.navigate', { url: `${origin}/index.html` });
    await app.waitForView();

    if (seed) {
      await app.seed(seed);
      await app.reload();
    }
    app.clearErrors();

    return await fn(app);
  } finally {
    cdp?.close();
    await browser.close();
    await server?.close();
  }
}
