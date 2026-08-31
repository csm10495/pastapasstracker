import { getAll, getSetting, setSetting } from '../db.js';
import {
  allowedComboCount, allowedItems, comboKey, exclusionKey, listMenu, untriedSuggestions,
} from '../menu.js';
import { barChart, donut } from '../charts.js';
import { clear, el, empty, modal, plural } from '../ui.js';
import { SETTING_KEYS } from '../schema.js';

export async function render(container, params) {
  void params;

  const [pastas, sauces, toppings, bowls, people, savedExclusions] = await Promise.all([
    listMenu('pasta'),
    listMenu('sauce'),
    listMenu('topping'),
    getAll('bowls'),
    getAll('people'),
    getSetting(SETTING_KEYS.comboExclusions),
  ]);

  const activePeople = people
    .filter((person) => person.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const toppingOptions = [{ id: null, name: 'No topping' }, ...toppings];
  const totalCombos = pastas.length * sauces.length * toppingOptions.length;
  const possibleCombos = possibleSet(pastas, sauces, toppingOptions);
  const menuItemCount = pastas.length + sauces.length + toppings.length;

  let selectedPersonId = null;
  // A menu item retired since the preference was saved simply stops matching,
  // so a stale key is harmless and is dropped the next time this is written.
  let exclusions = new Set(Array.isArray(savedExclusions) ? savedExclusions : []);

  container.append(el('header', { class: 'spread' },
    el('div', {},
      el('h1', {}, 'Combo Explorer'),
      el('p', { class: 'muted small' }, 'Track every pasta, sauce, and topping combination.'),
    ),
    el('a', {
      class: 'btn btn--primary nowrap',
      href: '#/visits/new',
      style: { flex: 'none' },
    }, '＋ Log a bowl'),
  ));

  if (menuItemCount === 0) {
    container.append(empty(
      '🍽️',
      'No menu items',
      'Add pastas and sauces in Settings.',
      el('a', { class: 'btn btn--primary', href: '#/settings' }, 'Open Settings'),
    ));
    return;
  }

  const host = el('div', { class: 'stack' });
  container.append(host);

  const setExclusions = async (next) => {
    exclusions = next;
    await setSetting(SETTING_KEYS.comboExclusions, [...next]);
    redraw();
  };

  const redraw = () => {
    clear(host);
    const scopedBowls = selectedPersonId
      ? bowls.filter((bowl) => bowl.personId === selectedPersonId)
      : bowls;
    const triedCombos = triedSet(scopedBowls, possibleCombos);
    const triedCount = triedCombos.size;
    const fraction = totalCombos ? triedCount / totalCombos : 0;

    host.append(
      summaryCard({ triedCount, totalCombos, fraction }),
      personFilters(activePeople, selectedPersonId, (personId) => {
        selectedPersonId = personId;
        redraw();
      }),
      suggestCard({
        pastas, sauces, toppingOptions, triedCombos, totalCombos, exclusions,
      }),
      preferencesCard({ pastas, sauces, toppingOptions, exclusions, setExclusions }),
    );

    if (!bowls.length) {
      host.append(el('div', { class: 'card' },
        el('p', { class: 'muted' }, 'Log a visit to start filling this in.'),
        el('a', { class: 'btn btn--primary', href: '#/visits/new' }, 'Log a visit'),
      ));
    }

    host.append(matrix({
      pastas,
      sauces,
      toppingOptions,
      triedCombos,
      bowls: scopedBowls,
      peopleById,
      exclusions,
    }));

    host.append(exploredCard({ pastas, sauces, bowls: scopedBowls }));
  };

  redraw();
}

function possibleSet(pastas, sauces, toppingOptions) {
  const keys = new Set();
  for (const pasta of pastas) {
    for (const sauce of sauces) {
      for (const topping of toppingOptions) keys.add(comboKey(pasta.id, sauce.id, topping.id));
    }
  }
  return keys;
}

function triedSet(bowls, possibleCombos) {
  const keys = new Set();
  for (const bowl of bowls) {
    const key = comboKey(bowl.pastaId, bowl.sauceId, bowl.toppingId);
    if (possibleCombos.has(key)) keys.add(key);
  }
  return keys;
}

function summaryCard({ triedCount, totalCombos, fraction }) {
  const remaining = Math.max(0, totalCombos - triedCount);
  return el('div', {
    class: 'card',
    style: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  },
  donut(fraction, { size: 140, label: 'Combo coverage' }),
  el('div', { style: { flex: '1 1 12rem' } },
    el('div', { class: 'stat__value stat__value--accent' }, `${triedCount} of ${totalCombos} tried`),
    el('p', { class: 'muted' }, `${plural(remaining, 'combo')} remaining`),
  ));
}

function personFilters(activePeople, selectedPersonId, onSelect) {
  return el('div', { class: 'card' },
    el('div', { class: 'card__title' }, 'Filter'),
    el('div', { class: 'chips', role: 'group', 'aria-label': 'Combo person filter' },
      chip('Everyone', selectedPersonId == null, () => onSelect(null)),
      activePeople.map((person) => chip(person.name || 'Unnamed diner', selectedPersonId === person.id, () => onSelect(person.id))),
    ),
  );
}

function chip(label, pressed, onClick) {
  return el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': pressed ? 'true' : 'false',
    onClick,
  }, label);
}

