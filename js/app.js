// Expense Tracker web app — reads your Google Sheet through the Apps Script API.
// The API URL and key are stored only on this device (localStorage), never in these files.
import {
  EXPENSE, INCOME, TRANSFER,
  budgetProgress, byCategory, dayLabel, daysInMonth, formatMoney, groupWallets, inMonth,
  monthLabel, monthTotals, prepareTransactions, timeAgo, walletBalances, walletFlow, walletIcon,
} from './calc.js';
import { demoData } from './demo.js';

const APP_VERSION = '1.0.0';
const KEYS = { settings: 'expense-tracker.settings', cache: 'expense-tracker.cache' };
const REFRESH_AFTER_MS = 60 * 1000; // refresh when reopening the app after a minute

// ---------- storage (wrapped: private mode or cleared data must not break the app) ----------

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
};

// ---------- state ----------

const isDemo = new URLSearchParams(location.search).has('demo');
let settings = storage.get(KEYS.settings) || {};
const cached = isDemo ? null : storage.get(KEYS.cache);
const today = new Date();

const state = {
  tab: 'overview',            // overview | summary | transactions
  view: null,                 // null | 'settings' | { wallet: name }
  month: { year: today.getFullYear(), month: today.getMonth() },
  filter: 'all',              // all | Expense | Income | Transfer
  search: '',
  expanded: new Set(),        // expanded categories in the summary
  limit: 100,                 // transactions shown before "Show more"
  data: isDemo ? demoData() : cached?.data || null,
  fetchedAt: isDemo ? Date.now() : cached?.fetchedAt || null,
  loading: false,
  error: null,
};

const CATEGORY_ICONS = {
  'food & drinks': '🍽️', transport: '🚗', shopping: '🛍️', 'bills & utilities': '🧾', housing: '🏠',
  health: '💊', entertainment: '🎬', education: '📚', travel: '✈️', 'gifts & donations': '🎁',
  salary: '💼', bonus: '🎉', business: '🏪', investment: '📈', gift: '🎁', other: '🏷️',
};
const categoryIcon = (name) => CATEGORY_ICONS[String(name).toLowerCase()] || '🏷️';

const money = (value) => formatMoney(value, {
  currency: settings.currency || (isDemo ? 'Rp' : ''),
  decimals: Number(settings.decimals) || 0,
});

/** Escapes text from the sheet before putting it into HTML. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let memo = null;
/** Transactions with parsed dates + wallet balances, recalculated only when the data changes. */
function computed() {
  if (memo?.source !== state.data) {
    const txs = prepareTransactions(state.data.transactions || []);
    memo = { source: state.data, txs, balances: walletBalances(state.data.wallets || [], txs) };
  }
  return memo;
}

// ---------- API ----------

