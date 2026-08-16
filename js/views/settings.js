import {
  clearStore, ensureSeeded, estimateUsage, getAll, getSettings, setSetting,
} from '../db.js';
import {
  KINDS, KIND_LABEL, comboCount, destroyMenuItem, invalidateMenuCache,
  listMenu, listMenuAll, restoreMenuItem, retireMenuItem, saveMenuItem,
} from '../menu.js';
import { photoPicker } from '../photos.js';
import {
  card, confirmDialog, el, field, modal, toast,
} from '../ui.js';
import {
  DEFAULT_SETTINGS, SETTING_KEYS, STORE_NAMES,
} from '../schema.js';
import {
  applyTheme, deriveCustom, getPalettes, getTheme, resolveScheme,
} from '../theme.js';
import {
  downloadBackup, inspectBackup, readBackupFile, restoreBackup, wipeEverything,
} from '../transfer.js';
import {
  REPO_URL, canInstall, getBuildInfo, isInstalled, isIos, onInstallChange, promptInstall,
} from '../install.js';

// Settings re-renders itself in place after edits, so the install listener is
// tracked here and replaced rather than stacking up on every re-render.
let disposeInstallListener = null;

const COUNT_STORES = ['people', 'locations', 'visits', 'bowls', 'menuItems', 'photos'];

// Literal colours are used only as display-only previews of the documented palettes.
const SWATCHES = {
  marinara: '#9a2820',
  alfredo: '#8f6415',
  basil: '#2f6b3a',
  breadstick: '#96601a',
  chianti: '#6b2a5e',
  slate: '#3f5063',
};

export async function render(container, params) {
  void params;
  const [settings, bowls, usage, counts, activeMenus, combos] = await Promise.all([
    getSettings(),
    getAll('bowls'),
    estimateUsage(),
    loadCounts(),
    Promise.all(KINDS.map((kind) => listMenu(kind))),
    comboCount(),
  ]);
  const usedMenuIds = menuUsage(bowls);

  container.append(
    el('header', {},
      el('h1', {}, 'Settings'),
      el('p', { class: 'muted small' }, 'Customize appearance, defaults, the editable 2026 menu, and local backups.'),
    ),
    installCard(),
    appearanceCard(container),
    pricingCard(settings),
    seasonCard(settings),
    await menuEditorCard(container, usedMenuIds, activeMenus, combos),
    backupCard(),
    storageDangerCard(container, usage, counts),
    navigationCard(),
    await aboutCard(),
  );

  // The browser can offer installability at any moment; re-render the card
  // in place rather than making the user reload to see the button.
  disposeInstallListener?.();
  disposeInstallListener = onInstallChange(() => {
    const current = container.querySelector('[data-install-card]');
    if (current) current.replaceWith(installCard());
  });
  return () => {
    disposeInstallListener?.();
    disposeInstallListener = null;
  };
}

/**
 * Install-to-device card.
 *
 * Chromium fires `beforeinstallprompt`, which we replay from a real button.
 * iOS Safari never does, so it gets instructions instead of a dead control.
 */
function installCard() {
  const wrap = el('div', { dataset: { installCard: 'true' } });

  if (isInstalled()) {
    wrap.append(card('Install',
      el('p', { class: 'small' },
        el('span', { style: { color: 'var(--good)', fontWeight: '650' } }, '✓ Installed'),
        ' — running as an app on this device.'),
    ));
    return wrap;
  }

  if (canInstall()) {
    wrap.append(card('Install',
      el('p', { class: 'muted small' },
        'Add Pasta Pass Tracker to your home screen for a full-screen app that works offline.'),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn--primary',
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            const outcome = await promptInstall();
            if (outcome === 'accepted') toast('Installing…');
            else if (outcome === 'dismissed') toast('Install dismissed');
            else toast('Install is not available right now.', 'bad');
            const current = document.querySelector('[data-install-card]');
            if (current) current.replaceWith(installCard());
          },
        }, '📲 Install app'),
      ),
    ));
    return wrap;
  }

  if (isIos()) {
    wrap.append(card('Install',
      el('p', { class: 'muted small' },
        'On iPhone and iPad, tap the Share button, then "Add to Home Screen".'),
    ));
    return wrap;
  }

  wrap.append(card('Install',
    el('p', { class: 'muted small' },
      'Your browser has not offered an install prompt yet. It usually appears after a '
      + 'visit or two, and needs the app to be served over HTTPS. Look for an install '
      + 'icon in the address bar.'),
  ));
  return wrap;
}

