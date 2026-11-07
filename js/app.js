// Expense Tracker web app — reads and writes your Google Sheet through the Apps Script API.
// The API URL and key are stored only on this device (localStorage), never in these files.
import {
  EMPTY_FILTERS, EXPENSE, INCOME, RANGES, TRANSFER,
  activeFilterCount, byCategory, cashFlow, categorySlots, dayLabel, filterTransactions, formatMoney,
  goalProgress, groupWallets, inMonth, monthInsights, monthLabel, monthPlan, monthTotals, netWorth,
  prepareTransactions, rangeBounds, spendingParts, summarize, timeAgo, toCsv, walletBalances, walletFlow, walletIcon,
} from './calc.js';
import { openBalanceSheet } from './balance.js';
import { openBudgetSheet } from './budgets.js';
import { cashFlowChart, readout, segmentedBar } from './charts.js';
import { demoData } from './demo.js';
import { openEntrySheet } from './entry.js';
import { openFilterSheet } from './filters.js';
import { openAddMoneySheet, openGoalSheet } from './goals.js';
import { ICONS, categoryIcon, esc, highlight, reducedMotion } from './ui.js';

const APP_VERSION = '2.0.0';
const KEYS = { settings: 'expense-tracker.settings', cache: 'expense-tracker.cache' };
const REFRESH_AFTER_MS = 60 * 1000; // refresh when reopening the app after a minute
const TABS = ['home', 'transactions', 'budgets', 'reports'];
const TAB_TITLES = { home: 'Home', transactions: 'Transactions', budgets: 'Plan', reports: 'Reports' };

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
const freshFilters = () => ({ ...EMPTY_FILTERS, wallets: [], categories: [] });

const state = {
  tab: 'home',
  plan: 'budgets',            // Plan tab: 'budgets' | 'goals'
  view: null,                 // null | 'settings' | { wallet: name }
  month: { year: today.getFullYear(), month: today.getMonth() },
  filters: freshFilters(),    // Transactions: type chips + the Filters sheet
  search: '',
  expanded: new Set(),        // expanded categories in reports
  limit: 100,                 // transactions shown before "Show more"
  data: isDemo ? demoData() : cached?.data || null,
  fetchedAt: isDemo ? Date.now() : cached?.fetchedAt || null,
  loading: false,
  error: null,
  animate: true,              // play the entrance animation on the next render (navigation only)
};

const decimals = () => Number(settings.decimals) || 0;
const currency = () => settings.currency || (isDemo ? 'Rp' : '');
const money = (value) => formatMoney(value, { currency: currency(), decimals: decimals() });

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

// ---------- saving / deleting ----------

/** Applies a change to the local copy right away, so the app updates without waiting for a reload. */
function setData(patch) {
  state.data = { ...state.data, ...patch };
  if (!isDemo) storage.set(KEYS.cache, { data: state.data, fetchedAt: state.fetchedAt });
  render();
}
const applyLocal = (change) => setData({ transactions: change([...(state.data.transactions || [])]) });

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
  setData({ budgets: saved });
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

// Goals: only these fields go to the sheet (progress numbers are calculated, not stored)
const goalFields = (g) => ({ name: g.name, target: g.target, wallet: g.wallet || '', saved: g.wallet ? 0 : g.saved || 0, targetDate: g.targetDate || '' });

async function saveGoal(goal, original) {
  const clean = goalFields(goal);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if ((state.data.goals || []).some((g) => same(g.name, clean.name) && !(original && same(g.name, original)))) {
    throw new Error(`A goal called “${clean.name}” already exists.`);
  }
  let goals;
  if (isDemo) {
    goals = [...(state.data.goals || [])];
    const at = goals.findIndex((g) => g.name === (original || clean.name));
    if (at === -1) goals.push(clean); else goals[at] = clean;
  } else {
    goals = (await apiPost({ action: 'setGoal', goal: clean, original })).goals;
  }
  setData({ goals });
  toast(original ? 'Goal updated' : 'Goal created');
}