async function callApi(url, key, action) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    // Plain GET without custom headers, so the browser doesn't need a CORS preflight
    const response = await fetch(`${url}?key=${encodeURIComponent(key)}&action=${action}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`The server answered with HTTP ${response.status}.`);
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error('Unexpected response. Check that the URL ends in /exec and the deployment allows "Anyone".');
    }
    if (!json.ok) throw new Error(json.error || 'Unknown error from the API.');
    return json;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The server took too long to respond. Try again.');
    if (error instanceof TypeError) throw new Error('Could not reach the server. Check your internet connection and the URL.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  if (isDemo || state.loading || !settings.url || !settings.key) return;
  state.loading = true;
  state.error = null;
  renderHeader();
  try {
    const data = await callApi(settings.url, settings.key, 'data');
    state.data = data;
    state.fetchedAt = Date.now();
    storage.set(KEYS.cache, { data, fetchedAt: state.fetchedAt });
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

// ---------- icons ----------

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  overview: svg('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 3h10"/><circle cx="16.5" cy="15" r="1.2"/>'),
  summary: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5 6.2"/>'),
  transactions: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
};

// ---------- shared pieces ----------

function amountClass(tx, perspective) {
  if (tx.type === EXPENSE) return 'neg';
  if (tx.type === INCOME) return 'pos';
  if (perspective) return tx.toWallet === perspective ? 'pos' : 'neg';
  return 'neutral';
}

function txRow(tx, perspective = null) {
  const cls = amountClass(tx, perspective);
  const sign = cls === 'neg' ? '-' : cls === 'pos' ? '+' : '';
  let icon, title, detail;
  if (tx.type === TRANSFER) {
    icon = '🔁';
    title = 'Transfer';
    detail = `${tx.wallet} → ${tx.toWallet}`;
  } else {
    icon = categoryIcon(tx.category);
    title = tx.subcategory || tx.category || 'Uncategorized';
    detail = (tx.subcategory ? `${tx.category} · ` : '') + tx.wallet;
  }
  const time = tx.when.toTimeString().slice(0, 5);
  return `
    <li class="tx">
      <span class="tx-icon ${tx.type.toLowerCase()}">${icon}</span>
      <span class="tx-main">
        <span class="tx-title">${esc(title)}</span>
        <span class="tx-detail">${esc(detail)}${tx.note ? ` · <em>${esc(tx.note)}</em>` : ''}</span>
      </span>
      <span class="tx-side">
        <span class="amount ${cls}">${sign}${esc(money(tx.amount))}</span>
        <span class="tx-time">#${tx.id} · ${time}</span>
      </span>
    </li>`;
}

function txListByDay(txs, { perspective = null, limit = state.limit, showMore = true } = {}) {
  if (!txs.length) return '<p class="empty">No transactions found.</p>';
  const now = new Date();
  let html = '';
  let currentDay = null;
  txs.slice(0, limit).forEach((tx) => {
    const label = dayLabel(tx.when, now);
    if (label !== currentDay) {
      if (currentDay !== null) html += '</ul>';
      html += `<h3 class="day">${esc(label)}</h3><ul class="card list">`;
      currentDay = label;
    }
    html += txRow(tx, perspective);
  });
  html += '</ul>';
  if (showMore && txs.length > limit) {
    html += `<button class="btn-secondary" data-action="more">Show more (${txs.length - limit} left)</button>`;
  }
  return html;
}

function bar(fraction, cls = '') {
  const width = Math.max(0, Math.min(100, fraction * 100));
  return `<span class="bar ${cls}"><span style="width:${width.toFixed(1)}%"></span></span>`;
}

// ---------- screens ----------

function renderOverview() {
  const { txs, balances } = computed();
  const groups = groupWallets(state.data.wallets || [], balances);
  const total = [...balances.values()].reduce((sum, v) => sum + v, 0);
  const now = new Date();
  const month = monthTotals(inMonth(txs, now.getFullYear(), now.getMonth()));

  const walletGroups = groups.map((group) => `
    <section>
      <h2 class="section-title">
        <span>${group.icon} ${esc(group.type)}</span>
        ${group.wallets.length > 1 ? `<span class="${group.total < 0 ? 'neg' : ''}">${esc(money(group.total))}</span>` : ''}
      </h2>
      <ul class="card list">
        ${group.wallets.map((w) => `
          <li>
            <button class="row" data-action="wallet" data-name="${esc(w.name)}">
              <span class="row-label">${esc(w.name)}</span>
              <span class="row-value ${w.balance < 0 ? 'neg' : ''}">${esc(money(w.balance))}</span>
              <span class="row-chevron">${ICONS.chevron}</span>
            </button>
          </li>`).join('')}
      </ul>
    </section>`).join('');

  return `
    <section class="hero card">
      <p class="hero-label">Total balance</p>
      <p class="hero-value ${total < 0 ? 'neg' : ''}">${esc(money(total))}</p>
      <div class="hero-split">
        <div><span class="dot pos"></span>In this month<strong class="pos">${esc(money(month.income))}</strong></div>
        <div><span class="dot neg"></span>Out this month<strong class="neg">${esc(money(month.expense))}</strong></div>
      </div>
    </section>
    ${walletGroups || '<p class="empty">No wallets yet. Add them in the Wallets tab of your sheet.</p>'}
    <section>
      <h2 class="section-title"><span>Recent</span><button class="link" data-action="tab" data-tab="transactions">See all</button></h2>
      ${txListByDay(txs, { limit: 5, showMore: false })}
    </section>`;
}

function renderSummary() {
  const { txs } = computed();
  const { year, month } = state.month;
  const monthTxs = inMonth(txs, year, month);
  const totals = monthTotals(monthTxs);
  const now = new Date();
  const isCurrent = year === now.getFullYear() && month === now.getMonth();
  const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
  const days = isCurrent ? now.getDate() : daysInMonth(year, month);

  const nav = `
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Previous month">${ICONS.left}</button>
      <h2>${esc(monthLabel(year, month))}</h2>
      <button class="icon-btn" data-action="month" data-delta="1" aria-label="Next month" ${isCurrent || isFuture ? 'disabled' : ''}>${ICONS.right}</button>
    </div>`;

  if (!monthTxs.length) return `${nav}<p class="empty">No transactions in this month.</p>`;

  const categoryList = (type, cls) => byCategory(monthTxs, type).map((c) => {
    const open = state.expanded.has(`${type}:${c.category}`);
    return `
      <li>
        <button class="cat-row" data-action="toggle-cat" data-key="${esc(`${type}:${c.category}`)}" aria-expanded="${open}">
          <span class="cat-icon">${categoryIcon(c.category)}</span>
          <span class="cat-main">
            <span class="cat-line"><span>${esc(c.category)}</span><span>${esc(money(c.total))}</span></span>
            ${bar(c.share, cls)}
          </span>
          <span class="cat-share">${Math.round(c.share * 100)}%</span>
        </button>
        ${open ? `<ul class="subs">${c.subs.map((s) => `<li><span>${esc(s.name)}</span><span>${esc(money(s.total))}</span></li>`).join('')}</ul>` : ''}
      </li>`;
  }).join('');

  const budgets = budgetProgress(state.data.budgets, monthTxs);
  const budgetHtml = budgets.length ? `
    <section>
      <h2 class="section-title"><span>Budgets</span></h2>
      <ul class="card list padded">
        ${budgets.map((b) => {
          const cls = b.fraction > 1 ? 'neg' : b.fraction >= 0.8 ? 'warn' : 'pos';
          const left = b.limit - b.spent;
          return `
            <li class="budget">
              <span class="cat-line"><span>${categoryIcon(b.category)} ${esc(b.category)}</span><span class="${cls}">${Math.round(b.fraction * 100)}%</span></span>
              ${bar(b.fraction, cls)}
              <span class="muted">${esc(money(b.spent))} of ${esc(money(b.limit))} · ${left >= 0 ? `${esc(money(left))} left` : `${esc(money(-left))} over`}</span>
            </li>`;
        }).join('')}
      </ul>
    </section>` : '';

  const incomeList = categoryList(INCOME, 'pos');
  return `
    ${nav}
    <section class="stats">
      <div class="card stat"><span>Income</span><strong class="pos">${esc(money(totals.income))}</strong></div>
      <div class="card stat"><span>Expenses</span><strong class="neg">${esc(money(totals.expense))}</strong></div>
      <div class="card stat net"><span>Net</span><strong class="${totals.net < 0 ? 'neg' : 'pos'}">${esc(money(totals.net))}</strong></div>
    </section>
    <p class="muted center">
      ${totals.income > 0 ? `Saved ${Math.round(Math.max(0, totals.net) / totals.income * 100)}% of income · ` : ''}
      Avg ${esc(money(totals.expense / days))} per day
    </p>
    ${totals.expense ? `<section><h2 class="section-title"><span>Spending by category</span></h2><ul class="card list cats">${categoryList(EXPENSE, 'neg')}</ul></section>` : ''}
    ${budgetHtml}
    ${incomeList ? `<section><h2 class="section-title"><span>Income by category</span></h2><ul class="card list cats">${incomeList}</ul></section>` : ''}`;
}

function filteredTransactions() {
  const { txs } = computed();
  const query = state.search.trim().toLowerCase();
  return txs.filter((tx) => {
    if (state.filter !== 'all' && tx.type !== state.filter) return false;
    if (!query) return true;
    return [tx.category, tx.subcategory, tx.note, tx.wallet, tx.toWallet, tx.type, String(tx.amount), `#${tx.id}`]
      .some((field) => String(field || '').toLowerCase().includes(query));
  });
}

