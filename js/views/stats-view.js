import { getAll, getSettings } from '../db.js';
import { menuMap } from '../menu.js';
import { avatarEl } from '../photos.js';
import {
  bar, card, el, empty, formatDate, money, num, plural, statTile, todayISO,
} from '../ui.js';
import { barChart, lineChart } from '../charts.js';
import {
  computeStats, projectCostPerBowl, seasonProgress, visitsToBreakEven,
} from '../stats.js';

export async function render(container, params) {
  void params;

  const [people, visits, bowls, settings] = await Promise.all([
    getAll('people'),
    getAll('visits'),
    getAll('bowls'),
    getSettings(),
  ]);

  if (!visits.length) {
    container.append(empty(
      '📊',
      'Nothing to crunch yet',
      'Log a visit and your stats will appear here.',
      el('a', { class: 'btn btn--primary', href: '#/visits/new' }, '＋ Log a visit'),
    ));
    return;
  }

  const stats = computeStats({ people, visits, bowls, settings });
  const season = seasonProgress(todayISO(), settings.seasonStart, settings.seasonEnd);
  const menu = await menuMap();

  container.append(el('header', {}, el('h1', {}, 'Stats')));
  container.append(headline(stats.totals));
  container.append(await perPersonSection(stats.perPerson, season, settings));
  container.append(seasonCard(season, settings));
  container.append(chartsSection(stats, bowls, menu));
  if (stats.priceStats?.varies) container.append(priceInsightCard(stats.priceStats));
  container.append(placesCard(stats.totals));
}

function headline(totals) {
  const saved = Number(totals.saved);
  const savedTone = saved > 0 ? 'good' : saved < 0 ? 'bad' : '';
  return el('div', { class: 'grid grid--2 grid--sm-4' },
    statTile(totals.bowls, totals.bowls === 1 ? 'Total bowl' : 'Total bowls', {
      sub: totals.bowlsPerVisit ? `${num(totals.bowlsPerVisit, 1)} per visit` : '',
    }),
    statTile(totals.visits, totals.visits === 1 ? 'Total visit' : 'Total visits', {
      sub: plural(totals.people || 0, 'diner'),
    }),
    statTile(money(totals.costPerBowl), 'Cost per bowl', {
      tone: 'accent',
      sub: `${money(totals.spend)} spent`,
    }),
    statTile(money(totals.saved), 'Money saved', {
      tone: savedTone,
      sub: `${money(totals.retail)} retail value`,
    }),
  );
}

async function perPersonSection(perPerson, season, settings) {
  const withBowls = perPerson
    .filter((row) => row.bowls > 0)
    .sort((a, b) => b.bowls - a.bowls || a.person.name.localeCompare(b.person.name));
  const withoutBowls = perPerson.filter((row) => row.bowls <= 0);

  const cards = await Promise.all(withBowls.map((row) => personCard(row, season, settings)));
  const children = [
    el('h2', {}, 'Per-person breakdown'),
    ...cards,
  ];

  if (withoutBowls.length) {
    children.push(await noBowlsDetails(withoutBowls));
  }

  return el('section', { class: 'stack', style: { marginTop: '.75rem' } }, children);
}

async function personCard(personStats, season, settings) {
  const { person } = personStats;
  const avatar = await avatarEl(person, { size: 'sm' });

  return el('div', { class: 'card stack' },
    el('div', { class: 'spread' },
      el('div', { class: 'row', style: { alignItems: 'center', gap: '.5rem' } },
        avatar,
        el('strong', {}, person.name || 'Unnamed diner'),
        person.hasPass ? el('span', { class: 'badge badge--pass' }, 'PASS') : null,
      ),
    ),
    el('div', { class: 'grid grid--3' },
      miniStat(personStats.bowls, personStats.bowls === 1 ? 'Bowl' : 'Bowls'),
      miniStat(personStats.visits, personStats.visits === 1 ? 'Visit' : 'Visits'),
      miniStat(money(personStats.costPerBowl), 'Cost/bowl'),
    ),
    person.hasPass
      ? passHolderDetails(personStats, season, settings)
      : payerDetails(personStats),
  );
}

function miniStat(value, label) {
  return el('div', { class: 'stat' },
    el('div', {
      class: 'stat__value',
      style: { fontSize: '1.15rem' },
    }, value),
    el('div', { class: 'stat__label' }, label),
  );
}