async function deleteGoal(name) {
  const goals = isDemo
    ? (state.data.goals || []).filter((g) => g.name !== name)
    : (await apiPost({ action: 'deleteGoal', name })).goals;
  setData({ goals });
  toast('Goal deleted');
}

async function saveBalance(name, balance) {
  let wallets;
  if (isDemo) {
    const current = computed().balances.get(name) || 0;
    wallets = state.data.wallets.map((w) => (w.name === name ? { ...w, openingBalance: w.openingBalance + balance - current } : w));
  } else {
    const result = await apiPost({ action: 'setBalance', wallet: name, balance });
    wallets = state.data.wallets.map((w) => (w.name === name ? { ...w, openingBalance: result.wallet.openingBalance } : w));
  }
  setData({ wallets });
  toast(`${name} balance updated`);
}

function openBalance(name) {
  const wallet = (state.data.wallets || []).find((w) => w.name === name);
  if (!wallet) return;
  openBalanceSheet({ wallet: name, type: wallet.type, current: computed().balances.get(name) || 0, money, onSave: (b) => saveBalance(name, b) });
}

const findGoal = (name) => (state.data.goals || []).find((g) => g.name === name);

function openGoal(name = null) {
  if (!state.data) return;
  const goal = name ? findGoal(name) : null;
  openGoalSheet({ goal, wallets: state.data.wallets || [], money, onSave: saveGoal, onDelete: goal ? deleteGoal : null });
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

/**
 * A big serif amount: smaller currency symbol, the number counts up on arrival (see countUp()).
 * Signs use a true minus so the figure doesn't jump.
 */
function bigMoney(value) {
  const number = formatMoney(Math.abs(value), { decimals: decimals() });
  const cur = currency();
  return `${value < 0 ? '−' : ''}${cur ? `<span class="cur">${esc(cur)}</span>` : ''}<span class="num" data-count="${Math.abs(value)}">${esc(number)}</span>`;
}

function txRow(tx, { perspective = null, query = '' } = {}) {
  const cls = amountClass(tx, perspective);
  const sign = cls === 'neg' ? '−' : cls === 'pos' ? '+' : '';
  let icon, title, detail;
  if (tx.type === TRANSFER) {
    icon = '🔁';
    title = esc('Transfer');
    detail = `${highlight(tx.wallet, query)} → ${highlight(tx.toWallet, query)}`;
  } else {
    icon = categoryIcon(tx.category);
    title = highlight(tx.subcategory || tx.category || 'Uncategorized', query);
    detail = (tx.subcategory ? `${highlight(tx.category, query)} · ` : '') + highlight(tx.wallet, query);
  }
  const time = tx.when.toTimeString().slice(0, 5);
  // Tap to edit; swipe left to reveal Delete
  return `
    <li class="swipe">
      <button class="swipe-delete" data-action="delete-tx" data-id="${tx.id}" tabindex="-1">${ICONS.trash}<span>Delete</span></button>
      <div class="tx" data-action="edit-tx" data-id="${tx.id}" role="button" tabindex="0">
        <span class="tx-icon ${tx.type.toLowerCase()}">${icon}</span>
        <span class="tx-main">
          <span class="tx-title">${title}</span>
          <span class="tx-detail">${detail}${tx.note ? ` · <em>${highlight(tx.note, query)}</em>` : ''}</span>
        </span>
        <span class="tx-side">
          <span class="amount ${cls}">${sign}${esc(money(tx.amount))}</span>
          <span class="tx-time">#${tx.id} · ${time}</span>
        </span>
      </div>
    </li>`;
}

/** Transactions grouped by day; each day shows what went out that day. */
function txListByDay(txs, { perspective = null, limit = state.limit, showMore = true, query = '' } = {}) {
  if (!txs.length) return '<p class="empty">No transactions found.</p>';
  const now = new Date();
  const shown = txs.slice(0, limit);
  const days = [];
  for (const tx of shown) {
    const label = dayLabel(tx.when, now);
    if (days[days.length - 1]?.label !== label) days.push({ label, txs: [] });
    days[days.length - 1].txs.push(tx);
  }
  let html = days.map((day) => {
    const out = day.txs.reduce((sum, t) => sum + (t.type === EXPENSE ? t.amount : 0), 0);
    return `
      <h3 class="day"><span>${esc(day.label)}</span>${out ? `<span class="day-total">−${esc(money(out))}</span>` : ''}</h3>
      <ul class="card list">${day.txs.map((tx) => txRow(tx, { perspective, query })).join('')}</ul>`;
  }).join('');
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

const sectionTitle = (title, action = '') => `<h2 class="section-title"><span>${title}</span>${action}</h2>`;

/** The editorial "left to spend" block: big serif number on the paper, no card (Home and Plan). */
function planHero(plan, monthName, { split = true } = {}) {
  const over = plan.left < 0;
  const label = plan.mode === 'budget' ? 'Left to spend' : 'Left this month';
  const sub = plan.mode === 'budget'
    ? `of ${money(plan.total)} budgeted`
    : `income ${money(plan.income)} − spending ${money(plan.expense)}`;
  const perDay = over
    ? `<span class="neg">Over by ${nb(-plan.left)}</span>`
    : plan.daysLeft > 0 && plan.left > 0
      ? `≈ <strong>${nb(plan.perDay)}</strong> a day · ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} left`
      : '';
  return `
    <section class="hero-block">
      <p class="overline">${label} · ${esc(monthName)}</p>
      <p class="display ${over ? 'neg' : ''}">${bigMoney(plan.left)}</p>
      <p class="hero-sub">${esc(sub)}</p>
      ${plan.total > 0 || plan.used > 0 ? bar(plan.fraction, `thick ${budgetClass(plan.fraction)}`) : ''}
      ${perDay ? `<p class="hero-perday">${perDay}</p>` : ''}
      ${split ? `
      <div class="hero-split">
        <div><span class="overline">Money in</span><strong class="pos">${nb(plan.income)}</strong></div>
        <div><span class="overline">Money out</span><strong>${nb(plan.expense)}</strong></div>
      </div>` : ''}
    </section>`;
}

/** Progress ring for a goal (single series: the number in the middle names it, no legend needed). */
function ring(fraction, cls = '') {
  const pct = Math.round(fraction * 100);
  return `
    <span class="ring ${cls}" role="img" aria-label="${pct}% saved">
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle class="ring-track" cx="28" cy="28" r="24" pathLength="100"/>
        <circle class="ring-fill" cx="28" cy="28" r="24" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - pct}"/>
      </svg>
      <span class="ring-label">${pct}<small>%</small></span>
    </span>`;
}

function goalPace(g) {
  if (g.reached) return '<span class="pos">Reached 🎉</span>';
  const date = g.targetDate ? new Date(`${g.targetDate}T12:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  if (g.overdue) return `<span class="warn">Target date passed</span> · ${nb(g.remaining)} to go`;
  if (g.perMonth) return `≈ ${nb(g.perMonth)} a month until ${esc(date)}`;
  return `${nb(g.remaining)} to go`;
}

const goalsWithProgress = () => {
  const { balances } = computed();
  const now = new Date();
  return (state.data.goals || []).map((g) => goalProgress(g, balances, now));
};

// ---------- screens ----------

function renderHome() {
  const { txs, balances } = computed();
  const now = new Date();
  const monthTxs = inMonth(txs, now.getFullYear(), now.getMonth());
  const plan = monthPlan(state.data.budgets, monthTxs, now.getFullYear(), now.getMonth(), now);
  const insights = monthInsights(txs, now.getFullYear(), now.getMonth(), now);
  const groups = groupWallets(state.data.wallets || [], balances);
  const worth = netWorth(balances);
  const goals = goalsWithProgress();

  const change = insights.expenseChange;
  const prevName = insights.previousMonth.toLocaleDateString('en-GB', { month: 'short' });
  const delta = change === null || !isFinite(change) ? '<span class="tile-sub">this month</span>' : `
    <span class="tile-sub wrap"><span class="${change > 0 ? 'neg' : 'pos'}">${change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}%</span> vs same days of ${esc(prevName)}</span>`;

  const goalTile = goals.length
    ? `<button class="card tile wide goals-tile" data-action="plan" data-plan="goals">
        <span class="tile-head"><span class="overline">Goals</span><span class="link">See all</span></span>
        ${goals.slice(0, 2).map((g) => `
          <span class="mini-goal">
            <span class="mini-goal-line"><span class="serif">${esc(g.name)}</span><span>${Math.round(g.fraction * 100)}%</span></span>
            ${bar(g.fraction, g.reached ? 'pos' : 'accent')}
          </span>`).join('')}
      </button>`
    : `<button class="card tile wide goals-tile empty-goal" data-action="add-goal">
        <span class="overline">Goals</span>
        <span class="serif tile-big">Start saving for something</span>
        <span class="tile-sub">Emergency fund, a laptop, a trip… <span class="link">Create a goal →</span></span>
      </button>`;

  const topBudgets = [...plan.budgets].sort((a, b) => b.fraction - a.fraction).slice(0, 3);
  const budgetsHtml = topBudgets.length
    ? `<section class="gap-lg">
        ${sectionTitle('Budgets', '<button class="link" data-action="plan" data-plan="budgets">See all</button>')}
        <ul class="card list padded">${topBudgets.map((b) => budgetRow(b, plan.daysLeft)).join('')}</ul>
      </section>`
    : `<p class="hint">Set monthly budgets to see how much you can spend per day. <button class="link" data-action="edit-budgets">Set budgets</button></p>`;

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
    ${planHero(plan, now.toLocaleDateString('en-GB', { month: 'long' }), { split: false })}
    <section class="bento">
      <div class="card tile">
        <span class="overline">Spent</span>
        <strong class="tile-big serif">${nb(plan.expense)}</strong>
        ${delta}
      </div>
      <div class="card tile">
        <span class="overline">Earned</span>
        <strong class="tile-big serif">${nb(plan.income)}</strong>
        <span class="tile-sub">this month</span>
      </div>
      <button class="card tile wide" data-action="scroll" data-target="accounts">
        <span class="tile-head"><span class="overline">Net worth</span><span class="row-chevron">${ICONS.chevron}</span></span>
        <strong class="tile-big serif ${worth.net < 0 ? 'neg' : ''}">${nb(worth.net)}</strong>
        <span class="tile-sub">Assets ${nb(worth.assets)} · Debts <span class="${worth.debts ? 'neg' : ''}">${nb(worth.debts)}</span></span>
      </button>
      ${goalTile}
    </section>
    ${budgetsHtml}
    <section class="gap-xl">
      ${sectionTitle('Recent', '<button class="link" data-action="tab" data-tab="transactions">See all</button>')}
      ${txs.length ? txListByDay(txs, { limit: 5, showMore: false }) : '<p class="empty">No transactions yet. Tap <strong>+</strong> to add one.</p>'}
    </section>
    <section class="gap-xl" id="accounts">
      ${sectionTitle('Accounts')}
      ${walletGroups || '<p class="empty">No wallets yet. Add them in the Wallets tab of your sheet.</p>'}
    </section>`;
}

function planSwitch() {
  return `
    <div class="segmented two" role="tablist">
      ${[['budgets', 'Budgets'], ['goals', 'Goals']].map(([v, label]) => `
        <button type="button" role="tab" aria-selected="${state.plan === v}" class="seg ${state.plan === v ? 'active' : ''}" data-action="plan" data-plan="${v}">${label}</button>`).join('')}
    </div>`;
}

function renderPlan() {
  return planSwitch() + (state.plan === 'goals' ? renderGoals() : renderBudgets());
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
    ${planHero(plan, monthLabel(year, month).split(' ')[0], { split: false })}
    <section class="gap-lg">
      ${sectionTitle('By category', '<button class="link" data-action="edit-budgets">Edit</button>')}
      <ul class="card list padded">${sorted.map((b) => budgetRow(b, plan.daysLeft)).join('')}</ul>
    </section>
    <p class="hint small">Budgets repeat every month. The Telegram bot uses the same limits.</p>`;
}

function renderGoals() {
  const goals = goalsWithProgress();
  if (!goals.length) {
    return `
      <section class="card empty-card">
        <p class="empty-icon">🏁</p>
        <h2>Save for what matters</h2>
        <p class="muted">Set a target, and optionally a date. Link a savings wallet and progress follows its balance, or add money by hand. You'll see how much to put aside each month.</p>
        <button class="btn-primary" data-action="add-goal">Create a goal</button>
      </section>`;
  }
  const saved = goals.reduce((sum, g) => sum + Math.min(g.current, g.target), 0);
  const target = goals.reduce((sum, g) => sum + g.target, 0);
  const wallets = new Map((state.data.wallets || []).map((w) => [w.name, w.type]));
  return `
    <section class="hero-block">
      <p class="overline">Saved towards goals</p>
      <p class="display">${bigMoney(saved)}</p>
      <p class="hero-sub">of ${nb(target)} across ${goals.length} goal${goals.length === 1 ? '' : 's'}</p>
      ${bar(target ? saved / target : 0, 'thick accent')}
    </section>
    <ul class="goal-list gap-lg">
      ${goals.map((g) => `
        <li class="card goal">
          <button class="goal-main" data-action="edit-goal" data-name="${esc(g.name)}" aria-label="Edit ${esc(g.name)}">
            ${ring(g.fraction, g.reached ? 'done' : '')}
            <span class="goal-text">
              <span class="goal-name">${esc(g.name)}</span>
              <span class="goal-amounts">${nb(g.current)} <span class="muted">of ${nb(g.target)}</span></span>
              <span class="goal-pace">${goalPace(g)}</span>
            </span>
            <span class="row-chevron">${ICONS.chevron}</span>
          </button>
          <div class="goal-foot">
            <span class="muted small">${g.wallet ? `${walletIcon(wallets.get(g.wallet))} Follows ${esc(g.wallet)}` : '✍️ Updated by you'}</span>
            ${g.wallet || g.reached ? '' : `<button class="pill-btn" data-action="add-money" data-name="${esc(g.name)}">+ Add money</button>`}
          </div>
        </li>`).join('')}
    </ul>
    <button class="btn-secondary" data-action="add-goal">+ New goal</button>
    <p class="hint small">Goals are saved in the Goals tab of your sheet. Telegram: /goals</p>`;
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
    <section class="tiles gap-lg">
      <div class="card tile"><span class="overline">Average per day</span><strong class="serif tile-big">${nb(insights.avgPerDay)}</strong></div>
      <div class="card tile"><span class="overline">Busiest day</span><strong class="serif tile-big">${insights.busiestDay ? esc(insights.busiestDay.name) : '—'}</strong>
        ${insights.busiestDay ? `<span class="tile-sub">${esc(money(insights.busiestDay.total))} spent</span>` : ''}</div>
      <div class="card tile"><span class="overline">Biggest expense</span><strong class="serif tile-big">${biggest ? nb(biggest.amount) : '—'}</strong>
        ${biggest ? `<span class="tile-sub">${categoryIcon(biggest.category)} ${esc(biggest.note || biggest.subcategory || biggest.category)}</span>` : ''}</div>
      <div class="card tile"><span class="overline">Transactions</span><strong class="serif tile-big">${insights.count}</strong>
        ${totals.income > 0 ? `<span class="tile-sub">Saved ${Math.round(Math.max(0, totals.net) / totals.income * 100)}% of income</span>` : ''}</div>
    </section>` : '';

  const incomeList = categoryList(INCOME);
  const hasFlow = flow.some((m) => m.income || m.expense);
  return `
    ${monthNav()}
    <section class="hero-block report-hero">
      <p class="overline">Net this month</p>
      <p class="display ${totals.net < 0 ? 'neg' : ''}">${bigMoney(totals.net)}</p>
      <div class="hero-split">
        <div><span class="overline">Income</span><strong class="pos">${nb(totals.income)}</strong></div>
        <div class="stat"><span class="overline">Expenses</span><strong>${nb(totals.expense)}</strong>${delta}</div>
      </div>
    </section>
    ${monthTxs.length ? '' : '<p class="empty">No transactions in this month.</p>'}
    ${parts.length ? `
      <section class="gap-lg">
        ${sectionTitle('Where it went')}
        <div class="card chart-card">${segmentedBar(parts, money)}</div>
        <ul class="card list cats">${categoryList(EXPENSE)}</ul>
      </section>` : ''}
    ${tiles}
    ${hasFlow ? `
      <section class="gap-xl">
        ${sectionTitle('Cash flow', '<span class="muted small">tap a month</span>')}
        <div class="card chart-card">${cashFlowChart(flow, state.month, money)}</div>
      </section>` : ''}
    ${incomeList ? `<section class="gap-lg">${sectionTitle('Income by category')}<ul class="card list cats">${incomeList}</ul></section>` : ''}`;
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

// ---------- transactions: search + filters ----------

const filtered = (filters = state.filters) => filterTransactions(computed().txs, state.search, filters, new Date());
const isFiltering = () => state.search.trim() !== '' || state.filters.type !== 'all' || activeFilterCount(state.filters) > 0;

/** Removable pills for the filters that are on. */
function activePills() {
  const f = state.filters;
  const pills = [];
  if (f.range !== 'all' && rangeBounds(f.range, new Date(), f.from, f.to)) {
    let label = RANGES.find(([v]) => v === f.range)?.[1];
    if (f.range === 'custom') {
      const fmt = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '…');
      label = `${fmt(f.from)} – ${fmt(f.to)}`;
    }
    pills.push(['range', '', `📅 ${label}`]);
  }
  f.wallets.forEach((w) => pills.push(['wallet', w, w]));
  f.categories.forEach((c) => pills.push(['category', c, `${categoryIcon(c)} ${c}`]));
  if (Number(f.min) > 0 || Number(f.max) > 0) {
    const label = f.min && f.max ? `${money(f.min)} – ${money(f.max)}` : f.min ? `≥ ${money(f.min)}` : `≤ ${money(f.max)}`;
    pills.push(['amount', '', label]);
  }
  if (!pills.length) return '';
  return `<div class="pills">${pills.map(([kind, value, label]) => `
    <button class="pill" data-action="remove-filter" data-kind="${kind}" data-v="${esc(value)}" aria-label="Remove filter ${esc(label)}">${esc(label)}${ICONS.close}</button>`).join('')}
    <button class="link small" data-action="clear-filters">Clear all</button></div>`;
}

function resultsHtml() {
  const txs = filtered();
  const query = state.search.trim();
  let summary = '';
  if (isFiltering()) {
    const s = summarize(txs);
    summary = `
      <div class="card result-summary">
        <div><span class="overline">${s.count === 1 ? 'Result' : 'Results'}</span><strong class="serif">${s.count}</strong></div>
        <div><span class="overline">Out</span><strong>${nb(s.out)}</strong></div>
        <div><span class="overline">In</span><strong class="pos">${nb(s.in)}</strong></div>
        <button class="icon-btn" data-action="export" aria-label="Export these transactions as CSV" ${s.count ? '' : 'disabled'}>${ICONS.share}</button>
      </div>`;
  }
  return summary + txListByDay(txs, { query });
}

function renderTransactions() {
  const f = state.filters;
  const chips = [['all', 'All'], [EXPENSE, 'Expenses'], [INCOME, 'Income'], [TRANSFER, 'Transfers']]
    .map(([value, label]) => `<button class="chip ${f.type === value ? 'active' : ''}" data-action="type" data-type="${value}" aria-pressed="${f.type === value}">${label}</button>`)
    .join('');
  const count = activeFilterCount(f);
  return `
    <div class="searchbar">
      <label class="search-field">
        ${ICONS.search}
        <input id="search" type="search" placeholder="Search notes, categories, amounts…" value="${esc(state.search)}" autocomplete="off" enterkeyhint="search">
        <button type="button" class="clear-search ${state.search ? '' : 'hidden'}" data-action="clear-search" aria-label="Clear search">${ICONS.close}</button>
      </label>
      <button class="filter-btn ${count ? 'on' : ''}" data-action="open-filters" aria-label="Filters${count ? ` (${count} on)` : ''}">${ICONS.filter}${count ? `<span class="badge">${count}</span>` : ''}</button>
    </div>
    <div class="chips">${chips}</div>
    ${activePills()}
    <div id="tx-results">${resultsHtml()}</div>
    <p class="hint small">Tap a transaction to edit it · swipe left to delete</p>`;
}

function openFilters() {
  openFilterSheet({
    filters: state.filters,
    wallets: state.data.wallets || [],
    categories: state.data.categories || {},
    count: (f) => filtered(f).length,
    onApply: (f) => {
      state.filters = f;
      state.limit = 100;
      render();
    },
  });
}

async function exportCsv() {
  const txs = filtered();
  const name = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File([toCsv(txs)], name, { type: 'text/csv' });
  // On iPhone the share sheet lets you save to Files, AirDrop or mail it
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
    <section class="hero-block">
      <p class="overline">${walletIcon(type)} ${esc(type)} · balance</p>
      <p class="display ${balance < 0 ? 'neg' : ''}">${bigMoney(balance)}</p>
      <div class="hero-split">
        <div><span class="overline">In this month</span><strong class="pos">${nb(flow.moneyIn)}</strong></div>
        <div><span class="overline">Out this month</span><strong>${nb(flow.moneyOut)}</strong></div>
      </div>
      ${wallet ? `
      <div class="wallet-actions">
        <span class="muted small">Opening balance ${esc(money(wallet.openingBalance))}</span>
        <button class="pill-btn" data-action="adjust-balance" data-name="${esc(name)}">Adjust balance</button>
      </div>` : ''}
    </section>
    <section class="gap-lg">
      ${sectionTitle('Transactions', `<span class="muted small">${mine.length}</span>`)}
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
    <section class="gap-xl">
      ${sectionTitle('About')}
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
      <p class="overline">Personal finance · on your Google Sheet</p>
      <h1>Expense<br><em>Tracker</em></h1>
      <p class="muted">Connect to your Google Sheet using the Apps Script URL and API key. They're saved on this device only.</p>
      ${settingsForm({ firstRun: true })}
      <a class="btn-secondary" href="?demo">Preview with sample data</a>
    </main>`;
}

// ---------- layout ----------

const app = document.getElementById('app');

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function titleText() {
  if (state.view === 'settings') return 'Settings';
  if (state.view?.wallet) return state.view.wallet;
  if (state.tab === 'home') return greeting();
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
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return `
    <div class="topbar-row">
      ${inner ? `<button class="icon-btn back" data-action="back" aria-label="Back">${ICONS.back}</button>` : ''}
      <div class="titles">
        <p class="overline status">${!inner && state.tab === 'home' ? `${esc(date)} · ` : ''}${esc(statusText())}</p>
        <h1>${esc(titleText())}</h1>
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
  if (state.tab === 'budgets') return renderPlan();
  if (state.tab === 'reports') return renderReports();
  return renderHome();
}

function tabButton(tab) {
  const active = state.view === null && state.tab === tab;
  return `<button class="tab ${active ? 'active' : ''}" data-action="tab" data-tab="${tab}" ${active ? 'aria-current="page"' : ''}>${ICONS[tab]}<span>${TAB_TITLES[tab]}</span></button>`;
}

/** Big numbers count up from zero when a screen opens (skipped with Reduce Motion). */
function countUp(root) {
  if (reducedMotion()) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (!(target > 0)) return;
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4; // ease-out quart: fast start, gentle landing
      el.textContent = formatMoney(target * eased, { decimals: decimals() });
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = formatMoney(0, { decimals: decimals() });
    requestAnimationFrame(step);
  });
}

function render() {
  if (!isDemo && !(settings.url && settings.key)) {
    app.innerHTML = renderSetup();
    return;
  }
  const animate = state.animate && !reducedMotion();
  state.animate = false;
  app.innerHTML = `
    <header class="topbar">${headerHtml()}</header>
    <main class="content ${animate ? 'enter' : ''}">${mainHtml()}</main>
    <nav class="tabbar">
      ${tabButton('home')}${tabButton('transactions')}
      <button class="tab-add" data-action="add" aria-label="Add transaction" ${state.data ? '' : 'disabled'}>${ICONS.plus}</button>
      ${tabButton('budgets')}${tabButton('reports')}
    </nav>`;
  // Numbers count up the first time each screen opens after launching the app; after that they just appear
  const screen = JSON.stringify([state.tab, state.plan, state.view]);
  if (animate && !countedScreens.has(screen)) {
    countedScreens.add(screen);
    countUp(app.querySelector('.content'));
  }
}
const countedScreens = new Set();

// ---------- navigation (uses browser history so the back gesture works) ----------

function openView(view) {
  state.view = view;
  state.animate = true;
  history.pushState({ view }, '');
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', (event) => {
  state.view = event.state?.view ?? null;
  state.animate = true;
  render();
});