function renderTransactions() {
  const chips = [['all', 'All'], [EXPENSE, 'Expenses'], [INCOME, 'Income'], [TRANSFER, 'Transfers']]
    .map(([value, label]) => `<button class="chip ${state.filter === value ? 'active' : ''}" data-action="filter" data-filter="${value}">${label}</button>`)
    .join('');
  return `
    <div class="search">
      <input id="search" type="search" placeholder="Search notes, categories, wallets…" value="${esc(state.search)}" autocomplete="off">
    </div>
    <div class="chips">${chips}</div>
    <div id="tx-list">${txListByDay(filteredTransactions())}</div>`;
}

function renderWallet(name) {
  const { txs, balances } = computed();
  const wallet = (state.data.wallets || []).find((w) => w.name === name);
  const type = wallet?.type || 'Other';
  const mine = txs.filter((tx) => tx.wallet === name || tx.toWallet === name);
  const now = new Date();
  const flow = walletFlow(name, inMonth(mine, now.getFullYear(), now.getMonth()));
  const balance = balances.get(name) || 0;
  return `
    <section class="hero card">
      <p class="hero-label">${walletIcon(type)} ${esc(type)}</p>
      <p class="hero-value ${balance < 0 ? 'neg' : ''}">${esc(money(balance))}</p>
      <div class="hero-split">
        <div><span class="dot pos"></span>In this month<strong class="pos">${esc(money(flow.moneyIn))}</strong></div>
        <div><span class="dot neg"></span>Out this month<strong class="neg">${esc(money(flow.moneyOut))}</strong></div>
      </div>
      ${wallet ? `<p class="muted small">Opening balance ${esc(money(wallet.openingBalance))}</p>` : ''}
    </section>
    <section>
      <h2 class="section-title"><span>Transactions</span><span class="muted">${mine.length}</span></h2>
      ${txListByDay(mine, { perspective: name })}
    </section>`;
}

