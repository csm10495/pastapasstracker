/**
 * Dashboard: season countdown, headline numbers, per-diner pass progress,
 * combo coverage, and recent visits.
 */

import { getAll, getSettings, getOpenVisit, isVisitOpen, endVisit, startVisit } from '../db.js';
import { computeStats, seasonProgress, visitsToBreakEven } from '../stats.js';
import { comboCount } from '../menu.js';
import { donut } from '../charts.js';
import { avatarEl } from '../photos.js';
import { quickAddBowl } from '../quick-bowl.js';
import {
  el, card, statTile, bar, money, moneyShort, empty, plural,
  todayISO, formatDate, formatDateShort, confirmDialog, toast,
} from '../ui.js';

export async function render(container) {
  const [people, visits, bowls, locations, settings, totalCombos] = await Promise.all([
    getAll('people'), getAll('visits'), getAll('bowls'), getAll('locations'),
    getSettings(), comboCount(),
  ]);

  const stats = computeStats({ people, visits, bowls, settings });
  const season = seasonProgress(todayISO(), settings.seasonStart, settings.seasonEnd);
  const openVisit = visits.filter(isVisitOpen)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0]
    || null;

  const rerender = () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  container.append(seasonCard(season, settings));

  // The table card comes first when a visit is in progress: adding the next
  // bowl is the only thing that matters while you are sitting there.
  container.append(await tableCard({
    openVisit, bowls, locations, people, rerender,
  }));

  if (!visits.length) {
    container.append(el('div', { style: { marginTop: '1rem' } },
      empty('🍝', 'Welcome to Pasta Pass Tracker',
        'Add a diner, then start a visit. Everything is stored on this device.',
        el('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '.75rem' } },
          el('a', { class: 'btn btn--primary', href: '#/people' }, 'Add a diner'),
          el('a', { class: 'btn', href: '#/visits/new' }, 'Log a past visit'),
        )),
    ));
    return;
  }

  /* ------------------------------------------------------------ totals -- */

  const t = stats.totals;
  container.append(el('div', { class: 'card', style: { marginTop: '.75rem' } },
    el('div', { class: 'grid grid--2 grid--sm-4' },
      statTile(t.bowls, t.bowls === 1 ? 'Bowl' : 'Bowls', {
        sub: t.bowlsPerVisit ? `${t.bowlsPerVisit.toFixed(1)} per visit` : '',
      }),
      statTile(t.visits, t.visits === 1 ? 'Visit' : 'Visits', {
        sub: t.locations ? plural(t.locations, 'location') : '',
      }),
      statTile(money(t.costPerBowl), 'Cost / bowl', { tone: 'accent' }),
      statTile(money(t.saved), 'Saved', { tone: t.saved >= 0 ? 'good' : 'bad' }),
    ),
  ));

  container.append(el('div', { class: 'btn-row', style: { marginTop: '.75rem' } },
    el('a', { class: 'btn btn--block', href: '#/visits/new' }, 'Log a past visit'),
  ));

  /* ----------------------------------------------------------- diners --- */

  const eaters = stats.perPerson
    .filter((p) => p.bowls > 0)
    .sort((a, b) => b.bowls - a.bowls || a.person.name.localeCompare(b.person.name));
  if (eaters.length) {
    const rows = el('div', { class: 'stack' });
    for (const entry of eaters) {
      rows.append(await personRow(entry, settings));
    }
    container.append(el('div', { style: { marginTop: '.75rem' } },
      card('Diners', rows),
    ));
  }

  /* ----------------------------------------------------------- combos --- */

  const tried = stats.triedCombos.size;
  const fraction = totalCombos ? tried / totalCombos : 0;
  container.append(el('div', { style: { marginTop: '.75rem' } },
    card('Combo coverage',
      el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        },
      },
        donut(fraction, { size: 96, label: `${tried} of ${totalCombos} combos tried` }),
        el('div', { style: { flex: '1 1 10rem' } },
          el('p', { style: { margin: '0 0 .25rem', fontWeight: '650' } },
            `${tried} of ${totalCombos} tried`),
          el('p', { class: 'small muted', style: { margin: '0 0 .5rem' } },
            totalCombos - tried > 0
              ? `${plural(totalCombos - tried, 'combination')} still to go.`
              : 'Every combination tried. Remarkable.'),
          el('a', { class: 'btn btn--sm', href: '#/combos' }, 'Explore combos'),
        ),
      ),
    ),
  ));

  /* ------------------------------------------------------------ recent -- */

  const locationById = new Map(locations.map((l) => [l.id, l]));
  const bowlsPerVisit = new Map();
  for (const b of bowls) {
    bowlsPerVisit.set(b.visitId, (bowlsPerVisit.get(b.visitId) || 0) + 1);
  }

  const recent = [...visits]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 4);

  const list = el('ul', { class: 'list' });
  for (const v of recent) {
    const loc = v.locationId ? locationById.get(v.locationId) : null;
    list.append(el('li', {},
      el('a', { class: 'list__item', href: `#/visits/${v.id}` },
        el('div', { class: 'list__body' },
          el('div', { class: 'list__title' }, formatDate(v.date)),
          el('div', { class: 'list__meta' },
            loc ? loc.name : el('span', { class: 'muted' }, 'No location'),
          ),
        ),
        el('div', { class: 'list__trail' },
          el('div', {}, plural(bowlsPerVisit.get(v.id) || 0, 'bowl')),
          el('div', { class: 'muted small' }, moneyShort(v.mealPrice)),
        ),
      ),
    ));
  }

  container.append(el('div', { style: { marginTop: '.75rem' } },
    card('Recent visits', list,
      el('div', { class: 'btn-row', style: { marginTop: '.6rem' } },
        el('a', { class: 'btn btn--sm', href: '#/visits' }, 'All visits'),
        el('a', { class: 'btn btn--sm', href: '#/stats' }, 'Full stats'),
      ),
    ),
  ));
}