function suggestCard({ pastas, sauces, toppingOptions, triedCombos, totalCombos, exclusions }) {
  const allowed = allowedComboCount({ pastas, sauces, toppingOptions, exclusions });
  const filtered = exclusions.size > 0;
  return el('div', { class: 'card' },
    el('div', { class: 'spread', style: { gap: '.75rem', flexWrap: 'wrap' } },
      el('div', {},
        el('div', { class: 'card__title' }, 'Suggest something new'),
        el('p', { class: 'muted small' },
          filtered
            ? `Picks from the ${allowed} of ${totalCombos} combos you eat.`
            : 'Pick a random untried combo for the current filter.'),
      ),
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => suggestCombo({
          pastas, sauces, toppingOptions, triedCombos, totalCombos, exclusions,
        }),
      }, 'Suggest something new'),
    ),
  );
}

/**
 * Ingredient opt-outs.
 *
 * Retiring an item in Settings would hide it from logging entirely and shrink
 * the advertised combo total. This is the softer control: the ingredient stays
 * loggable and still counts towards coverage, but suggestions skip it.
 */
function preferencesCard({ pastas, sauces, toppingOptions, exclusions, setExclusions }) {
  const toggle = (item) => {
    const next = new Set(exclusions);
    const key = exclusionKey(item);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExclusions(next);
  };

  const group = (label, items) => {
    const kept = allowedItems(items, exclusions).length;
    return el('div', {},
      el('div', { class: 'spread', style: { gap: '.5rem', flexWrap: 'wrap' } },
        el('h3', { style: { marginBottom: '.35rem' } }, label),
        el('span', { class: 'small muted' }, `${kept} of ${items.length}`),
      ),
      el('div', { class: 'chips', role: 'group', 'aria-label': `${label} used for suggestions` },
        items.map((item) => chip(
          item.name,
          !exclusions.has(exclusionKey(item)),
          () => toggle(item),
        )),
      ),
    );
  };

  const details = el('details', { class: 'card' },
    el('summary', {
      style: { cursor: 'pointer', minHeight: '44px', paddingTop: '.6rem', fontWeight: '650' },
    },
    exclusions.size
      ? `Ingredients — skipping ${plural(exclusions.size, 'ingredient')}`
      : 'Ingredients — using everything'),
    el('p', { class: 'muted small', style: { marginTop: '.75rem' } },
      'Turn off anything you would rather not eat and suggestions will skip it. '
      + 'Your logged bowls and combo coverage are unaffected.'),
    el('div', { class: 'stack' },
      group('Pastas', pastas),
      group('Sauces', sauces),
      group('Toppings', toppingOptions),
    ),
    exclusions.size
      ? el('div', { class: 'btn-row', style: { marginTop: '.75rem' } },
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          onClick: () => setExclusions(new Set()),
        }, 'Use everything again'),
      )
      : null,
  );
  // Keep the panel open across the redraw a toggle triggers, so a diner can
  // switch several ingredients off without reopening it each time.
  details.open = exclusions.size > 0;
  return details;
}