/** Build identity, so a deployed version can be identified precisely. */
async function aboutCard() {
  const build = await getBuildInfo();

  if (build.development) {
    return card('About',
      el('p', { class: 'small muted' }, 'Development build — running from source.'),
      el('p', { class: 'small muted' },
        'Version details appear once deployed by the GitHub Pages workflow.'),
    );
  }

  return card('About',
    el('dl', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '.25rem .75rem',
        margin: 0,
        fontSize: '.85rem',
      },
    },
    el('dt', { class: 'muted' }, 'Commit'),
    el('dd', { style: { margin: 0 } },
      el('a', {
        class: 'mono',
        href: `${REPO_URL}/commit/${build.commit}`,
        target: '_blank',
        rel: 'noopener',
      }, build.short)),
    el('dt', { class: 'muted' }, 'Built'),
    el('dd', { class: 'mono', style: { margin: 0 } }, build.built),
    ),
  );
}

function appearanceCard(container) {
  const theme = getTheme();
  const modeChips = [
    modeChip('System', 'system', theme.mode, container),
    modeChip('Light', 'light', theme.mode, container),
    modeChip('Dark', 'dark', theme.mode, container),
  ];
  const paletteChips = getPalettes().map((palette) => paletteChip(palette, theme, container));
  const custom = theme.palette === 'custom' ? customPaletteControl(theme, container) : null;

  return card('Appearance',
    el('div', { class: 'stack' },
      el('div', {},
        el('h2', {}, 'Colour scheme'),
        el('div', { class: 'chips', role: 'group', 'aria-label': 'Colour scheme' }, modeChips),
        el('p', { class: 'field__hint' }, 'System follows your device setting and updates automatically.'),
      ),
      el('div', {},
        el('h2', {}, 'Palette'),
        el('div', { class: 'chips', role: 'group', 'aria-label': 'Palette' }, paletteChips),
      ),
      custom,
    ),
  );
}

function modeChip(label, mode, activeMode, container) {
  return el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': activeMode === mode ? 'true' : 'false',
    onClick: async () => {
      applyTheme({ mode });
      await renderFresh(container);
    },
  }, label);
}

function paletteChip(palette, theme, container) {
  const active = theme.palette === palette.id;
  const swatch = el('span', {
    'aria-hidden': 'true',
    style: {
      width: '.8rem',
      height: '.8rem',
      borderRadius: '50%',
      background: SWATCHES[palette.id] || (active ? 'var(--accent)' : 'var(--surface-3)'),
      border: '1px solid var(--border)',
      display: 'inline-block',
    },
  });
  return el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': active ? 'true' : 'false',
    onClick: async () => {
      applyTheme({ palette: palette.id });
      await renderFresh(container);
    },
  }, swatch, palette.label);
}

function customPaletteControl(theme, container) {
  const input = el('input', {
    class: 'input input--inline',
    type: 'color',
    value: theme.custom?.accent || SWATCHES.marinara,
    onChange: async (e) => {
      const custom = deriveCustom(e.target.value, resolveScheme());
      if (!custom) return;
      applyTheme({ palette: 'custom', custom });
      await renderFresh(container);
    },
  });
  return field('Custom palette accent', input, 'Pick an accent colour; the app derives accessible companion colours.');
}

function pricingCard(settings) {
  return card('Pricing',
    el('p', { class: 'muted small' }, 'Used only when a location has no default price. Existing visits keep the price saved with them.'),
    el('div', { class: 'row' },
      settingNumber('Meal price', SETTING_KEYS.mealPrice, settings, DEFAULT_SETTINGS[SETTING_KEYS.mealPrice], '0.01'),
      settingNumber('Topping surcharge', SETTING_KEYS.toppingPrice, settings, DEFAULT_SETTINGS[SETTING_KEYS.toppingPrice], '0.01'),
    ),
    field('Topping charge mode', el('select', {
      class: 'select',
      onChange: async (e) => saveSetting(SETTING_KEYS.toppingChargeMode, e.target.value),
    },
    option('perVisit', 'Once per visit', settings[SETTING_KEYS.toppingChargeMode] || 'perVisit'),
    option('perBowl', 'On every topped bowl', settings[SETTING_KEYS.toppingChargeMode] || 'perVisit'))),
    settingNumber('Pass cost', SETTING_KEYS.passCost, settings, DEFAULT_SETTINGS[SETTING_KEYS.passCost], '1'),
  );
}

