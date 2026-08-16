import {
  deleteVisitDeep, getAll, getById, getByIndex, isVisitOpen, endVisit, reopenVisit,
} from '../db.js';
import {
  card,
  confirmDialog,
  el,
  empty,
  formatDate,
  money,
  plural,
  statTile,
  toast,
} from '../ui.js';
import { avatarEl, listPhotos, thumbEl } from '../photos.js';
import { menuMap } from '../menu.js';
import { quickAddBowl } from '../quick-bowl.js';

export async function render(container, { id }) {
  const visit = await getById('visits', id);
  if (!visit) {
    container.append(empty(
      '🔍',
      'Visit not found',
      'That visit may have been deleted.',
      el('a', { class: 'btn', href: '#/visits' }, 'Back to visits'),
    ));
    return;
  }

  const [bowls, locations, people, menu, visitPhotos, bowlPhotos] = await Promise.all([
    getByIndex('bowls', 'visitId', id),
    getAll('locations'),
    getAll('people'),
    menuMap(),
    listPhotos('visit', id),
    getAll('photos'),
  ]);

  bowls.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const visitLocation = visit.locationId
    ? new Map(locations.map((loc) => [loc.id, loc])).get(visit.locationId)
    : null;
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const bowlIds = new Set(bowls.map((bowl) => bowl.id));
  const firstPhotoByBowl = new Map();
  for (const photo of bowlPhotos
    .filter((p) => p.ownerType === 'bowl' && bowlIds.has(p.ownerId))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (!firstPhotoByBowl.has(photo.ownerId)) firstPhotoByBowl.set(photo.ownerId, photo);
  }

  const open = isVisitOpen(visit);
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  container.append(el('header', { class: 'spread' },
    el('div', {},
      el('h1', { style: { marginBottom: '.15rem' } },
        formatDate(visit.date),
        open ? ' ' : null,
        open ? el('span', { class: 'badge badge--pass' }, 'OPEN') : null,
      ),
      el('div', { class: 'muted' }, visitLocation ? visitLocation.name : 'No location'),
    ),
    el('a', { class: 'btn', href: `#/visits/${encodeURIComponent(id)}/edit` }, 'Edit'),
  ));

  // While the visit is open, adding the next bowl is the primary action.
  if (open) {
    container.append(el('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
      el('button', {
        class: 'btn btn--primary btn--block',
        style: { fontSize: '1.05rem', minHeight: '52px' },
        onClick: async () => { await quickAddBowl(id); rerender(); },
      }, '＋ Add bowl'),
    ));
    container.append(el('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
      el('button', {
        class: 'btn btn--sm',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'End this visit?',
            message: 'You can reopen it later if you need to add more bowls.',
            confirmLabel: 'End visit',
          });
          if (!ok) return;
          await endVisit(id);
          toast('Visit ended');
          rerender();
        },
      }, 'End visit'),
    ));
  } else {
    container.append(el('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
      el('button', {
        class: 'btn',
        onClick: async () => { await quickAddBowl(id); rerender(); },
      }, '＋ Add bowl'),
      el('button', {
        class: 'btn btn--sm',
        onClick: async () => {
          await reopenVisit(id);
          toast('Visit reopened');
          rerender();
        },
      }, 'Reopen visit'),
    ));
  }

  if (visit.notes) container.append(card('Notes', el('p', {}, visit.notes)));

  if (visitPhotos.length) {
    container.append(card('Photos', el('div', { class: 'photo-grid' },
      visitPhotos.map((photo) => thumbEl(photo, { alt: `Photo from ${formatDate(visit.date)}` })),
    )));
  }

  const eatenPeople = uniquePeople(bowls, peopleById);
  container.append(card('Summary',
    el('div', { class: 'grid grid--2 grid--sm-4' },
      statTile(String(bowls.length), plural(bowls.length, 'bowl').replace(/^\d+\s/, '')),
      statTile(money(visit.mealPrice), 'Meal price'),
      statTile(money(visit.toppingPrice), 'Topping price'),
      statTile(String(eatenPeople.length), plural(eatenPeople.length, 'diner').replace(/^\d+\s/, '')),
    ),
    el('p', { class: 'small muted', style: { marginTop: '.75rem' } },
      eatenPeople.length ? `Ate: ${eatenPeople.map((person) => person.name).join(', ')}` : 'No bowls logged.'),
  ));

  container.append(card('Bowls', await bowlGroups(bowls, peopleById, menu, firstPhotoByBowl, open)));

  container.append(el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
    el('button', {
      class: 'btn btn--danger',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Delete visit?',
          message: 'This deletes the visit, its bowls, and their photos.',
          confirmLabel: 'Delete visit',
          danger: true,
        });
        if (!ok) return;
        await deleteVisitDeep(id);
        toast('Visit deleted');
        location.hash = '#/visits';
      },
    }, 'Delete visit'),
  ));
}

function uniquePeople(bowls, peopleById) {
  const seen = new Set();
  const out = [];
  for (const bowl of bowls) {
    if (seen.has(bowl.personId)) continue;
    seen.add(bowl.personId);
    out.push(peopleById.get(bowl.personId) || { id: bowl.personId, name: 'Deleted diner' });
  }
  return out;
}

async function bowlGroups(bowls, peopleById, menu, firstPhotoByBowl, open = false) {
  if (!bowls.length) {
    return empty(
      '🍜',
      'No bowls logged',
      open ? 'Use "Add bowl" above as each one arrives.' : 'Edit this visit to add bowls.',
    );
  }

  const byPerson = new Map();
  for (const bowl of bowls) {
    if (!byPerson.has(bowl.personId)) byPerson.set(bowl.personId, []);
    byPerson.get(bowl.personId).push(bowl);
  }

  const nodes = [];
  for (const [personId, rows] of byPerson) {
    const person = peopleById.get(personId) || { id: personId, name: 'Deleted diner' };
    nodes.push(el('section', { class: 'stack' },
      el('h2', { class: 'row', style: { alignItems: 'center', marginBottom: '.5rem' } },
        await avatarEl(person, { size: 'sm' }),
        el('span', {}, person.name),
      ),
      rows.map((bowl) => bowlRow(bowl, menu, firstPhotoByBowl.get(bowl.id))),
    ));
  }
  return el('div', { class: 'stack' }, nodes);
}

function bowlRow(bowl, menu, photo) {
  const pasta = menu.get(bowl.pastaId)?.name || 'Deleted pasta';
  const sauce = menu.get(bowl.sauceId)?.name || 'Deleted sauce';
  const topping = bowl.toppingId
    ? (menu.get(bowl.toppingId)?.name || 'Deleted topping')
    : el('span', { class: 'muted' }, 'No topping');
  const thumb = photo ? thumbEl(photo, { alt: `${pasta} bowl` }) : null;
  if (thumb) Object.assign(thumb.style, { width: '44px', height: '44px', flex: 'none' });

  return el('div', { class: 'list__item' },
    thumb,
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title' }, pasta, ' · ', sauce, ' · ', topping),
      bowl.notes ? el('div', { class: 'list__meta' }, bowl.notes) : null,
    ),
    bowl.rating ? el('div', { class: 'list__trail', title: `${bowl.rating}/5` }, '★'.repeat(bowl.rating)) : null,
  );
}
