import { getAll, getSettings, save, deleteLocationDetach } from '../db.js';
import {
  el, empty, field, modal, confirmDialog, money, plural,
} from '../ui.js';

export async function render(container, params) {
  void params;
  const [locations, visits, settings] = await Promise.all([
    getAll('locations'),
    getAll('visits'),
    getSettings(),
  ]);

  const visitCounts = new Map();
  let visitsWithoutLocation = 0;
  for (const visit of visits) {
    if (visit.locationId == null || visit.locationId === '') {
      visitsWithoutLocation += 1;
    } else {
      visitCounts.set(visit.locationId, (visitCounts.get(visit.locationId) || 0) + 1);
    }
  }

  const addButton = el('button', {
    type: 'button',
    class: 'btn btn--primary',
    onClick: () => openLocationModal(null, settings, container),
  }, '＋ Add location');

  container.append(
    el('header', { class: 'spread' },
      el('h1', {}, 'Locations'),
      addButton,
    ),
  );

  if (!locations.length) {
    container.append(empty(
      '📍',
      'No locations yet',
      'Locations are optional — add them if you want per-location pricing and stats.',
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        onClick: () => openLocationModal(null, settings, container),
      }, '＋ Add location'),
    ));
  } else {
    const sorted = [...locations].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    container.append(el('ul', { class: 'list' }, sorted.map((location) => {
      const count = visitCounts.get(location.id) || 0;
      const price = location.defaultMealPrice == null ? null : Number(location.defaultMealPrice);
      return el('li', {}, el('a', {
        href: '#',
        class: 'list__item',
        style: { cursor: 'pointer' },
        onClick: (e) => {
          e.preventDefault();
          openLocationModal(location, settings, container);
        },
      },
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title' }, location.name || 'Unnamed location'),
        el('div', { class: 'list__meta' }, locationMeta(location)),
      ),
      el('div', { class: 'list__trail' },
        el('div', {}, plural(count, 'visit')),
        price == null || !Number.isFinite(price)
          ? null
          : el('div', { class: 'small' }, `${money(price)} meal`),
      ),
      ));
    })));
  }

  if (visitsWithoutLocation) {
    container.append(el('p', {
      class: 'muted small',
      style: { marginTop: '.75rem' },
    }, `${plural(visitsWithoutLocation, 'visit')} `
      + `${visitsWithoutLocation === 1 ? 'has' : 'have'} no location assigned.`));
  }
}

function locationMeta(location) {
  const city = String(location.city || '').trim();
  const state = String(location.state || '').trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || 'No city/state';
}

async function openLocationModal(location, settings, container) {
  const isNew = !location;
  const result = await modal((close) => {
    const nameInput = el('input', {
      class: 'input',
      type: 'text',
      required: true,
      value: location?.name || '',
      placeholder: 'Olive Garden — Brookfield',
    });
    const cityInput = el('input', { class: 'input', type: 'text', value: location?.city || '' });
    const stateInput = el('input', {
      class: 'input',
      type: 'text',
      value: location?.state || '',
      maxlength: '12',
    });
    const mealInput = el('input', {
      class: 'input',
      type: 'number',
      min: '0',
      step: '0.01',
      value: priceValue(location?.defaultMealPrice),
      placeholder: money(settings.mealPrice),
    });
    const toppingInput = el('input', {
      class: 'input',
      type: 'number',
      min: '0',
      step: '0.01',
      value: priceValue(location?.defaultToppingPrice),
      placeholder: money(settings.toppingPrice),
    });
    const notesInput = el('textarea', { class: 'textarea' });
    notesInput.value = location?.notes || '';

    return el('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) {
          nameInput.setCustomValidity('Name is required.');
          nameInput.reportValidity();
          nameInput.setCustomValidity('');
          return;
        }
        await save('locations', {
          ...location,
          name: nameInput.value.trim(),
          city: cityInput.value.trim(),
          state: stateInput.value.trim(),
          defaultMealPrice: optionalMoney(mealInput.value),
          defaultToppingPrice: optionalMoney(toppingInput.value),
          notes: notesInput.value.trim(),
        });
        close(true);
      },
    },
    el('h2', {}, isNew ? 'Add location' : 'Edit location'),
    field('Name', nameInput),
    el('div', { class: 'row' },
      field('City', cityInput),
      field('State', stateInput),
    ),
    field('Default meal price', mealInput, 'Leave blank to use the global default. Used to prefill new visits.'),
    field('Default topping surcharge', toppingInput, 'Leave blank to use the global default. Used to prefill new visits.'),
    field('Notes', notesInput),
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
      !isNew ? el('button', {
        type: 'button',
        class: 'btn btn--danger',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete location?',
            message: 'Visits at this location are kept and simply lose their location.',
            confirmLabel: 'Delete location',
            danger: true,
          });
          if (!ok) return;
          await deleteLocationDetach(location.id);
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

function optionalMoney(value) {
  if (String(value || '').trim() === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceValue(value) {
  return value == null || !Number.isFinite(Number(value)) ? '' : String(value);
}