function seasonCard(settings) {
  return card('Season',
    el('p', { class: 'muted small' }, 'Pass holders get early access from Aug 24; the public promotion runs Aug 31 – Nov 22.'),
    el('div', { class: 'row' },
      settingDate('Season start date', SETTING_KEYS.seasonStart, settings, DEFAULT_SETTINGS[SETTING_KEYS.seasonStart]),
      settingDate('Season end date', SETTING_KEYS.seasonEnd, settings, DEFAULT_SETTINGS[SETTING_KEYS.seasonEnd]),
    ),
  );
}

function settingNumber(label, key, settings, fallback, step) {
  return field(label, el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step,
    value: settings[key] ?? fallback,
    onChange: async (e) => saveSetting(key, parseNumber(e.target.value, fallback)),
  }));
}

function settingDate(label, key, settings, fallback) {
  return field(label, el('input', {
    class: 'input',
    type: 'date',
    value: settings[key] || fallback,
    onChange: async (e) => saveSetting(key, e.target.value || fallback),
  }));
}

function option(value, label, selected) {
  return el('option', { value, selected: selected === value }, label);
}

async function saveSetting(key, value) {
  await setSetting(key, value);
  toast('Saved');
}

async function menuEditorCard(container, usedMenuIds, activeMenus, combos) {
  const [pastas, sauces, toppings] = activeMenus;
  const comboText = `${pastas.length} pastas x ${sauces.length} sauces x ${toppings.length + 1} topping options = ${combos} combinations`;

  return card('Menu editor',
    el('p', { class: 'muted small' }, `${comboText}. Olive Garden advertises 120 for 2026.`),
    el('div', { class: 'stack' }, await Promise.all(KINDS.map((kind) => menuKindSection(kind, container, usedMenuIds)))),
  );
}

async function menuKindSection(kind, container, usedMenuIds) {
  const items = await listMenuAll(kind);
  const active = items.filter((item) => !item.deletedAt);
  const retired = items.filter((item) => item.deletedAt);
  return el('section', { class: 'stack' },
    el('div', { class: 'spread', style: { alignItems: 'center', flexWrap: 'wrap' } },
      el('h2', {}, KIND_LABEL[kind]),
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => addMenuItem(kind, container),
      }, `＋ Add ${kind}`),
    ),
    active.length ? el('ul', { class: 'list' }, active.map((item) => menuItemRow(item, container, usedMenuIds))) : el('p', { class: 'muted small' }, `No active ${kind} items.`),
    retired.length ? el('div', { class: 'stack' },
      el('h3', { class: 'muted' }, 'Retired'),
      el('ul', { class: 'list' }, retired.map((item) => menuItemRow(item, container, usedMenuIds, true))),
    ) : null,
  );
}

function menuItemRow(item, container, usedMenuIds, retired = false) {
  const unused = !usedMenuIds.has(item.id);
  const picker = retired ? null : photoPicker('menuItem', () => item.id, { multiple: false, label: 'Photo' });
  return el('li', {},
    el('div', {
      class: 'list__item',
      style: { opacity: retired ? '.58' : '' },
    },
    el('div', { class: 'list__body stack' },
      el('div', { class: 'list__title' },
        item.name || 'Unnamed item',
        item.isNew ? [' ', el('span', { class: 'badge' }, 'NEW')] : null,
      ),
      picker,
    ),
    el('div', { class: 'btn-row btn-row--end', style: { justifyContent: 'flex-end' } },
      retired ? el('button', {
        type: 'button',
        class: 'btn btn--sm',
        onClick: () => mutateMenu(container, () => restoreMenuItem(item.id)),
      }, 'Restore') : [
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          onClick: () => renameMenuItem(item, container),
        }, 'Rename'),
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          onClick: () => retireItem(item, container),
        }, 'Retire'),
      ],
      unused ? el('button', {
        type: 'button',
        class: 'btn btn--danger btn--sm',
        onClick: () => deleteMenuItemForever(item, container),
      }, 'Delete forever') : null,
    )),
  );
}

