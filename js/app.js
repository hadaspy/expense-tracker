// Expense Tracker web app — reads and writes your Google Sheet through the Apps Script API.
// The API URL and key are stored only on this device (localStorage), never in these files.
import {
  EXPENSE, INCOME, TRANSFER,
  byCategory, cashFlow, categorySlots, dayLabel, formatMoney, groupWallets, inMonth, monthInsights,
  monthLabel, monthPlan, monthTotals, netWorth, prepareTransactions, spendingParts, timeAgo,
  walletBalances, walletFlow, walletIcon,
} from './calc.js';
import { openBudgetSheet } from './budgets.js';
import { cashFlowChart, readout, segmentedBar } from './charts.js';
import { demoData } from './demo.js';
import { openEntrySheet } from './entry.js';
import { ICONS, categoryIcon, esc } from './ui.js';

const APP_VERSION = '1.2.0';
const KEYS = { settings: 'expense-tracker.settings', cache: 'expense-tracker.cache' };
const REFRESH_AFTER_MS = 60 * 1000; // refresh when reopening the app after a minute
const TABS = ['home', 'transactions', 'budgets', 'reports'];
const TAB_TITLES = { home: 'Home', transactions: 'Transactions', budgets: 'Budgets', reports: 'Reports' };

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
  tab: 'home',
  view: null,                 // null | 'settings' | { wallet: name }
  month: { year: today.getFullYear(), month: today.getMonth() },
  filter: 'all',              // all | Expense | Income | Transfer
  search: '',
  expanded: new Set(),        // expanded categories in reports
  limit: 100,                 // transactions shown before "Show more"
  data: isDemo ? demoData() : cached?.data || null,
  fetchedAt: isDemo ? Date.now() : cached?.fetchedAt || null,
  loading: false,
  error: null,
};

