// The add/edit sheet: Expense · Income · Transfer switch, amount keypad, category grid,
// wallet chips, Today / Yesterday / pick-a-date, note. Combines Spendee's "+" flow with
// MoneyCoach's amount-first quick entry. Opens over the app; the app is not re-rendered meanwhile.
import { EXPENSE, INCOME, TRANSFER, formatDateTime } from './calc.js';
import { ICONS, categoryIcon, esc, icon, walletIcon } from './ui.js';

const LAST_KEY = 'expense-tracker.last-wallets';
const MAX_DIGITS = 12;

function loadLast() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; }
}
function saveLast(value) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Opens the sheet.
 * @param {object} options
 * @param {object} options.data       API data (wallets, categories)
 * @param {Function} options.money    number → formatted string
 * @param {number} options.decimals   0 or 2
 * @param {object} [options.tx]       existing transaction → edit mode
 * @param {Function} options.onSave   async (transaction) => void; throw to show an error
 * @param {Function} [options.onDelete] async (id) => void
 * @param {object} [options.recurring] {frequency} → the same form becomes "New recurring": the date is the first/next
 *                                     one (it may be in the future), a Repeat row is added, and the saved object also
 *                                     carries `frequency` and `nextDate`.
 */
export function openEntrySheet({ data, money, decimals = 0, tx = null, onSave, onDelete, recurring = null }) {
  const last = loadLast();
  const wallets = (data.wallets || []).map((w) => w.name);
  const walletTypes = Object.fromEntries((data.wallets || []).map((w) => [w.name, w.type]));
  const now = new Date();
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const tomorrow = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  let frequency = recurring?.frequency || 'monthly';
  const categoriesFor = (type) => (data.categories && data.categories[type]) || {};

  const state = tx
    ? {
        type: tx.type,
        amount: decimals ? String(tx.amount) : String(Math.round(tx.amount)),
        category: tx.category || '',
        subcategory: tx.subcategory || '',
        wallet: tx.wallet,
        toWallet: tx.toWallet || '',
        day: tx.date.slice(0, 10),
        note: tx.note || '',
      }
    : {
        type: EXPENSE, amount: '', category: '', subcategory: '',
        wallet: wallets.includes(last[EXPENSE]) ? last[EXPENSE] : wallets[0] || '',
        toWallet: '', day: recurring ? tomorrow : today, note: '',
      };
  let busy = false;
  let error = '';

  // ---------- DOM ----------
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Transaction"></div>';
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const amountValue = () => parseFloat(state.amount) || 0;

  function setType(type) {
    if (type === state.type) return;
    state.type = type;
    error = '';
    if (type === TRANSFER) {
      state.category = '';
      state.subcategory = '';
      state.wallet = wallets.includes(last.transferFrom) ? last.transferFrom : state.wallet || wallets[0] || '';
      const to = wallets.includes(last.transferTo) && last.transferTo !== state.wallet ? last.transferTo : '';
      state.toWallet = to || wallets.find((w) => w !== state.wallet) || '';
    } else {
      if (!categoriesFor(type)[state.category]) {
        state.category = '';
        state.subcategory = '';
      }
      if (wallets.includes(last[type])) state.wallet = last[type];
    }
    render();
  }

  function pressKey(key) {
    let value = state.amount;
    if (key === 'back') value = value.slice(0, -1);
    else if (key === '.') {
      if (decimals && !value.includes('.')) value = (value || '0') + '.';
    } else if (key === '000') {
      if (value && value !== '0' && !value.includes('.')) value += '000';
    } else if (/^\d$/.test(key)) {
      if (value.includes('.') && value.split('.')[1].length >= decimals) return;
      value = value === '0' ? key : value + key;
    }
    if (value.replace('.', '').length > MAX_DIGITS) return;
    state.amount = value;
    error = '';
    renderAmount();
  }

  // ---------- rendering ----------

  function chip(label, act, value, active, extra = '') {
    return `<button type="button" class="chip ${active ? 'active' : ''}" data-act="${act}" data-v="${esc(value)}" ${extra}>${label}</button>`;
  }

  function walletChips(field, exclude = null) {
    return `<div class="chip-row">${wallets
      .filter((w) => w !== exclude)
      .map((w) => chip(`${walletIcon(walletTypes[w])} ${esc(w)}`, field, w, state[field] === w))
      .join('')}</div>`;
  }

  function categorySection() {
    const categories = categoriesFor(state.type);
    const names = Object.keys(categories);
    if (!names.length) return `<p class="muted small">No ${state.type.toLowerCase()} categories yet. Add them in the Categories tab of your sheet.</p>`;
    const grid = names.map((name) => `
      <button type="button" class="cat-tile ${state.category === name ? 'active' : ''}" data-act="category" data-v="${esc(name)}">
        <span class="cat-tile-icon">${categoryIcon(name)}</span>
        <span class="cat-tile-name">${esc(name)}</span>
      </button>`).join('');
    const subs = state.category ? categories[state.category] || [] : [];
    const subRow = subs.length ? `
      <p class="field-label">Subcategory</p>
      <div class="chip-row">${chip('None', 'subcategory', '', !state.subcategory)}${subs.map((s) => chip(esc(s), 'subcategory', s, state.subcategory === s)).join('')}</div>` : '';
    return `<p class="field-label">Category</p><div class="cat-grid">${grid}</div>${subRow}`;
  }

  function dateSection() {
    if (recurring) {
      const label = new Date(`${state.day}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const custom = state.day !== today && state.day !== tomorrow;
      return `
        <p class="field-label">Repeat</p>
        <div class="chip-row">${[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]
          .map(([v, name]) => chip(name, 'frequency', v, frequency === v)).join('')}</div>
        <p class="field-label">${tx ? 'Next date' : 'First date'}</p>
        <div class="chip-row">
          ${chip('Today', 'day', today, state.day === today)}
          ${chip('Tomorrow', 'day', tomorrow, state.day === tomorrow)}
          <label class="chip date-chip ${custom ? 'active' : ''}">${icon('calendar-blank')} ${esc(custom ? label : 'Pick date')}
            <input type="date" data-field="day" value="${esc(state.day)}" aria-label="Pick a date">
          </label>
        </div>
        <p class="muted small field-help">A date in the past or today is added to your transactions right away; later ones are added on the day. ${frequency === 'monthly' || frequency === 'yearly' ? 'Short months use their last day.' : ''}</p>`;
    }
    const custom = state.day !== today && state.day !== yesterday;
    const customLabel = custom
      ? new Date(`${state.day}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Pick date';
    return `
      <p class="field-label">Date</p>
      <div class="chip-row">
        ${chip('Today', 'day', today, state.day === today)}
        ${chip('Yesterday', 'day', yesterday, state.day === yesterday)}
        <label class="chip date-chip ${custom ? 'active' : ''}">${icon('calendar-blank')} ${esc(customLabel)}
          <input type="date" data-field="day" max="${today}" value="${esc(state.day)}" aria-label="Pick a date">
        </label>
      </div>`;
  }

  function renderAmount() {
    const display = sheet.querySelector('.amount-display');
    if (!display) return;
    display.textContent = money(amountValue());
    display.classList.toggle('empty', !state.amount);
  }

  function render() {
    const isTransfer = state.type === TRANSFER;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '000', '0', 'back'];
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>${recurring ? (tx ? 'Edit recurring' : 'New recurring') : tx ? `Edit #${tx.id}` : 'New entry'}</h2>
        <span class="sheet-head-spacer"></span>
      </header>
      <div class="segmented" role="tablist">
        ${[EXPENSE, INCOME, TRANSFER].map((t) => `<button type="button" role="tab" aria-selected="${state.type === t}" class="seg ${t.toLowerCase()} ${state.type === t ? 'active' : ''}" data-act="type" data-v="${t}">${t}</button>`).join('')}
      </div>
      <div class="amount-display ${state.type.toLowerCase()} ${state.amount ? '' : 'empty'}" aria-live="polite">${esc(money(amountValue()))}</div>
      <div class="sheet-body">
        ${isTransfer
          ? `<p class="field-label">From</p>${walletChips('wallet')}<p class="field-label">To</p>${walletChips('toWallet', state.wallet)}`
          : `${categorySection()}<p class="field-label">${state.type === EXPENSE ? 'Paid from' : 'Received into'}</p>${walletChips('wallet')}`}
        ${dateSection()}
        <p class="field-label">Note</p>
        <input class="note-input" data-field="note" placeholder="Optional" maxlength="200" value="${esc(state.note)}" enterkeyhint="done">
        ${tx && onDelete ? `<button type="button" class="btn-danger" data-act="delete">${ICONS.trash} ${recurring ? 'Delete recurring item' : 'Delete transaction'}</button>` : ''}
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <div class="keypad">${keys.map((k) => `<button type="button" data-act="key" data-v="${k}" aria-label="${k === 'back' ? 'Delete digit' : k === '.' ? 'Decimal comma' : k}">${k === 'back' ? ICONS.backspace : k === '.' ? ',' : k}</button>`).join('')}</div>
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : tx ? 'Save changes' : 'Save'}</button>
      </div>`;
  }

  // ---------- actions ----------

  function validate() {
    if (amountValue() <= 0) return 'Enter an amount.';
    if (!state.wallet) return 'Pick a wallet.';
    if (state.type === TRANSFER) {
      if (!state.toWallet) return 'Pick where the money goes.';
      if (state.toWallet === state.wallet) return 'Pick two different wallets.';
    } else if (Object.keys(categoriesFor(state.type)).length && !state.category) {
      return 'Pick a category.';
    }
    return '';
  }

  function dateText() {
    if (tx && state.day === tx.date.slice(0, 10)) return tx.date; // unchanged day: keep original time
    if (state.day === today) return formatDateTime(new Date());
    return `${state.day} 12:00`; // earlier day: noon, same as the Telegram bot
  }

  async function save() {
    error = validate();
    if (error) { render(); return; }
    busy = true;
    render();
    const transaction = {
      type: state.type,
      amount: Math.round(amountValue() * 10 ** decimals) / 10 ** decimals,
      wallet: state.wallet,
      toWallet: state.type === TRANSFER ? state.toWallet : '',
      category: state.type === TRANSFER ? '' : state.category,
      subcategory: state.type === TRANSFER ? '' : state.subcategory,
      note: state.note.trim(),
      date: dateText(),
    };
    if (recurring) Object.assign(transaction, { frequency, nextDate: state.day });
    try {
      await onSave(transaction);
      if (state.type === TRANSFER) Object.assign(last, { transferFrom: state.wallet, transferTo: state.toWallet });
      else last[state.type] = state.wallet;
      saveLast(last);
      close();
    } catch (e) {
      busy = false;
      error = e.message || 'Could not save.';
      render();
    }
  }

  async function remove() {
    if (!confirm(recurring ? 'Delete this recurring item? Transactions it already added stay.' : `Delete transaction #${tx.id}? This removes it from your sheet.`)) return;
    busy = true;
    render();
    try {
      await onDelete(tx.id);
      close();
    } catch (e) {
      busy = false;
      error = e.message || 'Could not delete.';
      render();
    }
  }

  function close() {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKeydown);
    setTimeout(() => backdrop.remove(), 250);
  }

  // ---------- events ----------

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const target = event.target.closest('[data-act]');
    if (!target || busy) return;
    const { act, v } = target.dataset;
    if (act === 'cancel') close();
    else if (act === 'type') setType(v);
    else if (act === 'key') pressKey(v);
    else if (act === 'save') save();
    else if (act === 'delete') remove();
    else if (act === 'category') {
      state.category = v;
      state.subcategory = '';
      error = '';
      render();
    } else if (act === 'subcategory') { state.subcategory = v; render(); }
    else if (act === 'wallet') {
      state.wallet = v;
      if (state.toWallet === v) state.toWallet = wallets.find((w) => w !== v) || '';
      error = '';
      render();
    } else if (act === 'toWallet') { state.toWallet = v; error = ''; render(); }
    else if (act === 'day') { state.day = v; render(); }
    else if (act === 'frequency') { frequency = v; render(); }
  });

  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.field === 'note') state.note = event.target.value;
  });
  backdrop.addEventListener('change', (event) => {
    if (event.target.dataset.field === 'day') {
      const value = event.target.value;
      state.day = value && (recurring || value <= today) ? value : today;
      render();
    }
  });

  // Typing on a hardware keyboard also works (except while writing the note)
  function onKeydown(event) {
    if (event.key === 'Escape' && !busy) { close(); return; }
    if (event.target.matches('input')) {
      if (event.key === 'Enter') event.target.blur();
      return;
    }
    if (/^\d$/.test(event.key)) pressKey(event.key);
    else if (event.key === 'Backspace') pressKey('back');
    else if (event.key === '.' || event.key === ',') pressKey('.');
    else if (event.key === 'Enter') save();
  }
  document.addEventListener('keydown', onKeydown);

  render();
}