/* -------------------------------------------------------------- pieces -- */

/**
 * The "at the table" card.
 *
 * While a visit is open this is the primary control surface: one big button to
 * log the next bowl, and one to end the visit when you leave. With nothing
 * open it becomes the way to start one.
 */
async function tableCard({ openVisit, bowls, locations, people, rerender }) {
  const hasDiners = people.some((p) => p.active !== false);

  if (!openVisit) {
    return card('At the table',
      el('p', { class: 'muted small', style: { marginTop: '-.25rem' } },
        'Start a visit when you sit down, then add each bowl as it arrives.'),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn--primary',
          disabled: !hasDiners,
          onClick: async () => {
            const visit = await startVisit({ date: todayISO() });
            toast('Visit started');
            await quickAddBowl(visit.id);
            rerender();
          },
        }, '🍝 Start a visit'),
        !hasDiners
          ? el('a', { class: 'btn', href: '#/people' }, 'Add a diner first')
          : null,
      ),
    );
  }

  const visitBowls = bowls.filter((b) => b.visitId === openVisit.id);
  const location = openVisit.locationId
    ? locations.find((l) => l.id === openVisit.locationId)
    : null;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const perPerson = new Map();
  for (const bowl of visitBowls) {
    perPerson.set(bowl.personId, (perPerson.get(bowl.personId) || 0) + 1);
  }
  const tally = el('div', { class: 'chips', style: { marginTop: '.5rem' } });
  for (const [personId, count] of perPerson) {
    const person = peopleById.get(personId);
    tally.append(el('span', { class: 'chip' },
      await avatarEl(person || { name: '?' }, { size: 'sm' }),
      `${person?.name || 'Deleted diner'} · ${count}`,
    ));
  }

  return el('div', {
    class: 'card',
    style: { borderColor: 'var(--accent)', borderWidth: '2px' },
  },
  el('div', { class: 'spread' },
    el('div', { class: 'card__title', style: { marginBottom: 0 } }, 'At the table now'),
    el('span', { class: 'badge badge--pass' }, 'OPEN'),
  ),
  el('div', { style: { margin: '.4rem 0 .2rem' } },
    el('span', { style: { fontSize: '1.5rem', fontWeight: '750' } },
      String(visitBowls.length)),
    el('span', { class: 'muted' }, ` ${visitBowls.length === 1 ? 'bowl' : 'bowls'} so far`),
  ),
  el('div', { class: 'small muted' },
    formatDate(openVisit.date),
    location ? ` · ${location.name}` : '',
  ),
  perPerson.size ? tally : null,
  el('div', { class: 'btn-row', style: { marginTop: '.75rem' } },
    el('button', {
      class: 'btn btn--primary btn--block',
      style: { fontSize: '1.05rem', minHeight: '52px' },
      onClick: async () => {
        await quickAddBowl(openVisit.id);
        rerender();
      },
    }, '＋ Add bowl'),
  ),
  el('div', { class: 'btn-row', style: { marginTop: '.5rem' } },
    el('a', {
      class: 'btn btn--sm',
      href: `#/visits/${encodeURIComponent(openVisit.id)}`,
    }, 'View visit'),
    el('button', {
      class: 'btn btn--sm',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'End this visit?',
          message: visitBowls.length
            ? `Logged ${plural(visitBowls.length, 'bowl')}. You can reopen it later if you need to.`
            : 'No bowls were logged. You can reopen it later if you need to.',
          confirmLabel: 'End visit',
        });
        if (!ok) return;
        await endVisit(openVisit.id);
        toast('Visit ended');
        rerender();
      },
    }, 'End visit'),
  ));
}