async function addMenuItem(kind, container) {
  const result = await modal((close) => {
    const nameInput = el('input', { class: 'input', type: 'text', required: true, autofocus: true });
    const isNewInput = el('input', { type: 'checkbox' });
    return el('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) return;
        await saveMenuItem({ kind, name: nameInput.value.trim(), isNew: isNewInput.checked });
        close(true);
      },
    },
    el('h2', {}, `Add ${KIND_LABEL[kind].toLowerCase()}`),
    field('Name', nameInput),
    el('label', { class: 'switch' }, isNewInput, el('span', {}, 'Mark as NEW')),
    modalButtons(close));
  });
  if (result) await afterMenuMutation(container);
}

async function renameMenuItem(item, container) {
  const result = await modal((close) => {
    const nameInput = el('input', { class: 'input', type: 'text', required: true, value: item.name || '', autofocus: true });
    const isNewInput = el('input', { type: 'checkbox', checked: !!item.isNew });
    return el('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) return;
        await saveMenuItem({ ...item, name: nameInput.value.trim(), isNew: isNewInput.checked });
        close(true);
      },
    },
    el('h2', {}, 'Rename menu item'),
    field('Name', nameInput),
    el('label', { class: 'switch' }, isNewInput, el('span', {}, 'Mark as NEW')),
    modalButtons(close));
  });
  if (result) await afterMenuMutation(container);
}

async function retireItem(item, container) {
  const ok = await confirmDialog({
    title: `Retire ${item.name}?`,
    message: 'Retiring hides the item from new bowls but preserves historical visits.',
    confirmLabel: 'Retire',
  });
  if (ok) await mutateMenu(container, () => retireMenuItem(item.id));
}

async function deleteMenuItemForever(item, container) {
  const ok = await confirmDialog({
    title: `Delete ${item.name} forever?`,
    message: 'Retiring is usually better because it preserves history. This item is not used by any bowl, so permanent deletion is available.',
    confirmLabel: 'Delete forever',
    danger: true,
  });
  if (ok) await mutateMenu(container, () => destroyMenuItem(item.id));
}

function modalButtons(close, saveLabel = 'Save') {
  return el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
    el('button', { type: 'button', class: 'btn', onClick: () => close(false) }, 'Cancel'),
    el('button', { type: 'submit', class: 'btn btn--primary' }, saveLabel),
  );
}

async function mutateMenu(container, action) {
  await action();
  await afterMenuMutation(container);
}

async function afterMenuMutation(container) {
  invalidateMenuCache();
  await renderFresh(container);
}

function backupCard() {
  const fileInput = el('input', {
    class: 'input',
    type: 'file',
    accept: 'application/json',
    onChange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = await readBackupFile(file);
        const summary = inspectBackup(parsed);
        await previewRestore(parsed, summary);
      } catch (err) {
        toast(err.message || 'Could not read backup', 'bad');
      }
    },
  });

  return card('Backup & restore',
    el('p', { class: 'muted small', style: { fontWeight: '650' } }, 'Data lives only in this browser. Export a backup before clearing browser data or switching devices.'),
    el('div', { class: 'btn-row' },
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: async () => {
          await downloadBackup({ includePhotos: true });
          toast('Backup downloaded');
        },
      }, 'Download backup (with photos)'),
      el('button', {
        type: 'button',
        class: 'btn',
        onClick: async () => {
          await downloadBackup({ includePhotos: false });
          toast('Backup downloaded');
        },
      }, 'Download data only (smaller)'),
    ),
    field('Import backup', fileInput, 'Choose a JSON backup to preview it before restoring.'),
  );
}