function suggestCombo({ pastas, sauces, toppingOptions, triedCombos, totalCombos, exclusions }) {
  const allowed = allowedComboCount({ pastas, sauces, toppingOptions, exclusions });

  if (!allowed) {
    notice('No combos match',
      'Every pasta, sauce, or topping is switched off. Turn at least one of each back on '
      + 'under Ingredients.');
    return;
  }

  const untried = untriedSuggestions({
    pastas, sauces, toppingOptions, tried: triedCombos, exclusions: [...exclusions],
  });

  if (!untried.length) {
    notice('All combos tried!',
      exclusions.size
        ? `You've tried all ${allowed} combos that match your ingredients.`
        : `You've tried all ${totalCombos} — incredible.`,
      'Nice');
    return;
  }

  const pick = untried[Math.floor(Math.random() * untried.length)];
  modal((close) => el('div', {},
    el('h2', {}, 'Try this next'),
    el('p', {}, suggestionText(pick)),
    el('div', { class: 'btn-row btn-row--end' },
      el('button', { type: 'button', class: 'btn', onClick: () => close() }, 'Close'),
      el('a', { class: 'btn btn--primary', href: '#/visits/new', onClick: () => close() }, 'Log it'),
    ),
  ));
}

function notice(title, message, confirmLabel = 'Close') {
  modal((close) => el('div', {},
    el('h2', {}, title),
    el('p', {}, message),
    el('div', { class: 'btn-row btn-row--end' },
      el('button', { type: 'button', class: 'btn btn--primary', onClick: () => close() }, confirmLabel),
    ),
  ));
}