function passHolderDetails(personStats, season, settings) {
  const passCost = Number(personStats.person.passCost) || 0;
  const fraction = passCost > 0 ? Math.min(1, personStats.retailValue / passCost) : 1;
  const savedStyle = { color: personStats.saved > 0 ? 'var(--good)' : 'var(--text)' };
  const projected = projectCostPerBowl(personStats, season);

  return el('div', { class: 'stack' },
    el('p', { class: 'small muted' },
      'Spent ', money(personStats.spend),
      ' · retail value ', money(personStats.retailValue),
      ' · saved ', el('span', { style: savedStyle }, money(personStats.saved)),
    ),
    bar(fraction),
    breakEvenLine(personStats, settings),
    projected ? el('p', { class: 'small muted' },
      `At this pace you'll finish around ${projected.projectedBowls} bowls, `
      + `about ${money(projected.costPerBowl)} each`,
    ) : null,
  );
}

function breakEvenLine(personStats, settings) {
  if (personStats.breakEvenAt) {
    return el('p', { class: 'small', style: { color: 'var(--good)' } },
      `Broke even on ${formatDate(personStats.breakEvenAt.date)} `
      + `(visit #${personStats.breakEvenAt.visitNumber})`);
  }

  const visits = visitsToBreakEven(personStats, settings.mealPrice);
  if (visits == null) {
    return el('p', { class: 'small muted' }, 'Keep logging visits to estimate break-even.');
  }
  return el('p', { class: 'small muted' },
    `About ${visits} more ${visits === 1 ? 'visit' : 'visits'} to break even`);
}

function payerDetails(personStats) {
  return el('p', { class: 'small muted' },
    `Paid ${money(personStats.spend)} across ${plural(personStats.visits, 'visit')}. `,
    `${money(personStats.costPerBowl)} per bowl.`,
  );
}

async function noBowlsDetails(rows) {
  const items = await Promise.all(rows.map(async ({ person }) => el('li', { class: 'list__item' },
    await avatarEl(person, { size: 'sm' }),
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title' }, person.name || 'Unnamed diner'),
      person.hasPass ? el('div', { class: 'list__meta' }, el('span', { class: 'badge badge--pass' }, 'PASS')) : null,
    ),
  )));

  return el('details', { class: 'card' },
    el('summary', { style: { cursor: 'pointer', minHeight: '44px', paddingTop: '.6rem' } },
      'No bowls logged yet'),
    el('ul', { class: 'list', style: { marginTop: '.75rem' } }, items),
  );
}

function seasonCard(season, settings) {
  const start = settings.seasonStart;
  const end = settings.seasonEnd;
  if (!season) {
    return card('Season countdown', el('p', { class: 'muted' }, 'Season dates are not set.'));
  }

  if (season.phase === 'upcoming') {
    return card('Season countdown',
      el('p', {}, `Starts in ${plural(season.daysUntilStart, 'day')}`),
      el('p', { class: 'muted small' }, `Starts ${formatDate(start)}`),
    );
  }

  if (season.phase === 'ended') {
    return card('Season countdown',
      el('p', {}, `The season ended on ${formatDate(end)}`),
    );
  }

  return card('Season countdown',
    el('p', {}, `${plural(season.daysRemaining, 'day')} left`),
    bar(season.fraction),
    el('p', { class: 'muted small', style: { marginTop: '.5rem' } },
      `Day ${season.daysElapsed} of ${season.totalDays}`),
  );
}

function chartsSection(stats, bowls, menu) {
  return el('section', { class: 'stack', style: { marginTop: '.75rem' } },
    card('Bowls over time', chartWrap(lineChart(stats.timeline, { label: 'Bowls over time' }))),
    card('Favourite pastas', barChart(countRows(stats.pastaCounts, menu))),
    card('Favourite sauces', barChart(countRows(stats.sauceCounts, menu))),
    card('Toppings', barChart(toppingRows(stats.toppingCounts, bowls, menu))),
  );
}

function chartWrap(node) {
  return el('div', { style: { maxWidth: '100%', overflow: 'hidden' } }, node);
}

function countRows(counts, menu) {
  return counts.map(([id, value]) => ({
    label: menu.get(id)?.name || 'Unknown',
    value,
  }));
}

function toppingRows(counts, bowls, menu) {
  const rows = countRows(counts, menu);
  rows.push({
    label: 'No topping',
    value: bowls.filter((bowl) => !bowl.toppingId).length,
  });
  return rows.sort((a, b) => b.value - a.value);
}

function priceInsightCard(priceStats) {
  const message = priceStats.varies
    ? `Prices ranged from ${money(priceStats.min)} to ${money(priceStats.max)}, `
      + `averaging ${money(priceStats.average)}.`
    : `Average meal price: ${money(priceStats.average)}.`;
  return card('Price insight', el('p', {}, message));
}

function placesCard(totals) {
  return card('Places',
    el('p', {}, `Visited ${plural(totals.locations || 0, 'location')}`),
    totals.visitsWithoutLocation > 0
      ? el('p', { class: 'muted small' },
        `${plural(totals.visitsWithoutLocation, 'visit')} `
        + `${totals.visitsWithoutLocation === 1 ? 'has' : 'have'} no location assigned.`)
      : null,
  );
}
