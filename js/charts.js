// Charts for the Reports tab, drawn as plain HTML/SVG.
// Follows the data-viz rules: colour follows the category (fixed slots, validated for colour-blindness),
// thin marks, 2px gaps between parts, hairline grid, a legend for 2+ series, values never by colour alone
// (every value is also in the list or the table view).
import { compactNumber, niceMax } from './calc.js';
import { esc } from './ui.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Tall segmented bar: one whole (this month's spending) split into its biggest categories.
 * The share is printed inside a part only when it fits; the legend lists names in the same order.
 */
export function segmentedBar(parts, money) {
  if (!parts.length) return '';
  const blocks = parts.map((p) => {
    const label = `${p.name}: ${money(p.total)} (${Math.round(p.share * 100)}%)`;
    const showShare = p.share >= 0.12; // only when "46%" fits with padding
    return `<span class="seg-part" style="flex-grow:${p.share.toFixed(4)}" data-slot="${p.slot}" title="${esc(label)}" aria-label="${esc(label)}" role="img">${showShare ? `<span class="seg-share">${Math.round(p.share * 100)}%</span>` : ''}</span>`;
  }).join('');
  const legend = parts.map((p) => `<li><span class="swatch" data-slot="${p.slot}"></span>${esc(p.name)}</li>`).join('');
  return `
    <div class="seg-bar" role="group" aria-label="Spending split by category">${blocks}</div>
    <ul class="legend">${legend}</ul>`;
}

/**
 * Six months of income vs expenses as paired columns (one shared axis — never two).
 * The selected month is highlighted; tapping a month selects it. A readout line under the chart
 * shows the hovered/focused/selected month's numbers, and a table view lists them all.
 */
export function cashFlowChart(months, selected, money) {
  const W = 340, H = 186, left = 38, right = 6, top = 12, plotBottom = 148;
  const plotW = W - left - right;
  const plotH = plotBottom - top;
  const max = niceMax(Math.max(1, ...months.flatMap((m) => [m.income, m.expense])));
  const y = (v) => plotBottom - (v / max) * plotH;
  const groupW = plotW / months.length;
  const barW = Math.min(14, (groupW - 10) / 2); // thin columns, capped well below 24px
  const gap = 2;

  // Column with a 4px rounded top and a square base on the baseline
  const column = (x, value, cls) => {
    if (value <= 0) return '';
    const h = Math.max(2, plotBottom - y(value));
    const r = Math.min(4, h, barW / 2);
    const yTop = plotBottom - h;
    return `<path class="${cls}" d="M${x},${plotBottom} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${plotBottom} Z"/>`;
  };

  const ticks = [0, max / 2, max];
  const grid = ticks.map((t) => `
    <line class="grid${t === 0 ? ' base' : ''}" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="axis" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${compactNumber(t)}</text>`).join('');

  const groups = months.map((m, i) => {
    const gx = left + i * groupW;
    const x0 = gx + (groupW - (barW * 2 + gap)) / 2;
    const isSelected = m.year === selected.year && m.month === selected.month;
    const label = `${MONTHS[m.month]} ${m.year}: income ${money(m.income)}, expenses ${money(m.expense)}, net ${money(m.net)}`;
    return `
      <g class="cf-group${isSelected ? ' selected' : ''}">
        ${isSelected ? `<rect class="cf-highlight" x="${gx + 2}" y="${top - 6}" width="${groupW - 4}" height="${plotBottom - top + 6}" rx="8"/>` : ''}
        ${column(x0, m.income, 'cf-income')}
        ${column(x0 + barW + gap, m.expense, 'cf-expense')}
        <text class="axis month${isSelected ? ' strong' : ''}" x="${gx + groupW / 2}" y="${plotBottom + 18}" text-anchor="middle">${MONTHS[m.month]}</text>
        <rect class="cf-hit" x="${gx}" y="0" width="${groupW}" height="${H}" tabindex="0" role="button"
          data-action="cf-month" data-year="${m.year}" data-month="${m.month}"
          data-income="${m.income}" data-expense="${m.expense}" data-net="${m.net}" aria-label="${esc(label)}"><title>${esc(label)}</title></rect>
      </g>`;
  }).join('');

  const sel = months.find((m) => m.year === selected.year && m.month === selected.month) || months[months.length - 1];
  return `
    <div class="cf">
      <ul class="legend">
        <li><span class="swatch cf-income-swatch"></span>Income</li>
        <li><span class="swatch cf-expense-swatch"></span>Expenses</li>
      </ul>
      <svg class="cf-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Income and expenses, last ${months.length} months">${grid}${groups}</svg>
      <p class="cf-readout" aria-live="polite">${readout(sel, money)}</p>
      <details class="table-view">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead>
          <tbody>${months.map((m) => `<tr><td>${MONTHS[m.month]} ${m.year}</td><td>${esc(money(m.income))}</td><td>${esc(money(m.expense))}</td><td class="${m.net < 0 ? 'neg' : ''}">${esc(money(m.net))}</td></tr>`).join('')}</tbody>
        </table>
      </details>
    </div>`;
}

export function readout(m, money) {
  return `<strong>${MONTHS[m.month]} ${m.year}</strong> · in ${esc(money(m.income))} · out ${esc(money(m.expense))} · net <span class="${m.net < 0 ? 'neg' : ''}">${esc(money(m.net))}</span>`;
}
