import { getAll } from '../db.js';
import { comboKey, listMenu } from '../menu.js';
import { barChart, donut } from '../charts.js';
import { clear, el, empty, modal, plural } from '../ui.js';

export async function render(container, params) {
  void params;

  const [pastas, sauces, toppings, bowls, people] = await Promise.all([
    listMenu('pasta'),
    listMenu('sauce'),
    listMenu('topping'),
    getAll('bowls'),
    getAll('people'),
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
      suggestCard({ pastas, sauces, toppingOptions, triedCombos, totalCombos }),
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

function suggestCard({ pastas, sauces, toppingOptions, triedCombos, totalCombos }) {
  return el('div', { class: 'card' },
    el('div', { class: 'spread', style: { gap: '.75rem', flexWrap: 'wrap' } },
      el('div', {},
        el('div', { class: 'card__title' }, 'Suggest something new'),
        el('p', { class: 'muted small' }, 'Pick a random untried combo for the current filter.'),
      ),
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => suggestCombo({ pastas, sauces, toppingOptions, triedCombos, totalCombos }),
      }, 'Suggest something new'),
    ),
  );
}

function suggestCombo({ pastas, sauces, toppingOptions, triedCombos, totalCombos }) {
  const untried = [];
  for (const pasta of pastas) {
    for (const sauce of sauces) {
      for (const topping of toppingOptions) {
        const key = comboKey(pasta.id, sauce.id, topping.id);
        if (!triedCombos.has(key)) untried.push({ pasta, sauce, topping });
      }
    }
  }

  if (!untried.length) {
    modal((close) => el('div', {},
      el('h2', {}, 'All combos tried!'),
      el('p', {}, `You've tried all ${totalCombos} — incredible.`),
      el('div', { class: 'btn-row btn-row--end' },
        el('button', { type: 'button', class: 'btn btn--primary', onClick: () => close() }, 'Nice'),
      ),
    ));
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

function matrix({ pastas, sauces, toppingOptions, triedCombos, bowls, peopleById }) {
  const wrapper = el('div', { class: 'stack' });
  for (const pasta of pastas) {
    wrapper.append(el('section', { class: 'card' },
      el('h2', { style: { display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' } },
        pasta.name,
        newBadge(pasta),
      ),
      el('div', { style: { overflowX: 'auto', paddingBottom: '.2rem' } },
        matrixGrid({ pasta, sauces, toppingOptions, triedCombos, bowls, peopleById }),
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

function matrixGrid({ pasta, sauces, toppingOptions, triedCombos, bowls, peopleById }) {
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
    }, nameWithBadge(topping)));
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
    }, sauce.name, newBadge(sauce)));

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

function comboName({ pasta, sauce, topping }) {
  return `${pasta.name} with ${sauce.name}${topping.id ? ` and ${topping.name}` : ''}`;
}

function suggestionText(pick) {
  return `Try ${pick.pasta.name} with ${pick.sauce.name}${pick.topping.id ? ` and ${pick.topping.name}` : ''}.`;
}

function comboParts({ pasta, sauce, topping }) {
  return `${pasta.name} · ${sauce.name} · ${topping.name}`;
}