const decimals = () => Number(settings.decimals) || 0;
const money = (value) => formatMoney(value, { currency: settings.currency || (isDemo ? 'Rp' : ''), decimals: decimals() });

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

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    // No custom headers: GET and text/plain POST don't need a CORS preflight (Apps Script can't answer one)
    const response = await fetch(url, { ...init, signal: controller.signal });
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
    if (error instanceof TypeError) throw new Error('Could not reach the server. Check your internet connection.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const apiGet = (action, url = settings.url, key = settings.key) =>
  request(`${url}?key=${encodeURIComponent(key)}&action=${action}`);

// A string body is sent as text/plain, which Apps Script reads from e.postData.contents
const apiPost = (body) =>
  request(settings.url, { method: 'POST', body: JSON.stringify({ ...body, key: settings.key }) });

async function refresh() {
  if (isDemo || state.loading || !settings.url || !settings.key) return;
  state.loading = true;
  state.error = null;
  renderHeader();
  try {
    const data = await apiGet('data');
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

// ---------- saving / deleting (used by the entry sheet and swipe-to-delete) ----------

/** Applies a change to the local copy right away, so the app updates without waiting for a reload. */
function applyLocal(change) {
  state.data = { ...state.data, transactions: change([...(state.data.transactions || [])]) };
  if (!isDemo) storage.set(KEYS.cache, { data: state.data, fetchedAt: state.fetchedAt });
  render();
}

async function saveTransaction(transaction, id = null) {
  if (id) {
    if (!isDemo) await apiPost({ action: 'update', id, transaction });
    applyLocal((list) => list.map((t) => (t.id === id ? { id, ...transaction } : t)));
    toast(`Updated #${id}`);
  } else {
    const newId = isDemo
      ? Math.max(0, ...(state.data.transactions || []).map((t) => t.id)) + 1
      : (await apiPost({ action: 'add', transaction })).id;
    applyLocal((list) => [...list, { id: newId, ...transaction }]);
    toast(`Saved #${newId}`);
  }
  refresh(); // sync in the background (e.g. entries added from Telegram meanwhile)
}

async function deleteTransaction(id) {
  if (!isDemo) await apiPost({ action: 'delete', id });
  applyLocal((list) => list.filter((t) => t.id !== id));
  toast(`Deleted #${id}`);
  refresh();
}

function openEntry(id = null) {
  if (!state.data) return;
  const tx = id ? (state.data.transactions || []).find((t) => t.id === id) : null;
  if (id && !tx) return;
  openEntrySheet({
    data: state.data,
    money,
    decimals: decimals(),
    tx,
    onSave: (transaction) => saveTransaction(transaction, tx ? tx.id : null),
    onDelete: tx ? (txId) => deleteTransaction(txId) : null,
  });
}

async function saveBudgets(budgets) {
  const saved = isDemo ? budgets : (await apiPost({ action: 'setBudgets', budgets })).budgets;
  state.data = { ...state.data, budgets: saved };
  if (!isDemo) storage.set(KEYS.cache, { data: state.data, fetchedAt: state.fetchedAt });
  render();
  toast('Budgets saved');
}

function openBudgets() {
  if (!state.data) return;
  const { txs } = computed();
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = Object.fromEntries(
    byCategory(inMonth(txs, last.getFullYear(), last.getMonth()), EXPENSE).map((c) => [c.category, c.total]),
  );
  openBudgetSheet({
    categories: Object.keys(state.data.categories?.Expense || {}),
    budgets: state.data.budgets || {},
    lastMonth,
    lastMonthLabel: Object.keys(lastMonth).length ? monthLabel(last.getFullYear(), last.getMonth()) : '',
    money,
    onSave: saveBudgets,
  });
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 2200);
  setTimeout(() => el.remove(), 2600);
}

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
  // Tap to edit; swipe left to reveal Delete
  return `
    <li class="swipe">
      <button class="swipe-delete" data-action="delete-tx" data-id="${tx.id}" tabindex="-1">${ICONS.trash}<span>Delete</span></button>
      <div class="tx" data-action="edit-tx" data-id="${tx.id}" role="button" tabindex="0">
        <span class="tx-icon ${tx.type.toLowerCase()}">${icon}</span>
        <span class="tx-main">
          <span class="tx-title">${esc(title)}</span>
          <span class="tx-detail">${esc(detail)}${tx.note ? ` · <em>${esc(tx.note)}</em>` : ''}</span>
        </span>
        <span class="tx-side">
          <span class="amount ${cls}">${sign}${esc(money(tx.amount))}</span>
          <span class="tx-time">#${tx.id} · ${time}</span>
        </span>
      </div>
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

const budgetClass = (fraction) => (fraction > 1 ? 'neg' : fraction >= 0.9 ? 'warn' : fraction >= 0.75 ? 'caution' : 'pos');

/** An amount that never breaks across lines ("Rp" stays with the number). */
const nb = (value) => `<span class="nowrap">${esc(money(value))}</span>`;

function budgetRow(b, daysLeft) {
  const cls = budgetClass(b.fraction);
  const left = b.limit - b.spent;
  const perDay = left > 0 && daysLeft > 0 ? ` · <span class="nowrap">${esc(money(left / daysLeft))}/day</span>` : '';
  return `
    <li class="budget">
      <span class="cat-line"><span>${categoryIcon(b.category)} ${esc(b.category)}</span><span class="${cls}">${Math.round(b.fraction * 100)}%</span></span>
      ${bar(b.fraction, cls)}
      <span class="muted">${nb(b.spent)} of ${nb(b.limit)} · ${left >= 0 ? `${nb(left)} left${perDay}` : `<span class="neg">${nb(-left)} over</span>`}</span>
    </li>`;
}

function monthNav() {
  const { year, month } = state.month;
  const now = new Date();
  const atCurrent = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth());
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Previous month">${ICONS.left}</button>
      <h2>${esc(monthLabel(year, month))}</h2>
      <button class="icon-btn" data-action="month" data-delta="1" aria-label="Next month" ${atCurrent ? 'disabled' : ''}>${ICONS.right}</button>
    </div>`;
}

/** The big "left to spend" card (Home and Budgets). */
function planCard(plan, { compact = false } = {}) {
  const over = plan.left < 0;
  const label = plan.mode === 'budget' ? 'Left to spend' : 'Left this month';
  const sub = plan.mode === 'budget'
    ? `of ${money(plan.total)} budgeted`
    : `income ${money(plan.income)} − spending ${money(plan.expense)}`;
  const perDay = over
    ? `<span class="neg">Over by ${esc(money(-plan.left))}</span>`
    : plan.daysLeft > 0 && plan.left > 0
      ? `≈ <strong>${esc(money(plan.perDay))}</strong> per day · ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} left`
      : '';
  return `
    <section class="hero card">
      <p class="hero-label">${label}</p>
      <p class="hero-value ${over ? 'neg' : ''}">${esc(money(plan.left))}</p>
      <p class="hero-sub">${esc(sub)}</p>
      ${plan.total > 0 || plan.used > 0 ? bar(plan.fraction, budgetClass(plan.fraction)) : ''}
      ${perDay ? `<p class="hero-perday">${perDay}</p>` : ''}
      ${compact ? '' : `
      <div class="hero-split">
        <div><span class="dot pos"></span>In<strong class="pos">${esc(money(plan.income))}</strong></div>
        <div><span class="dot neg"></span>Out<strong class="neg">${esc(money(plan.expense))}</strong></div>
      </div>`}
    </section>`;
}

// ---------- screens ----------

function renderHome() {
  const { txs, balances } = computed();
  const now = new Date();
  const plan = monthPlan(state.data.budgets, inMonth(txs, now.getFullYear(), now.getMonth()), now.getFullYear(), now.getMonth(), now);
  const groups = groupWallets(state.data.wallets || [], balances);
  const worth = netWorth(balances);

  const topBudgets = [...plan.budgets].sort((a, b) => b.fraction - a.fraction).slice(0, 3);
  const budgetsHtml = topBudgets.length
    ? `<section>
        <h2 class="section-title"><span>Budgets</span><button class="link" data-action="tab" data-tab="budgets">See all</button></h2>
        <ul class="card list padded">${topBudgets.map((b) => budgetRow(b, plan.daysLeft)).join('')}</ul>
      </section>`
    : `<p class="hint">💡 Set monthly budgets to see how much you can spend per day. <button class="link" data-action="edit-budgets">Set budgets</button></p>`;

  const walletGroups = groups.map((group) => `
    <h3 class="group-title"><span>${group.icon} ${esc(group.type)}</span>${group.wallets.length > 1 ? `<span class="${group.total < 0 ? 'neg' : ''}">${esc(money(group.total))}</span>` : ''}</h3>
    <ul class="card list">
      ${group.wallets.map((w) => `
        <li>
          <button class="row" data-action="wallet" data-name="${esc(w.name)}">
            <span class="row-label">${esc(w.name)}</span>
            <span class="row-value ${w.balance < 0 ? 'neg' : ''}">${esc(money(w.balance))}</span>
            <span class="row-chevron">${ICONS.chevron}</span>
          </button>
        </li>`).join('')}
    </ul>`).join('');

  return `
    ${planCard(plan)}
    ${budgetsHtml}
    <section>
      <h2 class="section-title"><span>Accounts</span></h2>
      <div class="card networth">
        <div><span class="muted">Net worth</span><strong class="${worth.net < 0 ? 'neg' : ''}">${esc(money(worth.net))}</strong></div>
        <div><span class="muted">Assets</span><strong>${esc(money(worth.assets))}</strong></div>
        <div><span class="muted">Debts</span><strong class="${worth.debts ? 'neg' : ''}">${esc(money(worth.debts))}</strong></div>
      </div>
      ${walletGroups || '<p class="empty">No wallets yet. Add them in the Wallets tab of your sheet.</p>'}
    </section>
    <section>
      <h2 class="section-title"><span>Recent</span><button class="link" data-action="tab" data-tab="transactions">See all</button></h2>
      ${txs.length ? txListByDay(txs, { limit: 5, showMore: false }) : '<p class="empty">No transactions yet. Tap <strong>+</strong> to add one.</p>'}
    </section>`;
}

function renderBudgets() {
  const { txs } = computed();
  const { year, month } = state.month;
  const plan = monthPlan(state.data.budgets, inMonth(txs, year, month), year, month, new Date());
  if (!plan.budgets.length) {
    return `
      ${monthNav()}
      <section class="card empty-card">
        <p class="empty-icon">🎯</p>
        <h2>No budgets yet</h2>
        <p class="muted">Set a monthly limit for the categories you want to watch. You'll see what's left to spend, a daily allowance, and warnings at 75% and 90%.</p>
        <button class="btn-primary" data-action="edit-budgets">Set budgets</button>
      </section>`;
  }
  const sorted = [...plan.budgets].sort((a, b) => b.fraction - a.fraction);
  return `
    ${monthNav()}
    ${planCard(plan, { compact: true })}
    <section>
      <h2 class="section-title"><span>By category</span><button class="link" data-action="edit-budgets">Edit</button></h2>
      <ul class="card list padded">${sorted.map((b) => budgetRow(b, plan.daysLeft)).join('')}</ul>
    </section>
    <p class="hint small">Budgets repeat every month. The Telegram bot uses the same limits.</p>`;
}

function renderReports() {
  const { txs } = computed();
  const { year, month } = state.month;
  const monthTxs = inMonth(txs, year, month);
  const totals = monthTotals(monthTxs);
  const insights = monthInsights(txs, year, month, new Date());
  const slots = categorySlots(Object.keys(state.data.categories?.Expense || {}));
  const parts = spendingParts(monthTxs, slots);
  const flow = cashFlow(txs, year, month, 6);

  // Ranked list: one neutral bar colour (they're all the same measure); the swatch carries identity
  const categoryList = (type) => byCategory(monthTxs, type).map((c) => {
    const open = state.expanded.has(`${type}:${c.category}`);
    const slot = type === EXPENSE ? slots.get(c.category) || 0 : null;
    return `
      <li>
        <button class="cat-row" data-action="toggle-cat" data-key="${esc(`${type}:${c.category}`)}" aria-expanded="${open}">
          <span class="cat-icon">${categoryIcon(c.category)}</span>
          <span class="cat-main">
            <span class="cat-line"><span>${slot !== null ? `<span class="swatch" data-slot="${slot}"></span>` : ''}${esc(c.category)}</span><span>${esc(money(c.total))}</span></span>
            ${bar(c.share, 'ink')}
          </span>
          <span class="cat-share">${Math.round(c.share * 100)}%</span>
        </button>
        ${open ? `<ul class="subs">${c.subs.map((s) => `<li><span>${esc(s.name)}</span><span>${esc(money(s.total))}</span></li>`).join('')}</ul>` : ''}
      </li>`;
  }).join('');

  const prevName = insights.previousMonth.toLocaleDateString('en-GB', { month: 'short' });
  const change = insights.expenseChange;
  const delta = change === null || !isFinite(change) ? '' : `
    <span class="delta ${change > 0 ? 'neg' : 'pos'}" title="${insights.comparedToDate ? `Compared with the same days of ${prevName}` : `Compared with ${prevName}`}">
      ${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% vs ${insights.comparedToDate ? `same days in ${prevName}` : prevName}
    </span>`;

  const biggest = insights.biggest;
  const tiles = insights.count ? `
    <section class="tiles">
      <div class="card tile"><span class="tile-label">Average per day</span><strong>${esc(money(insights.avgPerDay))}</strong></div>
      <div class="card tile"><span class="tile-label">Busiest day</span><strong>${insights.busiestDay ? esc(insights.busiestDay.name) : '—'}</strong>
        ${insights.busiestDay ? `<span class="tile-sub">${esc(money(insights.busiestDay.total))} spent</span>` : ''}</div>
      <div class="card tile"><span class="tile-label">Biggest expense</span><strong>${biggest ? esc(money(biggest.amount)) : '—'}</strong>
        ${biggest ? `<span class="tile-sub">${categoryIcon(biggest.category)} ${esc(biggest.note || biggest.subcategory || biggest.category)}</span>` : ''}</div>
      <div class="card tile"><span class="tile-label">Transactions</span><strong>${insights.count}</strong>
        ${totals.income > 0 ? `<span class="tile-sub">Saved ${Math.round(Math.max(0, totals.net) / totals.income * 100)}% of income</span>` : ''}</div>
    </section>` : '';

  const incomeList = categoryList(INCOME);
  const hasFlow = flow.some((m) => m.income || m.expense);
  return `
    ${monthNav()}
    <section class="stats">
      <div class="card stat"><span>Income</span><strong class="pos">${esc(money(totals.income))}</strong></div>
      <div class="card stat"><span>Expenses</span><strong class="neg">${esc(money(totals.expense))}</strong>${delta}</div>
      <div class="card stat net"><span>Net</span><strong class="${totals.net < 0 ? 'neg' : 'pos'}">${esc(money(totals.net))}</strong></div>
    </section>
    ${monthTxs.length ? '' : '<p class="empty">No transactions in this month.</p>'}
    ${parts.length ? `
      <section>
        <h2 class="section-title"><span>Where it went</span></h2>
        <div class="card chart-card">${segmentedBar(parts, money)}</div>
        <ul class="card list cats">${categoryList(EXPENSE)}</ul>
      </section>` : ''}
    ${tiles}
    ${hasFlow ? `
      <section>
        <h2 class="section-title"><span>Cash flow</span><span class="muted">tap a month</span></h2>
        <div class="card chart-card">${cashFlowChart(flow, state.month, money)}</div>
      </section>` : ''}
    ${incomeList ? `<section><h2 class="section-title"><span>Income by category</span></h2><ul class="card list cats">${incomeList}</ul></section>` : ''}`;
}

/** Shows a month's numbers under the cash-flow chart (on hover/focus); back to the selected month after. */
function showCashFlowReadout(hit) {
  const box = app.querySelector('.cf-readout');
  if (!box) return;
  const target = hit || app.querySelector('.cf-group.selected .cf-hit');
  if (!target) return;
  const d = target.dataset;
  box.innerHTML = readout({ year: +d.year, month: +d.month, income: +d.income, expense: +d.expense, net: +d.net }, money);
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
    <p class="hint small">Tap a transaction to edit it · swipe left to delete</p>
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
            <option value="0" ${decimals() === 2 ? '' : 'selected'}>0 (25,000)</option>
            <option value="2" ${decimals() === 2 ? 'selected' : ''}>2 (25.00)</option>
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
  return TAB_TITLES[state.tab];
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
    ${isDemo ? '<p class="banner">Sample data — changes aren\'t saved. <a href="./">Exit preview</a></p>' : ''}
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
  if (state.tab === 'transactions') return renderTransactions();
  if (state.tab === 'budgets') return renderBudgets();
  if (state.tab === 'reports') return renderReports();
  return renderHome();
}

function tabButton(tab) {
  const active = state.view === null && state.tab === tab;
  return `<button class="tab ${active ? 'active' : ''}" data-action="tab" data-tab="${tab}" ${active ? 'aria-current="page"' : ''}>${ICONS[tab]}<span>${TAB_TITLES[tab]}</span></button>`;
}

function render() {
  if (!isDemo && !(settings.url && settings.key)) {
    app.innerHTML = renderSetup();
    return;
  }
  app.innerHTML = `
    <header class="topbar">${headerHtml()}</header>
    <main class="content">${mainHtml()}</main>
    <nav class="tabbar">
      ${tabButton('home')}${tabButton('transactions')}
      <button class="tab-add" data-action="add" aria-label="Add transaction" ${state.data ? '' : 'disabled'}>${ICONS.plus}</button>
      ${tabButton('budgets')}${tabButton('reports')}
    </nav>`;
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

// ---------- swipe left on a transaction to reveal Delete ----------

const SWIPE_OPEN = -92;
let swipe = null;      // the row being dragged
let suppressClick = false;

function closeSwipes(except = null) {
  app.querySelectorAll('.swipe.open').forEach((row) => {
    if (row === except) return;
    row.classList.remove('open');
    row.querySelector('.tx').style.transform = '';
    setTimeout(() => row.classList.remove('swiping'), 200);
  });
}

app.addEventListener('pointerdown', (event) => {
  const tx = event.target.closest('.swipe .tx');
  if (!tx || event.pointerType === 'mouse' && event.button !== 0) return;
  const row = tx.parentElement;
  closeSwipes(row);
  swipe = { row, tx, startX: event.clientX, startY: event.clientY, base: row.classList.contains('open') ? SWIPE_OPEN : 0, dx: 0, active: false };
});

app.addEventListener('pointermove', (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // vertical scroll
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
    swipe.tx.classList.add('dragging');
    swipe.row.classList.add('swiping');
  }
  swipe.dx = dx;
  const offset = Math.max(SWIPE_OPEN - 20, Math.min(0, swipe.base + dx));
  swipe.tx.style.transform = `translateX(${offset}px)`;
});

function endSwipe() {
  if (!swipe) return;
  const { row, tx, base, dx, active } = swipe;
  swipe = null;
  if (!active) return;
  tx.classList.remove('dragging');
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  const open = base + dx < SWIPE_OPEN / 2;
  row.classList.toggle('open', open);
  tx.style.transform = open ? `translateX(${SWIPE_OPEN}px)` : '';
  if (!open) setTimeout(() => row.classList.remove('swiping'), 200); // after the slide-back animation
}
app.addEventListener('pointerup', endSwipe);
app.addEventListener('pointercancel', endSwipe);

// ---------- events ----------

app.addEventListener('click', async (event) => {
  if (suppressClick) { event.preventDefault(); return; }
  const target = event.target.closest('[data-action]');
  if (!target) { closeSwipes(); return; }
  const action = target.dataset.action;

  if (action === 'edit-tx') {
    const row = target.parentElement;
    if (row.classList.contains('open')) { closeSwipes(); return; } // first tap just closes the swipe
    openEntry(Number(target.dataset.id));
  } else if (action === 'delete-tx') {
    const id = Number(target.dataset.id);
    if (!confirm(`Delete transaction #${id}? This removes it from your sheet.`)) { closeSwipes(); return; }
    target.disabled = true;
    try {
      await deleteTransaction(id);
    } catch (error) {
      toast(`Couldn't delete: ${error.message}`);
      closeSwipes();
      target.disabled = false;
    }
  } else if (action === 'add') {
    openEntry();
  } else if (action === 'edit-budgets') {
    openBudgets();
  } else if (action === 'cf-month') {
    state.month = { year: Number(target.dataset.year), month: Number(target.dataset.month) };
    render();
  } else if (action === 'tab') {
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
      Object.assign(state, { data: null, fetchedAt: null, error: null, view: null, tab: 'home' });
      history.replaceState(null, '');
      render();
    }
  }
});

// Enter / Space on a focused transaction or chart month activates it (keyboard access)
app.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest?.('.tx[data-action="edit-tx"], .cf-hit');
  if (!target) return;
  event.preventDefault();
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

// Cash-flow chart: hovering or focusing a month shows its numbers under the chart
app.addEventListener('pointerover', (event) => {
  const hit = event.target.closest?.('.cf-hit');
  if (hit) showCashFlowReadout(hit);
});
app.addEventListener('focusin', (event) => {
  const hit = event.target.closest?.('.cf-hit');
  if (hit) showCashFlowReadout(hit);
});
app.addEventListener('pointerout', (event) => {
  if (event.target.closest?.('.cf-hit') && !event.relatedTarget?.closest?.('.cf-hit')) showCashFlowReadout(null);
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
    const result = await apiGet('ping', values.url, values.key);
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

// Optional starting point from the address, e.g. …/#reports or …/#add
const startHash = location.hash.slice(1);
const legacyTabs = { overview: 'home', summary: 'reports' };
const startTab = legacyTabs[startHash] || startHash;
if (TABS.includes(startTab)) state.tab = startTab;

history.replaceState({ view: null }, '');
render();
refresh();
if (startHash === 'add') openEntry();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
}