function goTab(tab) {
  if (state.view !== null) history.back();
  state.view = null;
  state.tab = tab;
  state.limit = 100;
  state.animate = true;
  render();
  window.scrollTo(0, 0);
}

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

/** Redraws only the results (not the search box), so the keyboard stays open while typing. */
function refreshResults() {
  const box = document.getElementById('tx-results');
  if (box) box.innerHTML = resultsHtml();
  app.querySelector('.clear-search')?.classList.toggle('hidden', !state.search);
}

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
  } else if (action === 'adjust-balance') {
    openBalance(target.dataset.name);
  } else if (action === 'add-goal') {
    openGoal();
  } else if (action === 'edit-goal') {
    openGoal(target.dataset.name);
  } else if (action === 'add-money') {
    const goal = findGoal(target.dataset.name);
    if (goal) openAddMoneySheet({ goal, money, onSave: saveGoal });
  } else if (action === 'plan') {
    state.plan = target.dataset.plan;
    if (state.tab !== 'budgets' || state.view !== null) goTab('budgets');
    else { state.animate = true; render(); }
  } else if (action === 'scroll') {
    document.getElementById(target.dataset.target)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  } else if (action === 'cf-month') {
    state.month = { year: Number(target.dataset.year), month: Number(target.dataset.month) };
    render();
  } else if (action === 'tab') {
    goTab(target.dataset.tab);
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
  } else if (action === 'type') {
    state.filters = { ...state.filters, type: target.dataset.type };
    state.limit = 100;
    render();
  } else if (action === 'open-filters') {
    openFilters();
  } else if (action === 'remove-filter') {
    const f = { ...state.filters, wallets: [...state.filters.wallets], categories: [...state.filters.categories] };
    const { kind, v } = target.dataset;
    if (kind === 'range') Object.assign(f, { range: 'all', from: '', to: '' });
    if (kind === 'wallet') f.wallets = f.wallets.filter((w) => w !== v);
    if (kind === 'category') f.categories = f.categories.filter((c) => c !== v);
    if (kind === 'amount') Object.assign(f, { min: '', max: '' });
    state.filters = f;
    render();
  } else if (action === 'clear-filters') {
    state.filters = { ...freshFilters(), type: state.filters.type };
    render();
  } else if (action === 'clear-search') {
    state.search = '';
    const input = document.getElementById('search');
    if (input) { input.value = ''; input.focus(); }
    refreshResults();
  } else if (action === 'export') {
    exportCsv().catch((error) => toast(`Couldn't export: ${error.message}`));
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

app.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  state.search = event.target.value;
  state.limit = 100;
  refreshResults();
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
    state.animate = true;
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

// Optional starting point from the address, e.g. …/#reports, …/#goals or …/#add
const startHash = location.hash.slice(1);
const legacyTabs = { overview: 'home', summary: 'reports', goals: 'budgets', plan: 'budgets' };
const startTab = legacyTabs[startHash] || startHash;
if (TABS.includes(startTab)) state.tab = startTab;
if (startHash === 'goals') state.plan = 'goals';

history.replaceState({ view: null }, '');
render();
refresh();
if (startHash === 'add') openEntry();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
}
