// "Filters" sheet for the Transactions screen: date range, wallets, categories and amount.
// The button at the bottom shows how many transactions match, updated as you pick.
import { EMPTY_FILTERS, RANGES, formatNumber } from './calc.js';
import { categoryIcon, esc, walletIcon } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : '';
};
const grouped = (n) => (n ? formatNumber(Number(n)) : '');

/**
 * @param {object} o
 * @param {object} o.filters     current filters (copied, not changed until "Show")
 * @param {Array}  o.wallets     [{name, type}]
 * @param {object} o.categories  {Expense: {...}, Income: {...}}
 * @param {Function} o.count     (filters) => number of matching transactions
 * @param {Function} o.onApply   (filters) => void
 */
export function openFilterSheet({ filters, wallets, categories, count, onApply }) {
  const f = { ...filters, wallets: [...filters.wallets], categories: [...filters.categories] };
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Filters"></div>';
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };

  const toggle = (list, value) => {
    const i = list.indexOf(value);
    if (i === -1) list.push(value); else list.splice(i, 1);
  };
  const chip = (label, act, value, active) =>
    `<button type="button" class="chip ${active ? 'active' : ''}" data-act="${act}" data-v="${esc(value)}" aria-pressed="${active}">${label}</button>`;

  const categoryNames = [
    ...Object.keys(categories?.Expense || {}),
    ...Object.keys(categories?.Income || {}).filter((c) => !(c in (categories?.Expense || {}))),
  ];

  function render() {
    const n = count(f);
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Filters</h2>
        <button type="button" class="link end" data-act="reset">Reset</button>
      </header>
      <div class="sheet-body">
        <p class="field-label">Date</p>
        <div class="chip-row wrap">${RANGES.map(([v, label]) => chip(label, 'range', v, f.range === v)).join('')}</div>
        ${f.range === 'custom' ? `
          <div class="two-col dates">
            <label class="field"><span class="field-label">From</span><input class="note-input" type="date" data-f="from" value="${esc(f.from)}"></label>
            <label class="field"><span class="field-label">To</span><input class="note-input" type="date" data-f="to" value="${esc(f.to)}"></label>
          </div>` : ''}

        <p class="field-label">Wallets</p>
        <div class="chip-row wrap">${wallets.map((w) => chip(`${walletIcon(w.type)} ${esc(w.name)}`, 'wallet', w.name, f.wallets.includes(w.name))).join('')}</div>

        <p class="field-label">Categories</p>
        <div class="chip-row wrap">${categoryNames.map((c) => chip(`${categoryIcon(c)} ${esc(c)}`, 'category', c, f.categories.includes(c))).join('')}</div>

        <p class="field-label">Amount</p>
        <div class="two-col">
          <input class="note-input" data-f="min" inputmode="numeric" placeholder="Min" value="${esc(grouped(f.min))}" aria-label="Minimum amount">
          <input class="note-input" data-f="max" inputmode="numeric" placeholder="Max" value="${esc(grouped(f.max))}" aria-label="Maximum amount">
        </div>
      </div>
      <div class="sheet-foot">
        <button type="button" class="btn-primary save" data-act="apply">${n ? `Show ${n} transaction${n === 1 ? '' : 's'}` : 'No matches'}</button>
      </div>`;
  }

  // Only the result count changes while typing, so the keyboard stays open
  const refreshCount = () => {
    const n = count(f);
    sheet.querySelector('[data-act="apply"]').textContent = n ? `Show ${n} transaction${n === 1 ? '' : 's'}` : 'No matches';
  };

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) { close(); return; }
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const { act, v } = el.dataset;
    if (act === 'cancel') { close(); return; }
    if (act === 'apply') { onApply(f); close(); return; }
    if (act === 'reset') Object.assign(f, { ...EMPTY_FILTERS, type: f.type, wallets: [], categories: [] });
    if (act === 'range') f.range = v;
    if (act === 'wallet') toggle(f.wallets, v);
    if (act === 'category') toggle(f.categories, v);
    const scroll = sheet.querySelector('.sheet-body').scrollTop;
    render();
    sheet.querySelector('.sheet-body').scrollTop = scroll;
  });

  backdrop.addEventListener('input', (event) => {
    const key = event.target.dataset.f;
    if (!key) return;
    if (key === 'min' || key === 'max') {
      f[key] = digits(event.target.value);
      event.target.value = grouped(f[key]);
    } else {
      f[key] = event.target.value;
    }
    refreshCount();
  });

  render();
}
