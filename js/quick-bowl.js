/**
 * Quick "add a bowl" flow.
 *
 * The common case at the table is another bowl just like the last one, so the
 * sheet opens pre-filled with the previous bowl's choices — tapping Save is a
 * one-tap refill. Shared by the dashboard, the visit list, and visit detail.
 */

import { getAll, getByIndex, save, getById, deleteBowlDeep } from './db.js';
import { listMenu } from './menu.js';
import { el, modal, toast, field } from './ui.js';
import { photoPicker } from './photos.js';

/**
 * Opens the quick-add sheet for a visit.
 *
 * @param {string} visitId
 * @param {object} [opts]
 * @param {() => void} [opts.onAdded] called after each bowl is saved
 * @returns {Promise<number>} how many bowls were added
 */
export async function quickAddBowl(visitId, { onAdded } = {}) {
  const [visit, people, pastas, sauces, toppings, existing] = await Promise.all([
    getById('visits', visitId),
    getAll('people'),
    listMenu('pasta'),
    listMenu('sauce'),
    listMenu('topping'),
    getByIndex('bowls', 'visitId', visitId),
  ]);

  if (!visit) {
    toast('That visit no longer exists.', 'bad');
    return 0;
  }

  const activePeople = people
    .filter((p) => p.active !== false)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  if (!activePeople.length) {
    await modal((close) => el('div', {},
      el('h2', {}, 'Add a diner first'),
      el('p', { class: 'muted' }, 'A bowl has to belong to someone. Add a diner, then come back.'),
      el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
        el('button', { class: 'btn', onClick: () => close() }, 'Close'),
        el('a', {
          class: 'btn btn--primary',
          href: '#/people',
          onClick: () => close(),
        }, 'Add a diner'),
      ),
    ));
    return 0;
  }

  if (!pastas.length || !sauces.length) {
    toast('Add pastas and sauces in Settings first.', 'bad');
    return 0;
  }

  const previous = existing.slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).pop() || null;

  // Carried across sheets so "Save & add another" keeps the last choices.
  let draft = {
    personId: previous?.personId || activePeople[0].id,
    pastaId: previous?.pastaId || pastas[0].id,
    sauceId: previous?.sauceId || sauces[0].id,
    toppingId: previous?.toppingId ?? null,
    rating: null,
  };

  let added = 0;
  let nextSeq = existing.length;
  let again = true;

  while (again) {
    // eslint-disable-next-line no-await-in-loop -- sheets are inherently sequential
    again = (await showSheet()) === 'again';
  }
  return added;

  async function showSheet() {
    // A photo needs an owner id, so attaching one reserves the bowl row early.
    // If the sheet is then dismissed that reservation must be cleaned up, or a
    // half-finished bowl would be left behind.
    let reservedId = null;
    let committed = false;

    const outcome = await modal((close) => {
      const personSelect = selectOf(
        activePeople.map((p) => ({ value: p.id, label: p.name })), draft.personId,
      );
      const pastaSelect = selectOf(menuOptions(pastas), draft.pastaId);
      const sauceSelect = selectOf(menuOptions(sauces), draft.sauceId);
      const toppingSelect = selectOf(
        [{ value: '', label: 'No topping' }, ...menuOptions(toppings)], draft.toppingId || '',
      );
      const rating = ratingPicker();

      const readDraft = () => ({
        personId: personSelect.value,
        pastaId: pastaSelect.value,
        sauceId: sauceSelect.value,
        toppingId: toppingSelect.value || null,
        rating: rating.value(),
      });

      // The picker creates the bowl row on demand, so there is one photo
      // control here rather than a separate "create then attach" button.
      const photo = photoPicker('bowl', () => reservedId, {
        multiple: false,
        label: 'Add photo',
        ensureOwnerId: async () => {
          if (!reservedId) {
            const record = await save('bowls', {
              visitId, ...readDraft(), notes: '', seq: nextSeq,
            });
            reservedId = record.id;
          }
          return reservedId;
        },
      });

      const commit = async (next) => {
        draft = readDraft();
        await save('bowls', {
          ...(reservedId ? { id: reservedId } : {}),
          visitId,
          ...draft,
          notes: '',
          seq: nextSeq,
        });
        committed = true;
        reservedId = null;
        nextSeq += 1;
        added += 1;
        onAdded?.();
        toast('Bowl added');
        close(next);
      };

      return el('form', {
        onSubmit: (event) => { event.preventDefault(); commit('done'); },
      },
      el('h2', {}, 'Add a bowl'),
      previous
        ? el('p', { class: 'muted small' },
          'Pre-filled with the last bowl — just save for a repeat.')
        : null,
      field('Who', personSelect),
      el('div', { class: 'grid grid--2' },
        field('Pasta', pastaSelect),
        field('Sauce', sauceSelect),
      ),
      field('Topping', toppingSelect),
      field('Rating', rating.node),
      field('Photo', photo),
      el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
        el('button', { type: 'button', class: 'btn', onClick: () => close('cancel') }, 'Cancel'),
        el('button', {
          type: 'button',
          class: 'btn',
          onClick: () => commit('again'),
        }, 'Save & add another'),
        el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save'),
      ));
    });

    if (!committed && reservedId) await deleteBowlDeep(reservedId);
    return outcome;
  }
}

function menuOptions(items) {
  return items.map((item) => ({
    value: item.id,
    label: item.name + (item.isNew ? ' (NEW)' : ''),
  }));
}

function selectOf(options, selected) {
  return el('select', { class: 'select' },
    options.map((option) => el('option', {
      value: option.value,
      selected: String(option.value) === String(selected ?? ''),
    }, option.label)),
  );
}

function ratingPicker() {
  let value = null;
  const buttons = [1, 2, 3, 4, 5].map((n) => el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': 'false',
    'aria-label': `${n} star${n === 1 ? '' : 's'}`,
    onClick: () => {
      value = value === n ? null : n;
      for (const [i, b] of buttons.entries()) {
        b.setAttribute('aria-pressed', value && i < value ? 'true' : 'false');
      }
    },
  }, '★'));
  return { node: el('div', { class: 'chips' }, buttons), value: () => value };
}

/** A button that opens the quick-add sheet for a visit. */
export function addBowlButton(visitId, {
  onAdded,
  label = '＋ Add bowl',
  className = 'btn btn--primary',
} = {}) {
  return el('button', {
    type: 'button',
    class: className,
    onClick: () => quickAddBowl(visitId, { onAdded }),
  }, label);
}
