# AGENTS.md — instructions for AI agents working on this repo

**You are an AI agent making changes to Pasta Pass Tracker. Read this file in full before you
write any code, and follow it.** Human contributors are welcome to read it too, but it is written
for you.

If anything here conflicts with a habit you would otherwise apply — reaching for a framework,
adding a dependency, introducing a build step — this file wins.

---

## 🔴 The golden rule

> **Every change updates the tests. Every bug fix adds a regression test. Every behaviour change
> updates the README — including the screenshots.**

Concretely, a change is not finished until all four of these are true:

1. **Tests updated.** New behaviour gets new tests. Changed behaviour gets its tests changed.
   A bug fix without a test that fails before the fix and passes after it is not a fix — it is a
   change that will silently regress.
2. **README updated.** If you altered anything a user can see, do, or configure — a feature, a
   flow, a default, a setting, the menu, the deploy story — update `README.md` in the same
   change. Documentation drift is a defect.
3. **Screenshots regenerated.** If you changed anything visible, re-run
   `node docs/make-screenshots.mjs` and commit the updated PNGs in `docs/screenshots/`. Stale
   screenshots are documentation drift too. Never hand-crop or hand-edit them, and never
   screenshot a different viewport — the script pins Pixel 10 dimensions so the set stays
   consistent. If you add a screen worth showing, add it to the `SHOTS` list in that script and
   reference it from the README.
4. **The suite passes.** `npm test` is green, including the functional tests. The full run takes
   roughly five minutes because each functional test drives its own browser — that is expected,
   not a hang. Use `npm run test:unit` for a fast inner loop.

If you fix a bug, say so in the test name. `test('deleting a visit also removes its photos')`
is worth more than `test('delete works')`.

---

## What this project is

An offline-first PWA for tracking Olive Garden visits and Never-Ending Pasta Pass usage.

**Constraints that are deliberate, not accidental — do not "improve" them away:**

- **No runtime dependencies.** No npm packages ship to the browser. No frameworks, no CDN, no
  charting library. `package.json` exists only for the dev/test workflow and declares zero
  dependencies.
- **No build step.** Plain HTML, CSS and ES modules, served as-is. If you find yourself wanting
  a bundler, transpiler, or JSX, the answer is no.
- **Relative paths everywhere.** The app must work from a GitHub Pages subpath
  (`/<repo>/`), so never write an absolute path like `/js/app.js`. This includes `src`/`href`
  attributes, `import` specifiers, `fetch()` calls, the manifest's `start_url`/`scope`, and the
  service worker registration. `tests/functional/subpath.test.mjs` fails the build if you slip.
- **Local-only data.** No accounts, no server, no sync. IndexedDB plus JSON export/import.

## Running things

```bash
npm test              # unit + functional (starts its own server and browser)
npm run test:unit     # fast: pure logic only, no browser
npm run test:functional
npm run serve         # http://localhost:8000
```

Functional tests drive real headless Chrome over the DevTools Protocol. Node 22 ships a global
`WebSocket`, so this needs **no Playwright or Puppeteer install**. Set `PPT_CHROME` if your
browser is somewhere unusual.

---

## Architecture

```
index.html          app shell + the pre-paint theme bootstrap
sw.js               service worker (cache-first shell)
css/themes.css      palettes as CSS custom property sets
css/styles.css      base design system
js/schema.js        store definitions, seed menu, default settings
js/db.js            IndexedDB access layer — the ONLY place that touches IndexedDB
js/menu.js          menu items, soft deletes, combo keys
js/photos.js        generic (ownerType, ownerId) photo attachments
js/stats.js         all cost/savings/pace maths — pure functions, no DOM, no I/O
js/charts.js        inline SVG charts
js/theme.js         palettes, system-scheme watcher, custom colours
js/transfer.js      JSON backup and restore
js/ui.js            DOM helpers, modals, toasts, formatting
js/app.js           hash router
js/views/*.js       one module per screen
tests/              see below
```

### Layering rules

- **Views never touch IndexedDB directly.** Go through `js/db.js`.
- **Views never recompute cost maths.** Call `computeStats()` from `js/stats.js`. If a number is
  wrong, fix it in `stats.js` once, where it is unit-tested, not in a view.
