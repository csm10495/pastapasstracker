import { getAll, getSettings, save, uid, deletePersonDeep } from '../db.js';
import {
  el, empty, field, modal, confirmDialog, money, moneyShort, plural, bar,
} from '../ui.js';
import { avatarEl, photoPicker } from '../photos.js';
import { computeStats } from '../stats.js';

const DEFAULT_COLORS = ['#7a3e2f', '#2f6f4e', '#5b4b8a', '#a05a2c', '#2f657a', '#8a3f66'];

export async function render(container, params) {
  void params;
  const [people, visits, bowls, settings] = await Promise.all([
    getAll('people'),
    getAll('visits'),
    getAll('bowls'),
    getSettings(),
  ]);
  const stats = computeStats({ people, visits, bowls, settings });
  const statsByPerson = new Map(stats.perPerson.map((row) => [row.person.id, row]));

  const addButton = el('button', {
    type: 'button',
    class: 'btn btn--primary',
    onClick: () => openPersonModal(null, people, settings, container),
  }, '＋ Add diner');

  container.append(
    el('header', { class: 'spread' },
      el('h1', {}, 'Diners'),
      addButton,
    ),
  );

  if (!people.length) {
    container.append(empty(
      '🧑‍🍳',
      'No diners yet',
      'Add yourself (and anyone you dine with) to start logging bowls.',
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => openPersonModal(null, people, settings, container),
      }, '＋ Add diner'),
    ));
    return;
  }

  const sorted = [...people].sort((a, b) => {
    if ((a.active === false) !== (b.active === false)) return a.active === false ? 1 : -1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  const avatars = await Promise.all(sorted.map((person) => avatarEl(person, { size: '' })));

  container.append(el('ul', { class: 'list' }, sorted.map((person, index) => {
    const personStats = statsByPerson.get(person.id);
    const trail = personStats?.bowls
      ? el('div', {},
        el('div', {}, plural(personStats.bowls, 'bowl')),
        el('div', { class: 'small' }, `${moneyShort(personStats.costPerBowl)}/bowl`),
      )
      : '—';

    return el('li', {}, el('a', {
      href: '#',
      class: 'list__item',
      style: {
        cursor: 'pointer',
        opacity: person.active === false ? '.58' : '',
      },
      onClick: (e) => {
        e.preventDefault();
        openPersonModal(person, people, settings, container);
      },
    },
    avatars[index],
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title' }, person.name || 'Unnamed diner'),
      personMeta(person),
      person.hasPass ? breakEvenProgress(personStats, person) : null,
    ),
    el('div', { class: 'list__trail' }, trail),
    ));
  })));
}

function personMeta(person) {
  const bits = [];
  if (person.hasPass) {
    bits.push(el('span', { class: 'badge badge--pass' }, 'PASS'));
    bits.push(' ');
    bits.push(el('span', {}, money(person.passCost ?? 0)));
  } else {
    bits.push(el('span', { class: 'muted' }, 'Pays per visit'));
  }
  if (person.active === false) {
    bits.push(' ');
    bits.push(el('span', { class: 'badge' }, 'Inactive'));
  }
  return el('div', { class: 'list__meta' }, bits);
}

function breakEvenProgress(personStats, person) {
  const passCost = Number(person.passCost) || 0;
  const retailValue = Number(personStats?.retailValue) || 0;
  const remaining = Number(personStats?.remainingToBreakEven) || 0;
  const brokenEven = passCost <= 0 || remaining <= 0;
  return el('div', { class: 'stack', style: { marginTop: '.45rem' } },
    bar(passCost ? Math.min(1, retailValue / passCost) : 1),
    el('div', {
      class: 'small',
      style: { color: brokenEven ? 'var(--good)' : 'var(--text-dim)' },
    }, brokenEven ? 'Broken even!' : `${money(remaining)} to break even`),
  );
}

async function openPersonModal(person, people, settings, container) {
  const isNew = !person;
  const personId = person?.id || uid();
  const colorDefault = DEFAULT_COLORS[people.length % DEFAULT_COLORS.length];
  const draft = {
    id: personId,
    name: '',
    color: colorDefault,
    hasPass: false,
    passCost: settings.passCost ?? 100,
    passPurchasedOn: '',
    active: true,
    ...person,
  };

  const result = await modal((close) => {
    const nameInput = el('input', { class: 'input', type: 'text', required: true, value: draft.name || '' });
    const colorInput = el('input', { class: 'input input--inline', type: 'color', value: draft.color || colorDefault });
    const hasPassInput = el('input', { type: 'checkbox', checked: draft.hasPass });
    const passCostInput = el('input', {
      class: 'input',
      type: 'number',
      min: '0',
      step: '0.01',
      value: draft.passCost ?? settings.passCost ?? 100,
    });
    const passPurchasedInput = el('input', {
      class: 'input',
      type: 'date',
      value: draft.passPurchasedOn || '',
    });
    const activeInput = el('input', { type: 'checkbox', checked: draft.active !== false });
    const passFields = el('div', { class: 'stack' },
      field('Pass cost', passCostInput),
      field('Pass purchased on', passPurchasedInput),
    );
    passFields.hidden = !hasPassInput.checked;
    hasPassInput.addEventListener('change', () => {
      passFields.hidden = !hasPassInput.checked;
    });

    const picker = photoPicker('person', () => personId, { multiple: false, label: 'Avatar' });

    return el('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) {
          nameInput.setCustomValidity('Name is required.');
          nameInput.reportValidity();
          nameInput.setCustomValidity('');
          return;
        }
        const hasPass = hasPassInput.checked;
        await save('people', {
          ...person,
          id: personId,
          name: nameInput.value.trim(),
          color: colorInput.value,
          hasPass,
          passCost: hasPass ? parseMoney(passCostInput.value, settings.passCost ?? 100) : (person?.passCost ?? settings.passCost ?? 100),
          passPurchasedOn: hasPass ? (passPurchasedInput.value || null) : null,
          active: activeInput.checked,
        });
        close(true);
      },
    },
    el('h2', {}, isNew ? 'Add diner' : 'Edit diner'),
    field('Name', nameInput),
    field('Avatar photo', picker),
    field('Colour', colorInput),
    el('label', { class: 'switch' }, hasPassInput, el('span', {}, 'Has a Pasta Pass')),
    passFields,
    el('label', { class: 'switch' }, activeInput, el('span', {}, 'Active')),
    el('p', { class: 'field__hint' }, 'Inactive diners stay in your history but are hidden when logging new bowls.'),
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
      !isNew ? el('button', {
        type: 'button',
        class: 'btn btn--danger',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete diner?',
            message: 'Deleting a diner also deletes their logged bowls. This cannot be undone.',
            confirmLabel: 'Delete diner',
            danger: true,
          });
          if (!ok) return;
          await deletePersonDeep(personId);
          await renderFresh(container);
          close(true);
        },
      }, 'Delete') : null,
      el('button', { type: 'button', class: 'btn', onClick: () => close(false) }, 'Cancel'),
      el('button', { type: 'submit', class: 'btn btn--primary' }, 'Save'),
    ));
  });

  if (result) await renderFresh(container);
}

async function renderFresh(container) {
  container.replaceChildren();
  await render(container, {});
}

function parseMoney(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