function matrix({ pastas, sauces, toppingOptions, triedCombos, bowls, peopleById, exclusions }) {
  const wrapper = el('div', { class: 'stack' });
  for (const pasta of pastas) {
    wrapper.append(el('section', { class: 'card' },
      el('h2', { style: { display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' } },
        pasta.name,
        newBadge(pasta),
        skipBadge(pasta, exclusions),
      ),
      el('div', { style: { overflowX: 'auto', paddingBottom: '.2rem' } },
        matrixGrid({ pasta, sauces, toppingOptions, triedCombos, bowls, peopleById, exclusions }),
      ),
    ));
  }
  if (!pastas.length || !sauces.length) {
    wrapper.append(el('div', { class: 'card' },
      el('p', { class: 'muted' }, 'Add at least one pasta and one sauce in Settings to build the combo matrix.'),
      el('a', { class: 'btn btn--primary', href: '#/settings' }, 'Open Settings'),
    ));
  }
  return wrapper;
}

function matrixGrid({ pasta, sauces, toppingOptions, triedCombos, bowls, peopleById, exclusions }) {
  const grid = el('div', {
    role: 'grid',
    style: {
      display: 'grid',
      gridTemplateColumns: `minmax(9rem, 1.3fr) repeat(${toppingOptions.length}, minmax(4.8rem, 1fr))`,
      gap: '.35rem',
      minWidth: `${9 + toppingOptions.length * 5.2}rem`,
      alignItems: 'stretch',
    },
  });

  grid.append(el('div', { class: 'small muted', role: 'columnheader' }, 'Sauce'));
  for (const topping of toppingOptions) {
    grid.append(el('div', {
      class: 'small',
      role: 'columnheader',
      style: { fontWeight: '650', textAlign: 'center' },
    }, nameWithBadge(topping), skipBadge(topping, exclusions)));
  }

  for (const sauce of sauces) {
    grid.append(el('div', {
      role: 'rowheader',
      style: {
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        gap: '.35rem',
        fontWeight: '650',
      },
    }, sauce.name, newBadge(sauce), skipBadge(sauce, exclusions)));

    for (const topping of toppingOptions) {
      const key = comboKey(pasta.id, sauce.id, topping.id);
      const tried = triedCombos.has(key);
      const label = `${pasta.name}, ${sauce.name}, ${topping.name} — ${tried ? 'tried' : 'not tried yet'}`;
      grid.append(el('button', {
        type: 'button',
        role: 'gridcell',
        title: label,
        'aria-label': label,
        onClick: () => openComboModal({ pasta, sauce, topping, bowls, peopleById }),
        style: {
          minHeight: '44px',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${tried ? 'var(--accent)' : 'var(--border)'}`,
          background: tried ? 'var(--accent-soft)' : 'var(--surface-2)',
          color: tried ? 'var(--accent)' : 'var(--text-dim)',
          font: 'inherit',
          fontWeight: tried ? '750' : '650',
          cursor: 'pointer',
        },
      }, tried ? '✓' : '·'));
    }
  }

  return grid;
}

function openComboModal({ pasta, sauce, topping, bowls, peopleById }) {
  const key = comboKey(pasta.id, sauce.id, topping.id);
  const matches = bowls.filter((bowl) => comboKey(bowl.pastaId, bowl.sauceId, bowl.toppingId) === key);
  const tried = matches.length > 0;
  const byPerson = new Map();
  for (const bowl of matches) byPerson.set(bowl.personId, (byPerson.get(bowl.personId) || 0) + 1);
  const fullName = comboName({ pasta, sauce, topping });

  modal((close) => el('div', {},
    el('h2', {}, fullName),
    el('p', { class: tried ? '' : 'muted' }, tried ? `Tried ${plural(matches.length, 'time')}.` : 'Not tried yet.'),
    tried ? el('ul', { class: 'list', style: { marginBottom: '1rem' } },
      [...byPerson.entries()].map(([personId, count]) => {
        const person = peopleById.get(personId);
        return el('li', { class: 'list__item' },
          el('div', { class: 'list__body' },
            el('div', { class: 'list__title' }, person?.name || 'Unknown diner'),
            el('div', { class: 'list__meta' }, plural(count, 'bowl')),
          ),
        );
      }),
    ) : null,
    el('p', { class: 'small muted' }, comboParts({ pasta, sauce, topping })),
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
      el('button', { type: 'button', class: 'btn', onClick: () => close() }, 'Close'),
      el('a', { class: 'btn btn--primary', href: '#/visits/new', onClick: () => close() }, 'Log this combo'),
    ),
  ));
}

function exploredCard({ pastas, sauces, bowls }) {
  const pastaRows = topRows(pastas, bowls, 'pastaId');
  const sauceRows = topRows(sauces, bowls, 'sauceId');
  const leastPastas = leastRows(pastas, bowls, 'pastaId');
  const leastSauces = leastRows(sauces, bowls, 'sauceId');

  return el('div', { class: 'card' },
    el('div', { class: 'card__title' }, 'Most / least explored'),
    el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' } },
      el('div', {},
        el('h3', {}, 'Top pastas'),
        barChart(pastaRows, { valueFormat: (v) => plural(v, 'bowl') }),
      ),
      el('div', {},
        el('h3', {}, 'Top sauces'),
        barChart(sauceRows, { valueFormat: (v) => plural(v, 'bowl') }),
      ),
    ),
    el('div', { class: 'divider' }),
    el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' } },
      leastList('Least used pastas', leastPastas),
      leastList('Least used sauces', leastSauces),
    ),
  );
}

function topRows(items, bowls, key) {
  return countRows(items, bowls, key)
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function leastRows(items, bowls, key) {
  return countRows(items, bowls, key)
    .sort((a, b) => a.value - b.value || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function countRows(items, bowls, key) {
  const counts = new Map();
  for (const bowl of bowls) {
    const id = bowl[key];
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return items.map((item) => ({ label: item.name, value: counts.get(item.id) || 0 }));
}

function leastList(title, rows) {
  return el('div', {},
    el('h3', {}, title),
    rows.length ? el('ul', { class: 'list' }, rows.map((row) => el('li', { class: 'list__item' },
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title' }, row.label),
        el('div', { class: 'list__meta' }, plural(row.value, 'bowl')),
      ),
    ))) : el('p', { class: 'muted small' }, 'No menu items yet.'),
  );
}

function nameWithBadge(item) {
  return [item.name, newBadge(item)];
}

function newBadge(item) {
  return item?.isNew ? el('span', { class: 'badge' }, 'NEW') : null;
}

/** Marks an ingredient the suggester has been told to skip. */
function skipBadge(item, exclusions) {
  if (!exclusions?.has(exclusionKey(item))) return null;
  return el('span', { class: 'badge', title: 'Skipped by suggestions' }, 'SKIPPED');
}

function comboName({ pasta, sauce, topping }) {
  return `${pasta.name} with ${sauce.name}${topping.id ? ` and ${topping.name}` : ''}`;
}

function suggestionText(pick) {
  return `Try ${pick.pasta.name} with ${pick.sauce.name}${pick.topping.id ? ` and ${pick.topping.name}` : ''}.`;
}

function comboParts({ pasta, sauce, topping }) {
  return `${pasta.name} · ${sauce.name} · ${topping.name}`;
}
