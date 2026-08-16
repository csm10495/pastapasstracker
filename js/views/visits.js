import { getAll, isVisitOpen, startVisit } from '../db.js';
import { el, empty, formatDate, money, plural, toast, todayISO } from '../ui.js';
import { thumbEl } from '../photos.js';
import { quickAddBowl } from '../quick-bowl.js';

export async function render(container, params) {
  void params;

  const [visits, bowls, locations, photos] = await Promise.all([
    getAll('visits'),
    getAll('bowls'),
    getAll('locations'),
    getAll('photos'),
  ]);

  visits.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const bowlsByVisit = new Map();
  for (const bowl of bowls) {
    bowlsByVisit.set(bowl.visitId, (bowlsByVisit.get(bowl.visitId) || 0) + 1);
  }

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const visitIds = new Set(visits.map((visit) => visit.id));
  const firstPhotoByVisit = new Map();
  for (const photo of photos
    .filter((p) => p.ownerType === 'visit' && visitIds.has(p.ownerId))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (!firstPhotoByVisit.has(photo.ownerId)) firstPhotoByVisit.set(photo.ownerId, photo);
  }

  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const openVisit = visits.find(isVisitOpen) || null;

  container.append(el('header', { class: 'spread' },
    el('h1', {}, 'Visits'),
    openVisit
      ? el('button', {
        class: 'btn btn--primary',
        onClick: async () => { await quickAddBowl(openVisit.id); rerender(); },
      }, '＋ Add bowl')
      : el('button', {
        class: 'btn btn--primary',
        onClick: async () => {
          const visit = await startVisit({ date: todayISO() });
          toast('Visit started');
          await quickAddBowl(visit.id);
          rerender();
        },
      }, '🍝 Start a visit'),
  ));

  if (!visits.length) {
    container.append(empty(
      '🍝',
      'No visits yet',
      'Start a visit when you sit down, or log a past one.',
      el('a', { class: 'btn', href: '#/visits/new' }, 'Log a past visit'),
    ));
    return;
  }

  container.append(el('div', { class: 'btn-row', style: { marginBottom: '.75rem' } },
    el('a', { class: 'btn btn--sm', href: '#/visits/new' }, 'Log a past visit'),
  ));

  const list = el('div', { class: 'list' });
  for (const visit of visits) {
    const location = visit.locationId ? locationById.get(visit.locationId) : null;
    const count = bowlsByVisit.get(visit.id) || 0;
    const photo = firstPhotoByVisit.get(visit.id);
    const thumb = photo ? thumbEl(photo, { alt: `Photo from ${formatDate(visit.date)}` }) : null;
    if (thumb) Object.assign(thumb.style, { width: '44px', height: '44px', flex: 'none' });
    const open = isVisitOpen(visit);

    list.append(el('a', {
      class: 'list__item',
      href: `#/visits/${encodeURIComponent(visit.id)}`,
      style: open ? { borderColor: 'var(--accent)' } : null,
    },
    thumb,
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title' },
        formatDate(visit.date),
        open ? ' ' : null,
        open ? el('span', { class: 'badge badge--pass' }, 'OPEN') : null,
      ),
      el('div', { class: 'list__meta' },
        location ? location.name : el('span', { class: 'muted' }, 'No location'),
        ' · ',
        plural(count, 'bowl'),
      ),
    ),
    el('div', { class: 'list__trail' }, money(visit.mealPrice)),
    ));
  }

  container.append(list);
}