async function previewRestore(parsed, summary) {
  await modal((close) => el('div', {},
    el('h2', {}, 'Restore backup?'),
    el('p', { class: 'muted' }, 'Replace wipes current data first. Merge keeps existing rows and overwrites only rows with matching ids.'),
    el('dl', { class: 'small', style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.35rem .75rem' } },
      detail('Exported', summary.exportedAt ? new Date(summary.exportedAt).toLocaleString() : 'Unknown'),
      detail('Photos', summary.includesPhotos ? 'Included' : 'Not included'),
      Object.entries(summary.counts).map(([store, count]) => detail(store, String(count))),
    ),
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
      el('button', { type: 'button', class: 'btn', onClick: () => close() }, 'Cancel'),
      el('button', {
        type: 'button',
        class: 'btn',
        onClick: async () => restoreChosen(parsed, 'merge'),
      }, 'Merge'),
      el('button', {
        type: 'button',
        class: 'btn btn--danger',
        onClick: async () => restoreChosen(parsed, 'replace'),
      }, 'Replace everything'),
    ),
  ), { wide: true });
}

async function restoreChosen(parsed, mode) {
  await restoreBackup(parsed, { mode });
  invalidateMenuCache();
  toast('Restored');
  location.reload();
}

function storageDangerCard(container, usage, counts) {
  return card('Storage & danger zone',
    usage?.usage != null && usage?.quota != null
      ? el('p', { class: 'muted small' }, `Using ${formatBytes(usage.usage)} of ${formatBytes(usage.quota)} available.`)
      : el('p', { class: 'muted small' }, 'Storage estimate is not available in this browser.'),
    el('div', { class: 'grid grid--2 grid--sm-3' },
      COUNT_STORES.map((store) => el('div', { class: 'stat' },
        el('div', { class: 'stat__value' }, String(counts[store] || 0)),
        el('div', { class: 'stat__label' }, store),
      )),
    ),
    el('div', { class: 'divider' }),
    el('div', { class: 'btn-row' },
      el('button', {
        type: 'button',
        class: 'btn btn--danger',
        onClick: () => resetMenu(container),
      }, 'Reset menu to the 2026 defaults'),
      el('button', {
        type: 'button',
        class: 'btn btn--danger',
        onClick: () => eraseAllData(container),
      }, 'Erase all data'),
    ),
  );
}

async function resetMenu(container) {
  const ok = await confirmDialog({
    title: 'Reset menu to 2026 defaults?',
    message: 'This deletes all custom menu items. Bowls referencing retired or custom items will show fallback names. Export a backup first if you may want to undo this.',
    confirmLabel: 'Reset menu',
    danger: true,
  });
  if (!ok) return;
  await clearStore('menuItems');
  await setSetting(SETTING_KEYS.seeded, false);
  await ensureSeeded();
  invalidateMenuCache();
  await renderFresh(container);
  toast('Menu reset');
}

async function eraseAllData(container) {
  const ok = await confirmDialog({
    title: 'Erase all Pasta Pass Tracker data?',
    message: 'This permanently wipes diners, visits, bowls, photos, menu edits and settings '
      + 'stored in this browser, returning the app to a clean first run with the default 2026 '
      + 'menu. Export a backup first if there is any chance you will want this back.',
    confirmLabel: 'Erase all data',
    danger: true,
  });
  if (!ok) return;
  await wipeEverything();
  // Restore the reference menu so the app is usable again straight away;
  // without it every pasta and sauce picker would be empty.
  await ensureSeeded();
  invalidateMenuCache();
  await renderFresh(container);
  toast('All data erased');
}

function navigationCard() {
  return card('Navigation',
    el('div', { class: 'btn-row' },
      el('a', { class: 'btn', href: '#/people' }, 'Diners'),
      el('a', { class: 'btn', href: '#/locations' }, 'Locations'),
    ),
    el('p', { class: 'muted small', style: { marginTop: '.75rem' } }, 'About: Pasta Pass Tracker stores everything locally in this browser and works offline after it has loaded.'),
  );
}

function detail(label, value) {
  return [
    el('dt', { class: 'muted' }, label),
    el('dd', { style: { margin: 0 } }, value),
  ];
}

async function loadCounts() {
  const rows = await Promise.all(STORE_NAMES.map((store) => getAll(store)));
  return Object.fromEntries(STORE_NAMES.map((store, i) => [store, rows[i].length]));
}

function menuUsage(bowls) {
  const used = new Set();
  for (const bowl of bowls) {
    if (bowl.pastaId) used.add(bowl.pastaId);
    if (bowl.sauceId) used.add(bowl.sauceId);
    if (bowl.toppingId) used.add(bowl.toppingId);
  }
  return used;
}

async function renderFresh(container) {
  container.replaceChildren();
  await render(container, {});
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