function settingsForm({ firstRun }) {
  return `
    <form id="settings-form" class="form" autocomplete="off">
      <label>Apps Script URL
        <input name="url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" value="${esc(settings.url || '')}">
      </label>
      <label>API key
        <span class="with-button">
          <input name="key" type="password" required placeholder="64-character key from setup()" value="${esc(settings.key || '')}">
          <button type="button" class="link" data-action="toggle-key">Show</button>
        </span>
      </label>
      <div class="two-col">
        <label>Currency symbol
          <input name="currency" placeholder="e.g. Rp, $, €" maxlength="5" value="${esc(settings.currency || '')}">
        </label>
        <label>Decimals
          <select name="decimals">
            <option value="0" ${Number(settings.decimals) === 2 ? '' : 'selected'}>0 (25,000)</option>
            <option value="2" ${Number(settings.decimals) === 2 ? 'selected' : ''}>2 (25.00)</option>
          </select>
        </label>
      </div>
      <p id="form-status" class="form-status" role="status"></p>
      <button type="submit" class="btn-primary">${firstRun ? 'Connect' : 'Save & test connection'}</button>
    </form>`;
}

function renderSettings() {
  return `
    ${settingsForm({ firstRun: false })}
    <section>
      <h2 class="section-title"><span>About</span></h2>
      <ul class="card list padded">
        <li class="kv"><span>Spreadsheet</span><span>${esc(state.data?.sheet || '—')}</span></li>
        <li class="kv"><span>Last updated</span><span>${state.fetchedAt ? esc(new Date(state.fetchedAt).toLocaleString('en-GB')) : '—'}</span></li>
        <li class="kv"><span>Transactions</span><span>${state.data?.transactions?.length ?? '—'}</span></li>
        <li class="kv"><span>App version</span><span>${APP_VERSION}</span></li>
      </ul>
    </section>
    <button class="btn-danger" data-action="forget">Remove URL, key & saved data from this device</button>`;
}

function renderSetup() {
  return `
    <main class="setup">
      <div class="setup-logo"><img src="icons/icon-192.png" alt="" width="72" height="72"></div>
      <h1>Expense Tracker</h1>
      <p class="muted">Connect to your Google Sheet using the Apps Script URL and API key. They're saved on this device only.</p>
      ${settingsForm({ firstRun: true })}
      <a class="btn-secondary" href="?demo">Preview with sample data</a>
    </main>`;
}

// ---------- layout ----------

const app = document.getElementById('app');

function titleText() {
  if (state.view === 'settings') return 'Settings';
  if (state.view?.wallet) return state.view.wallet;
  return { overview: 'Overview', summary: 'Summary', transactions: 'Transactions' }[state.tab];
}

function statusText() {
  if (isDemo) return 'Sample data';
  if (state.loading) return 'Updating…';
  if (state.fetchedAt) return `Updated ${timeAgo(state.fetchedAt)}`;
  return '';
}

function headerHtml() {
  const inner = state.view !== null;
  return `
    <div class="topbar-row">
      ${inner ? `<button class="icon-btn back" data-action="back" aria-label="Back">${ICONS.back}</button>` : ''}
      <div class="titles">
        <h1>${esc(titleText())}</h1>
        <p class="status">${esc(statusText())}</p>
      </div>
      ${!isDemo ? `<button class="icon-btn ${state.loading ? 'spin' : ''}" data-action="refresh" aria-label="Refresh" ${state.loading ? 'disabled' : ''}>${ICONS.refresh}</button>` : ''}
      ${!inner && !isDemo ? `<button class="icon-btn" data-action="settings" aria-label="Settings">${ICONS.settings}</button>` : ''}
    </div>
    ${isDemo ? '<p class="banner">You\'re looking at sample data. <a href="./">Exit preview</a></p>' : ''}
    ${state.error ? `<p class="banner error">Couldn't update: ${esc(state.error)}${state.data ? ' Showing saved data.' : ''}</p>` : ''}`;
}

function renderHeader() {
  const header = document.querySelector('.topbar');
  if (header) header.innerHTML = headerHtml();
}