- **`js/stats.js` stays pure.** No DOM, no storage, no `Date.now()` sneaking in — pass dates in.
  This is why it is cheap to test exhaustively.
- Every view exports `async function render(container, params)` and may return a cleanup
  function, which the router calls on navigate-away.

---

## Domain model — get this right

```
Person   { id, name, color, hasPass, passCost, passPurchasedOn, active }
Location { id, name, city, state, notes, defaultMealPrice|null, defaultToppingPrice|null }
Visit    { id, date, locationId|null, notes, mealPrice, toppingPrice, endedAt|null }
Bowl     { id, visitId, personId, pastaId, sauceId, toppingId|null, rating, notes, seq }
MenuItem { id, kind, name, isNew, sortOrder, deletedAt|null }
Photo    { id, ownerType, ownerId, blob, thumbBlob, width, height, caption, seq }
Setting  { key, value }
```

Six invariants that are easy to break and expensive to get wrong:

1. **A visit contains many bowls; each bowl belongs to one person.** This is what makes refills
   countable and lets one group mix pass holders and payers.
2. **`Visit.date` is a local `YYYY-MM-DD` string**, never a UTC timestamp. A 9pm dinner must not
   file itself on tomorrow's date. Use `todayISO()` / `fromISODate()` from `js/ui.js`.
3. **Location is optional.** A visit needs only a date. Anything grouping by location must show
   a "No location" bucket rather than dropping rows, and deleting a location *detaches* its
   visits rather than deleting them.
4. **Prices are frozen onto the visit at save time**, resolved as
   `visit ← location.defaultMealPrice ← settings.mealPrice`. Editing a location default later
   must never rewrite history. A blank location price is `null`, never `0` — a `0` would
   incorrectly win the `??` fallback.
5. **`toppingId === null` means "no topping"** and is a real combo choice. It is the "+1" that
   makes 4 pastas × 6 sauces × (4 toppings + 1) = **120**, the figure Olive Garden advertises.
6. **`Visit.endedAt === null` means the visit is open** — you are still at the table ordering
   refills. **At most one visit may be open at a time**, so anything that opens a visit must end
   any other first (`endOtherOpenVisits`). Use the helpers in `js/db.js` — `isVisitOpen`,
   `getOpenVisit`, `startVisit`, `endVisit`, `reopenVisit` — rather than poking `endedAt`
   directly. Bumping the store version requires a migration: v2 stamps `endedAt` onto pre-existing
   visits so old history is not shown as still open.

### The cost model

The pasta bowl is unlimited refills for one price, so retail value accrues **per person per
visit**, not per bowl. Extra bowls are free refills — that is the entire source of savings.

- Pass holder: `spend = passCost` (once). Marginal cost per visit is zero.
- Payer: `spend = Σ (visit.mealPrice + topping surcharge)` over the visits they attended.
- `saved = retailValue − spend`
- `costPerBowl = spend ÷ bowls` — the headline metric.
- Break-even accumulates visit by visit across the *actual* prices paid, because prices differ
  between locations. Never assume a fixed price.

### Menu volatility

Olive Garden had not published the full 2026 lineup before the season opened, so the seeded
sauce list is partly inferred. Menu items are therefore **soft-deleted** (`deletedAt`) and
editable in Settings. Never hard-delete a menu item that any bowl references — historical bowls
must keep rendering.

---

## Code conventions

- Build DOM with `el()` from `js/ui.js`. **Never** interpolate user data into `innerHTML`.
- **Never hardcode a colour.** Everything resolves from CSS custom properties (`var(--accent)`,
  `var(--text)`, `var(--surface)`, `var(--good)`, `var(--bad)`…) so themes work. The only
  sanctioned exception is the palette swatch previews in Settings, which are already commented
  as such.
- Reuse the existing CSS classes before inventing new ones. If you must add CSS, add it to
  `css/styles.css` — component-scoped inline styles are fine for one-offs.
- Mobile-first. 44px minimum tap targets; this app is used standing at a restaurant table.
- Batch IndexedDB reads. No N+1 queries inside list rendering — load once, build a `Map`.
- **Comment only what needs clarifying.** Explain *why*, not *what*. No decorative banners, no
  restating the code in prose.
- Guard every division and nullable value. `money(null)` already renders `—`; use it.
- Cascade deletes belong in `js/db.js` (`deleteVisitDeep`, `deletePersonDeep`,
  `deleteLocationDetach`), not scattered across views.
