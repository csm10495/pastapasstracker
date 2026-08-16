/**
 * Hand-rolled inline SVG charts.
 *
 * Deliberately dependency-free to keep the zero-build promise. Colours come
 * from CSS custom properties so charts retheme automatically.
 */

import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/**
 * Responsive frame: stretches to the container width with a fixed pixel
 * height. `height="auto"` is not a valid SVG length attribute, so sizing is
 * done through CSS instead.
 */
function frame(width, height, { responsive = true } = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
  });
  svg.style.display = 'block';
  svg.style.overflow = 'visible';
  if (responsive) {
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = height + 'px';
  }
  return svg;
}

/**
 * Horizontal bar chart, best for "favourite pasta" style rankings.
 * @param {{label:string,value:number}[]} rows
 */
export function barChart(rows, { max = null, valueFormat = (v) => v } = {}) {
  if (!rows.length) return el('p', { class: 'muted small' }, 'No data yet.');

  const peak = max ?? Math.max(...rows.map((r) => r.value), 1);
  const list = el('div', { class: 'stack' });

  for (const row of rows) {
    const fraction = peak ? row.value / peak : 0;
    list.append(el('div', {},
      el('div', { class: 'spread small' },
        el('span', {}, row.label),
        el('span', { class: 'muted mono' }, valueFormat(row.value)),
      ),
      el('div', { class: 'bar', style: { marginTop: '.2rem' } },
        el('div', {
          class: 'bar__fill',
          style: { width: (fraction * 100).toFixed(1) + '%' },
        }),
      ),
    ));
  }
  return list;
}

/**
 * Line chart over a date series.
 * @param {{date:string,count:number}[]} points already sorted ascending
 */
export function lineChart(points, { height = 140, label = 'Bowls over time' } = {}) {
  if (points.length === 0) return el('p', { class: 'muted small' }, 'No data yet.');
  if (points.length === 1) {
    return el('p', { class: 'muted small' },
      `Only one dated entry so far (${points[0].count} on ${points[0].date}).`);
  }

  const width = 600;
  const padX = 8;
  const padY = 10;
  const maxY = Math.max(...points.map((p) => p.count), 1);

  const stepX = (width - padX * 2) / (points.length - 1);
  const scaleY = (v) => height - padY - (v / maxY) * (height - padY * 2);

  const coords = points.map((p, i) => [padX + i * stepX, scaleY(p.count)]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${height - padY} `
    + `L${coords[0][0].toFixed(1)},${height - padY} Z`;

  const svg = frame(width, height);
  svg.setAttribute('aria-label', label);

  svg.append(svgEl('path', {
    d: area,
    fill: 'var(--accent)',
    'fill-opacity': '.14',
    stroke: 'none',
  }));
  svg.append(svgEl('path', {
    d: path,
    fill: 'none',
    stroke: 'var(--accent)',
    'stroke-width': '2',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  for (const [x, y] of coords) {
    svg.append(svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.5, fill: 'var(--accent)' }));
  }

  return el('div', {},
    svg,
    el('div', { class: 'spread small muted', style: { marginTop: '.25rem' } },
      el('span', {}, points[0].date),
      el('span', {}, `peak ${maxY}`),
      el('span', {}, points[points.length - 1].date),
    ),
  );
}

/** Donut showing a single completion fraction, used for combo coverage. */
export function donut(fraction, { size = 120, label = '' } = {}) {
  const f = Math.max(0, Math.min(1, fraction || 0));
  const r = 46;
  const c = 2 * Math.PI * r;
  const svg = frame(120, 120, { responsive: false });
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.width = size + 'px';
  svg.style.height = size + 'px';
  svg.setAttribute('aria-label', label || `${Math.round(f * 100)} percent`);

  svg.append(svgEl('circle', {
    cx: 60, cy: 60, r,
    fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': 12,
  }));
  svg.append(svgEl('circle', {
    cx: 60, cy: 60, r,
    fill: 'none', stroke: 'var(--accent)', 'stroke-width': 12,
    'stroke-linecap': 'round',
    'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`,
    transform: 'rotate(-90 60 60)',
  }));

  const text = svgEl('text', {
    x: 60, y: 60,
    'text-anchor': 'middle', 'dominant-baseline': 'central',
    fill: 'var(--text)', 'font-size': '22', 'font-weight': '700',
    'font-family': 'inherit',
  });
  text.textContent = Math.round(f * 100) + '%';
  svg.append(text);

  return svg;
}