function mainHtml() {
  if (state.view === 'settings') return renderSettings();
  if (!state.data) {
    return state.loading || !state.error
      ? '<p class="empty">Loading your data…</p>'
      : '<p class="empty">Couldn\'t load your data yet. Check Settings, then tap refresh.</p>';
  }
  if (state.view?.wallet) return renderWallet(state.view.wallet);
  if (state.tab === 'summary') return renderSummary();
  if (state.tab === 'transactions') return renderTransactions();
  return renderOverview();
}

function render() {
  if (!isDemo && !(settings.url && settings.key)) {
    app.innerHTML = renderSetup();
    return;
  }
  const tabs = ['overview', 'summary', 'transactions'].map((tab) => `
    <button class="tab ${state.view === null && state.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}">
      ${ICONS[tab]}<span>${tab[0].toUpperCase() + tab.slice(1)}</span>
    </button>`).join('');
  app.innerHTML = `
    <header class="topbar">${headerHtml()}</header>
    <main class="content">${mainHtml()}</main>
    <nav class="tabbar">${tabs}</nav>`;
}

// ---------- navigation (uses browser history so the back gesture works) ----------

function openView(view) {
  state.view = view;
  history.pushState({ view }, '');
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', (event) => {
  state.view = event.state?.view ?? null;
  render();
});

// ---------- events ----------

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'tab') {
    if (state.view !== null) history.back();
    state.view = null;
    state.tab = target.dataset.tab;
    state.limit = 100;
    render();
    window.scrollTo(0, 0);
  } else if (action === 'wallet') {
    openView({ wallet: target.dataset.name });
  } else if (action === 'settings') {
    openView('settings');
  } else if (action === 'back') {
    history.back();
  } else if (action === 'refresh') {
    refresh();
  } else if (action === 'month') {
    const date = new Date(state.month.year, state.month.month + Number(target.dataset.delta), 1);
    state.month = { year: date.getFullYear(), month: date.getMonth() };
    render();
  } else if (action === 'toggle-cat') {
    const key = target.dataset.key;
    state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
    render();
  } else if (action === 'filter') {
    state.filter = target.dataset.filter;
    state.limit = 100;
    render();
  } else if (action === 'more') {
    state.limit += 100;
    render();
  } else if (action === 'toggle-key') {
    const input = app.querySelector('input[name="key"]');
    input.type = input.type === 'password' ? 'text' : 'password';
    target.textContent = input.type === 'password' ? 'Show' : 'Hide';
  } else if (action === 'forget') {
    if (confirm('Remove the API URL, key and saved data from this device? Your Google Sheet is not affected.')) {
      storage.remove(KEYS.settings);
      storage.remove(KEYS.cache);
      settings = {};
      Object.assign(state, { data: null, fetchedAt: null, error: null, view: null, tab: 'overview' });
      history.replaceState(null, '');
      render();
    }
  }
});

// Typing in the search box only redraws the list, so the keyboard stays open
app.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  state.search = event.target.value;
  state.limit = 100;
  document.getElementById('tx-list').innerHTML = txListByDay(filteredTransactions());
});

app.addEventListener('submit', async (event) => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  const form = event.target;
  const status = form.querySelector('#form-status');
  const button = form.querySelector('button[type="submit"]');
  const values = {
    url: form.url.value.trim(),
    key: form.key.value.trim(),
    currency: form.currency.value.trim(),
    decimals: Number(form.decimals.value),
  };
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(values.url)) {
    status.className = 'form-status error';
    status.textContent = 'The URL should start with https://script.google.com/ and end with /exec.';
    return;
  }
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Testing connection…';
  try {
    const result = await callApi(values.url, values.key, 'ping');
    const sourceChanged = values.url !== settings.url || values.key !== settings.key;
    settings = values;
    storage.set(KEYS.settings, settings);
    if (sourceChanged) {
      storage.remove(KEYS.cache);
      state.data = null;
      state.fetchedAt = null;
    }
    status.textContent = `Connected to “${result.sheet}”.`;
    if (state.view === 'settings') history.back();
    state.view = null;
    render();
    refresh();
  } catch (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// Refresh when coming back to the app after a while
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!state.fetchedAt || Date.now() - state.fetchedAt > REFRESH_AFTER_MS)) {
    refresh();
  }
});

// Keep "Updated x min ago" current
setInterval(() => { if (!state.loading) renderHeader(); }, 30000);

// ---------- start ----------

// Optional starting tab from the address, e.g. …/#summary
const startTab = location.hash.slice(1);
if (['overview', 'summary', 'transactions'].includes(startTab)) state.tab = startTab;

history.replaceState({ view: null }, '');
render();
refresh();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
}