function seasonCard(season, settings) {
  if (!season) return el('div');

  if (season.phase === 'upcoming') {
    return card('Season',
      el('div', { class: 'spread' },
        el('div', {},
          el('div', { style: { fontSize: '1.4rem', fontWeight: '750' } },
            season.daysUntilStart === 0
              ? 'Starts today'
              : `${plural(season.daysUntilStart, 'day')} to go`),
          el('div', { class: 'small muted' },
            `Pass access opens ${formatDate(settings.seasonStart)}`),
        ),
        el('span', { style: { fontSize: '2rem' } }, '⏳'),
      ),
    );
  }

  if (season.phase === 'ended') {
    return card('Season',
      el('div', { class: 'spread' },
        el('div', {},
          el('div', { style: { fontSize: '1.2rem', fontWeight: '700' } }, 'Season complete'),
          el('div', { class: 'small muted' }, `Ended ${formatDate(settings.seasonEnd)}`),
        ),
        el('span', { style: { fontSize: '2rem' } }, '🏁'),
      ),
    );
  }

  return card('Season',
    el('div', { class: 'spread', style: { marginBottom: '.5rem' } },
      el('div', { style: { fontSize: '1.4rem', fontWeight: '750' } },
        `${plural(season.daysRemaining, 'day')} left`),
      el('div', { class: 'small muted nowrap' },
        `Day ${season.daysElapsed} of ${season.totalDays}`),
    ),
    bar(season.fraction),
    el('div', { class: 'small muted', style: { marginTop: '.35rem' } },
      `${formatDateShort(settings.seasonStart)} – ${formatDateShort(settings.seasonEnd)}`),
  );
}

async function personRow(entry, settings) {
  const { person } = entry;
  const avatar = await avatarEl(person, { size: '' });

  const detail = el('div', { class: 'list__body' },
    el('div', { class: 'list__title' },
      person.name,
      person.hasPass ? ' ' : null,
      person.hasPass ? el('span', { class: 'badge badge--pass' }, 'PASS') : null,
    ),
    el('div', { class: 'list__meta' },
      `${plural(entry.bowls, 'bowl')} · ${plural(entry.visits, 'visit')}`
      + (entry.costPerBowl != null ? ` · ${money(entry.costPerBowl)} per bowl` : ''),
    ),
  );

  const row = el('div', { class: 'list__item' }, avatar, detail);

  if (person.hasPass) {
    const passCost = Number(person.passCost) || Number(settings.passCost) || 0;
    const fraction = passCost ? Math.min(1, entry.retailValue / passCost) : 0;
    const remaining = entry.remainingToBreakEven;
    const more = visitsToBreakEven(entry, settings.mealPrice);

    detail.append(el('div', { style: { marginTop: '.4rem' } }, bar(fraction)));
    detail.append(el('div', { class: 'small', style: { marginTop: '.25rem' } },
      remaining <= 0
        ? el('span', { style: { color: 'var(--good)', fontWeight: '650' } },
          `Broken even — ${money(entry.saved)} ahead`)
        : el('span', { class: 'muted' },
          `${money(remaining)} to break even`
          + (more ? ` (~${plural(more, 'visit')})` : '')),
    ));
  }

  return row;
}