- Call `invalidateMenuCache()` after **every** menu mutation — `js/menu.js` caches.
- **All photo inputs use `PHOTO_ACCEPT`** from `js/photos.js`, which is
  `accept="image/*;capture=camera"`. The `capture` must stay *inside* `accept`; setting it as a
  standalone attribute makes mobile jump straight to the camera and removes the option to pick an
  existing photo.
- Adding a file to `js/` means adding it to the `SHELL` list in `sw.js`, and bumping
  `CACHE_VERSION` when shell assets change — otherwise offline users get a half-updated app.

---

## Testing

```
tests/
  run.mjs                  starts a server, then Node's built-in test runner
  helpers/
    server.mjs             zero-dependency static file server
    cdp.mjs                Chrome DevTools Protocol client
    app.mjs                withApp() — the high-level test API
  unit/*.test.mjs          pure logic, no browser, milliseconds
  functional/*.test.mjs    real browser, real IndexedDB, real clicks
docs/
  make-screenshots.mjs     regenerates the README screenshots
  screenshots/*.png        committed, generated — do not edit by hand
```

**Unit tests** cover anything pure: `stats.js` above all, plus the formatting and date helpers
in `ui.js`, `comboKey`, `deriveCustom`, and backup validation. They import the real modules —
no mocks, no fakes.

**Functional tests** use `withApp`, which boots a server and headless Chrome, seeds IndexedDB
from a declarative fixture, and **fails the test on any console error**:

```js
await withApp(async (app) => {
  await app.goto('/visits/new');
  await app.click('Add bowl');
  await app.setInput('#view input[type=date]', '2026-09-01');
  await app.click('Save');
  const visits = await app.store('visits');
  assert.equal(visits.length, 1);
  app.assertNoErrors();
}, { seed: { people: [{ name: 'Alice', hasPass: true }] } });
```

Useful `app` methods: `goto` `reload` `text` `click` `clickSelector` `setInput` `setSelectIndex`
`setSelectByText` `optionTexts` `upload` `store` `settings` `run` `seed` `resetData` `waitFor`
`setOffline` `screenshot` `toastText` `modalOpen` `assertNoErrors`.

### What good coverage looks like here

Test the flow a user actually performs, not just the function underneath it. For each screen:
the happy path, the empty state, at least one destructive action with its confirmation, and the
edge case that the domain model makes likely — a visit with no location, a bowl with no topping,
a retired menu item still referenced by history, a person deleted while their bowls exist.

Prefer `app.waitFor(...)` over fixed sleeps.

---

## Definition of done

- [ ] `npm test` passes
- [ ] New/changed behaviour has tests; every bug fix has a regression test
- [ ] `README.md` updated if anything user-facing changed
- [ ] `node docs/make-screenshots.mjs` re-run and the PNGs committed if anything visible changed
- [ ] New `js/` files added to the `SHELL` list in `sw.js`
- [ ] No new runtime dependencies, no build step, no absolute paths
- [ ] No hardcoded colours; works in light *and* dark mode
- [ ] Works offline and on a narrow phone viewport
- [ ] Destructive actions are behind `confirmDialog()`
- [ ] No `console.log` left behind

## Common pitfalls

| Pitfall | Consequence |
|---|---|
| Storing a blank location price as `0` | `0 ?? fallback` returns `0`, so meals become free |
| Using `new Date(iso)` on a `YYYY-MM-DD` string | Parsed as UTC; dates shift a day |
| Forgetting `invalidateMenuCache()` | UI shows stale menu after an edit |
| Re-resolving prices at report time | Editing a location rewrites past savings |
| Hard-deleting a referenced menu item | Historical bowls render as "unknown" |
| `height="auto"` on an SVG | Invalid attribute; the element throws (this happened) |
| Attaching photos before save without cleanup | Orphaned blobs leak forever (this happened too) |
| A root-absolute path (`/js/app.js`) | Breaks GitHub Pages subpath hosting and installability |
| Opening a visit without ending the current one | Two "open" visits; the table card picks one arbitrarily |
| A standalone `capture` attribute on a file input | Forces the camera, removing "choose existing photo" |
| Adding a `js/` file but not to `sw.js` | Offline users get a broken, half-cached app |
