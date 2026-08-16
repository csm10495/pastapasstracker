import {
  deleteBowlDeep,
  deletePhotosFor,
  endOtherOpenVisits,
  getAll,
  getById,
  getByIndex,
  getSettings,
  save,
  uid,
} from '../db.js';
import { listMenu, menuMap } from '../menu.js';
import { card, el, empty, field, todayISO, toast } from '../ui.js';
import { photoPicker } from '../photos.js';

export async function render(container, params) {
  const editing = !!params.id;
  const visitId = editing ? params.id : uid();

  const [
    existingVisit,
    existingBowls,
    locations,
    settings,
    allPeople,
    pastas,
    sauces,
    toppings,
    allMenu,
  ] = await Promise.all([
    editing ? getById('visits', visitId) : Promise.resolve(null),
    editing ? getByIndex('bowls', 'visitId', visitId) : Promise.resolve([]),
    getAll('locations'),
    getSettings(),
    getAll('people'),
    listMenu('pasta'),
    listMenu('sauce'),
    listMenu('topping'),
    menuMap(),
  ]);

  if (editing && !existingVisit) {
    container.append(empty(
      '🔍',
      'Visit not found',
      'That visit may have been deleted.',
      el('a', { class: 'btn', href: '#/visits' }, 'Back to visits'),
    ));
    return;
  }

  const activePeople = allPeople
    .filter((person) => person.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const peopleById = new Map(allPeople.map((person) => [person.id, person]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const originalBowlIds = new Set(existingBowls.map((bowl) => bowl.id));
  let saved = false;
  let bowls = existingBowls
    .slice()
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((bowl) => ({ ...bowl }));

  let priceTouched = false;

  const dateInput = el('input', {
    type: 'date',
    class: 'input',
    value: existingVisit?.date || todayISO(),
  });
  const locationSelect = el('select', { class: 'select' },
    el('option', { value: '' }, '— No location —'),
    locations
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map((location) => el('option', {
        value: location.id,
        selected: existingVisit?.locationId === location.id,
      }, location.name)),
  );
  const mealPriceInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    class: 'input',
    value: priceValue(existingVisit?.mealPrice ?? resolveMealPrice(null, settings)),
    onInput: () => { priceTouched = true; },
  });
  const toppingPriceInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    class: 'input',
    value: priceValue(existingVisit?.toppingPrice ?? resolveToppingPrice(null, settings)),
    onInput: () => { priceTouched = true; },
  });
  const notesInput = el('textarea', { class: 'textarea' }, existingVisit?.notes || '');

  // A visit logged for today is probably one you are sitting at; anything
  // backdated is history. The control is always shown so either can be chosen.
  const openCheckbox = el('input', {
    type: 'checkbox',
    checked: editing
      ? !existingVisit.endedAt
      : (existingVisit?.date || todayISO()) === todayISO(),
  });
  const openField = el('label', { class: 'switch' },
    openCheckbox,
    el('span', {}, 'Still at the table (open visit)'),
  );
  const visitPhotos = photoPicker('visit', () => visitId, { multiple: true, label: 'Add photos' });
  const bowlList = el('div', { class: 'stack' });

  locationSelect.addEventListener('change', () => {
    if (priceTouched) return;
    const location = locationById.get(locationSelect.value) || null;
    mealPriceInput.value = priceValue(resolveMealPrice(location, settings));
    toppingPriceInput.value = priceValue(resolveToppingPrice(location, settings));
  });

  container.append(el('header', {},
    el('h1', {}, editing ? 'Edit visit' : 'Log a visit'),
  ));

  container.append(el('form', {
    class: 'stack',
    onSubmit: async (event) => {
      event.preventDefault();
      await saveVisit();
    },
  },
  card('Visit',
    field('Date', dateInput),
    field('Location (optional)', el('div', { class: 'stack' },
      locationSelect,
      el('a', { href: '#/locations', class: 'small' }, 'Manage locations'),
    )),
    el('div', { class: 'grid grid--2' },
      field('Meal price', mealPriceInput),
      field('Topping surcharge', toppingPriceInput),
    ),
    el('p', { class: 'field__hint' }, 'Prices vary by location. This is saved with the visit.'),
    field('Status', el('div', {},
      openField,
      el('span', { class: 'field__hint' },
        'Open means you are still ordering. Ending a visit just marks it finished.'),
    )),
    field('Notes', notesInput),
    field('Visit photos', visitPhotos),
  ),
  card('Bowls',
    !activePeople.length
      ? empty('👥', 'Add a diner first', 'A diner is needed before logging bowls.',
        el('a', { class: 'btn', href: '#/people' }, 'Manage people'))
      : null,
    el('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        disabled: !activePeople.length,
        onClick: () => addBowl(),
      }, '＋ Add bowl'),
      el('button', {
        type: 'button',
        class: 'btn',
        disabled: !activePeople.length,
        onClick: () => repeatLastBowl(),
      }, '⟳ Repeat last bowl'),
    ),
    bowlList,
    el('div', { class: 'btn-row', style: { marginTop: '.75rem' } },
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        disabled: !activePeople.length,
        onClick: () => addBowl(),
      }, '＋ Add bowl'),
      el('button', {
        type: 'button',
        class: 'btn',
        disabled: !activePeople.length,
        onClick: () => repeatLastBowl(),
      }, '⟳ Repeat last bowl'),
    ),
  ),
  el('div', { class: 'btn-row btn-row--end' },
    el('a', {
      class: 'btn',
      href: editing ? `#/visits/${encodeURIComponent(visitId)}` : '#/visits',
      onClick: async (event) => {
        if (editing) return;
        event.preventDefault();
        await cleanupUnsavedPhotos();
        location.hash = '#/visits';
      },
    }, 'Cancel'),
    el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save'),
  )));

  renderBowls();

  // Photos attach to pre-generated ids before the visit is saved, so a new
  // visit abandoned via the tab bar or back button would otherwise leave
  // orphaned blobs behind.
  return () => {
    if (editing || saved) return;
    cleanupUnsavedPhotos();
  };

  function addBowl(seed = {}) {
    bowls.push({
      id: uid(),
      visitId,
      personId: seed.personId || activePeople[0]?.id || '',
      pastaId: seed.pastaId || pastas[0]?.id || '',
      sauceId: seed.sauceId || sauces[0]?.id || '',
      toppingId: seed.toppingId ?? null,
      rating: seed.rating ?? null,
      notes: seed.notes || '',
    });
    renderBowls();
  }

  function repeatLastBowl() {
    const last = bowls[bowls.length - 1];
    if (!last) {
      addBowl();
      return;
    }
    addBowl({
      personId: last.personId,
      pastaId: last.pastaId,
      sauceId: last.sauceId,
      toppingId: last.toppingId,
    });
  }

  function renderBowls() {
    if (!bowls.length) {
      bowlList.replaceChildren(el('p', { class: 'muted small' }, 'No bowls yet. Add one for each serving or refill.'));
      return;
    }
    bowlList.replaceChildren(...bowls.map((bowl, index) => bowlCard(bowl, index)));
  }

  function bowlCard(bowl, index) {
    const picker = photoPicker('bowl', () => bowl.id, { multiple: false, label: 'Photo' });
    return card(`Bowl ${index + 1}`,
      el('div', { class: 'grid grid--2' },
        field('Person', selectFor(peopleOptions(bowl.personId), bowl.personId, (value) => { bowl.personId = value; })),
        field('Pasta', selectFor(menuOptions(pastas, bowl.pastaId, 'Deleted pasta'), bowl.pastaId, (value) => { bowl.pastaId = value; })),
        field('Sauce', selectFor(menuOptions(sauces, bowl.sauceId, 'Deleted sauce'), bowl.sauceId, (value) => { bowl.sauceId = value; })),
        field('Topping', selectFor(toppingOptions(bowl.toppingId), bowl.toppingId || '', (value) => { bowl.toppingId = value || null; })),
        field('Rating', selectFor(ratingOptions(), bowl.rating ?? '', (value) => { bowl.rating = value === '' ? null : Number(value); })),
        field('Bowl photo', picker),
      ),
      el('div', { class: 'btn-row btn-row--end', style: { marginTop: '.75rem' } },
        el('button', {
          type: 'button',
          class: 'btn btn--danger',
          onClick: async () => {
            const [removed] = bowls.splice(index, 1);
            if (removed && !originalBowlIds.has(removed.id)) await deleteBowlDeep(removed.id);
            renderBowls();
          },
        }, 'Remove'),
      ),
    );
  }

  function peopleOptions(selectedId) {
    const options = activePeople.map((person) => ({ value: person.id, label: person.name || 'Unnamed diner' }));
    if (selectedId && !options.some((option) => option.value === selectedId)) {
      const person = peopleById.get(selectedId);
      options.push({ value: selectedId, label: person ? `${person.name} (inactive)` : 'Deleted diner' });
    }
    return options;
  }

  function menuOptions(activeItems, selectedId, fallback) {
    const options = activeItems.map((item) => ({
      value: item.id,
      label: item.name + (item.isNew ? ' (NEW)' : ''),
    }));
    if (selectedId && !options.some((option) => option.value === selectedId)) {
      const item = allMenu.get(selectedId);
      options.push({ value: selectedId, label: item ? `${item.name} (retired)` : fallback });
    }
    return options;
  }

  function toppingOptions(selectedId) {
    return [
      { value: '', label: 'No topping' },
      ...menuOptions(toppings, selectedId, 'Deleted topping'),
    ];
  }

  async function saveVisit() {
    const date = dateInput.value;
    if (!date) {
      toast('Choose a date.', 'bad');
      return;
    }
    for (const bowl of bowls) {
      if (!bowl.personId || !bowl.pastaId || !bowl.sauceId) {
        toast('Each bowl needs a person, pasta, and sauce.', 'bad');
        return;
      }
    }

    const wantOpen = openCheckbox.checked;
    // Only one table at a time: opening this visit closes any other.
    if (wantOpen) await endOtherOpenVisits(visitId);

    await save('visits', {
      ...(existingVisit || {}),
      id: visitId,
      date,
      locationId: locationSelect.value || null,
      notes: notesInput.value.trim(),
      mealPrice: Number(mealPriceInput.value || 0),
      toppingPrice: Number(toppingPriceInput.value || 0),
      endedAt: wantOpen
        ? null
        : (existingVisit?.endedAt || new Date().toISOString()),
    });

    const keptIds = new Set(bowls.map((bowl) => bowl.id));
    if (editing) {
      for (const bowlId of originalBowlIds) {
        if (!keptIds.has(bowlId)) await deleteBowlDeep(bowlId);
      }
    }

    for (const [seq, bowl] of bowls.entries()) {
      await save('bowls', {
        ...bowl,
        visitId,
        toppingId: bowl.toppingId || null,
        rating: bowl.rating == null ? null : Number(bowl.rating),
        notes: bowl.notes || '',
        seq,
      });
    }

    toast('Visit saved');
    saved = true;
    location.hash = `#/visits/${encodeURIComponent(visitId)}`;
  }

  async function cleanupUnsavedPhotos() {
    await deletePhotosFor('visit', visitId);
    for (const bowl of bowls) await deleteBowlDeep(bowl.id);
  }
}

function selectFor(options, value, onChange) {
  return el('select', {
    class: 'select',
    onChange: (event) => onChange(event.target.value),
  }, options.map((option) => el('option', {
    value: option.value,
    selected: String(option.value) === String(value),
  }, option.label)));
}

function ratingOptions() {
  return [
    { value: '', label: 'No rating' },
    ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: '★'.repeat(n) })),
  ];
}

function resolveMealPrice(location, settings) {
  return location?.defaultMealPrice ?? settings.mealPrice ?? 0;
}

function resolveToppingPrice(location, settings) {
  return location?.defaultToppingPrice ?? settings.toppingPrice ?? 0;
}

function priceValue(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}
