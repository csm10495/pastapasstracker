/**
 * Cost, savings, and pace calculations.
 *
 * Pure functions only — no DOM, no IndexedDB — so the numbers are easy to
 * reason about and test.
 *
 * Cost model
 * ----------
 * The Never-Ending Pasta Bowl is unlimited refills for one price, so retail
 * cost accrues *per person per visit*, not per bowl. Extra bowls are free
 * refills, which is exactly where the savings come from.
 *
 * Prices are read off the visit record (frozen at save time), never looked up
 * from the location or global settings at report time. That keeps historical
 * math stable when prices are edited later.
 */

import { comboKey } from './menu.js';

/** Topping surcharge a person incurred at one visit. */
function toppingCharge(visitBowls, visit, mode) {
  const price = Number(visit.toppingPrice) || 0;
  if (!price) return 0;
  const topped = visitBowls.filter((b) => b.toppingId);
  if (!topped.length) return 0;
  return mode === 'perBowl' ? topped.length * price : price;
}

/**
 * Full statistics roll-up.
 *
 * @param {object[]} people
 * @param {object[]} visits
 * @param {object[]} bowls
 * @param {object}   settings  { toppingChargeMode, passCost, seasonStart, seasonEnd }
 */
export function computeStats({ people = [], visits = [], bowls = [], settings = {} }) {
  const mode = settings.toppingChargeMode || 'perVisit';

  const visitById = new Map(visits.map((v) => [v.id, v]));
  const sortedVisits = [...visits].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Bowls grouped by visit and by person.
  const bowlsByVisit = new Map();
  const bowlsByPerson = new Map();
  for (const b of bowls) {
    if (!visitById.has(b.visitId)) continue;
    if (!bowlsByVisit.has(b.visitId)) bowlsByVisit.set(b.visitId, []);
    bowlsByVisit.get(b.visitId).push(b);
    if (!bowlsByPerson.has(b.personId)) bowlsByPerson.set(b.personId, []);
    bowlsByPerson.get(b.personId).push(b);
  }

  /* ------------------------------------------------------- per person --- */

  const perPerson = people.map((person) => {
    const theirBowls = bowlsByPerson.get(person.id) || [];

    // Visits where this person actually ate, in date order.
    const visitIds = [...new Set(theirBowls.map((b) => b.visitId))];
    const attended = visitIds
      .map((id) => visitById.get(id))
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let retailValue = 0;
    const ledger = [];
    for (const visit of attended) {
      const mine = theirBowls.filter((b) => b.visitId === visit.id);
      const meal = Number(visit.mealPrice) || 0;
      const tops = toppingCharge(mine, visit, mode);
      retailValue += meal + tops;
      ledger.push({
        visitId: visit.id,
        date: visit.date,
        bowls: mine.length,
        value: meal + tops,
        cumulative: retailValue,
      });
    }

    const passCost = person.hasPass ? (Number(person.passCost) || 0) : 0;
    const spend = person.hasPass ? passCost : retailValue;
    const saved = retailValue - spend;

    // Break-even: the first visit at which avoided cost covers the pass.
    let breakEvenAt = null;
    if (person.hasPass && passCost > 0) {
      const hit = ledger.find((entry) => entry.cumulative >= passCost);
      if (hit) breakEvenAt = { date: hit.date, visitNumber: ledger.indexOf(hit) + 1 };
    }

    const bowlCount = theirBowls.length;
    return {
      person,
      bowls: bowlCount,
      visits: attended.length,
      toppedBowls: theirBowls.filter((b) => b.toppingId).length,
      retailValue,
      spend,
      saved,
      costPerBowl: bowlCount ? spend / bowlCount : null,
      costPerVisit: attended.length ? spend / attended.length : null,
      bowlsPerVisit: attended.length ? bowlCount / attended.length : null,
      breakEvenAt,
      remainingToBreakEven: person.hasPass ? Math.max(0, passCost - retailValue) : 0,
      ledger,
    };
  });

  /* ----------------------------------------------------------- totals --- */

  const totalBowls = bowls.filter((b) => visitById.has(b.visitId)).length;
  const totalSpend = perPerson.reduce((s, p) => s + p.spend, 0);
  const totalRetail = perPerson.reduce((s, p) => s + p.retailValue, 0);
  const totalSaved = totalRetail - totalSpend;

  const locationIds = new Set(
    visits.map((v) => v.locationId).filter((id) => id != null && id !== ''),
  );
  const visitsWithoutLocation = visits.filter((v) => !v.locationId).length;

  const prices = visits.map((v) => Number(v.mealPrice) || 0).filter((n) => n > 0);
  const priceStats = prices.length ? {
    average: prices.reduce((a, b) => a + b, 0) / prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    varies: Math.max(...prices) - Math.min(...prices) > 0.005,
  } : null;

  /* -------------------------------------------------------- favourites -- */

  const tally = (key) => {
    const counts = new Map();
    for (const b of bowls) {
      const id = b[key];
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  const pastaCounts = tally('pastaId');
  const sauceCounts = tally('sauceId');
  const toppingCounts = tally('toppingId');

  /* ------------------------------------------------------- combos ------- */

  const triedCombos = new Set(
    bowls.map((b) => comboKey(b.pastaId, b.sauceId, b.toppingId)),
  );

  /* ------------------------------------------------------- timeline ----- */

  const byDate = new Map();
  for (const v of sortedVisits) {
    const count = (bowlsByVisit.get(v.id) || []).length;
    byDate.set(v.date, (byDate.get(v.date) || 0) + count);
  }
  const timeline = [...byDate.entries()].map(([date, count]) => ({ date, count }));

  return {
    totals: {
      visits: visits.length,
      bowls: totalBowls,
      people: people.length,
      spend: totalSpend,
      retail: totalRetail,
      saved: totalSaved,
      costPerBowl: totalBowls ? totalSpend / totalBowls : null,
      bowlsPerVisit: visits.length ? totalBowls / visits.length : null,
      locations: locationIds.size,
      visitsWithoutLocation,
    },
    perPerson,
    priceStats,
    pastaCounts,
    sauceCounts,
    toppingCounts,
    triedCombos,
    timeline,
    firstVisit: sortedVisits[0]?.date || null,
    lastVisit: sortedVisits[sortedVisits.length - 1]?.date || null,
  };
}

/**
 * Season progress for the countdown widget.
 * Dates are local YYYY-MM-DD strings.
 */
export function seasonProgress(todayISO, startISO, endISO) {
  const day = 86400000;
  const parse = (iso) => {
    if (!iso) return null;
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };
  const today = parse(todayISO);
  const start = parse(startISO);
  const end = parse(endISO);
  if (!today || !start || !end) return null;

  const totalDays = Math.round((end - start) / day) + 1;
  const elapsed = Math.round((today - start) / day);
  const daysUntilStart = Math.round((start - today) / day);
  const daysRemaining = Math.round((end - today) / day);

  let phase = 'active';
  if (today < start) phase = 'upcoming';
  else if (today > end) phase = 'ended';

  return {
    phase,
    totalDays,
    daysUntilStart: Math.max(0, daysUntilStart),
    daysRemaining: Math.max(0, daysRemaining),
    daysElapsed: Math.max(0, Math.min(totalDays, elapsed + 1)),
    fraction: phase === 'upcoming' ? 0
      : phase === 'ended' ? 1
        : Math.max(0, Math.min(1, (elapsed + 1) / totalDays)),
  };
}

/**
 * Projects the final cost per bowl if the current pace holds to season end.
 * Only meaningful for pass holders, whose spend is already sunk.
 */
export function projectCostPerBowl(personStats, season) {
  if (!personStats?.person?.hasPass) return null;
  if (!season || season.phase === 'upcoming') return null;
  if (!personStats.bowls || !season.daysElapsed) return null;

  const perDay = personStats.bowls / season.daysElapsed;
  const projectedBowls = personStats.bowls + perDay * season.daysRemaining;
  if (!projectedBowls) return null;
  return {
    projectedBowls: Math.round(projectedBowls),
    costPerBowl: personStats.spend / projectedBowls,
  };
}

/** Visits still needed to break even, using the average price seen so far. */
export function visitsToBreakEven(personStats, fallbackPrice = 14.99) {
  const p = personStats?.person;
  if (!p?.hasPass) return null;
  const remaining = personStats.remainingToBreakEven;
  if (remaining <= 0) return 0;
  const avg = personStats.visits
    ? personStats.retailValue / personStats.visits
    : fallbackPrice;
  if (!avg) return null;
  return Math.ceil(remaining / avg);
}
