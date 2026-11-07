// WhatTheFund web app — reads and writes your Google Sheet through the Apps Script API.
// The API URL and key are stored only on this device (localStorage), never in these files.
import {
  EMPTY_FILTERS, EXPENSE, FREQUENCY_NAMES, INCOME, RANGES, TRANSFER,
  activeFilterCount, byCategory, cashFlow, categorySlots, dayLabel, filterTransactions, formatMoney,
  goalProgress, groupWallets, inMonth, isCustomCycle, monthInsights, monthLabel, monthPlan, monthTotals, netWorth,
  occurrences, periodBounds, periodOf, periodRange, prepareTransactions, rangeBounds, setPayCycle, spendingParts, summarize,
  timeAgo, toCsv, walletBalances, walletFlow,
} from './calc.js';
import { openBalanceSheet } from './balance.js';
import { openBudgetSheet } from './budgets.js';
import { cardHtml, openCardSheet, parseCard } from './cards.js';
import { cashFlowChart, readout, segmentedBar } from './charts.js';
import { demoData } from './demo.js';
import { openEntrySheet } from './entry.js';
import { openFilterSheet } from './filters.js';
import { openAddMoneySheet, openGoalSheet } from './goals.js';
import { openPaydaySheet } from './payday.js';
import { openWalletSheet } from './wallets.js';
import { ICONS, categoryIcon, esc, highlight, icon, reducedMotion, walletIcon } from './ui.js';

const APP_VERSION = '4.3.0';
const KEYS = { settings: 'expense-tracker.settings', cache: 'expense-tracker.cache', appearance: 'expense-tracker.appearance', name: 'expense-tracker.name' };
const REFRESH_AFTER_MS = 60 * 1000; // refresh when reopening the app after a minute
const TABS = ['home', 'wallets', 'budgets', 'reports', 'more'];
const TAB_TITLES = { home: 'Home', wallets: 'Wallets', budgets: 'Budgets', reports: 'Reports', more: 'More' };
const VIEW_TITLES = { settings: 'Settings', transactions: 'Transactions', recurring: 'Recurring' };

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
  view: null,                 // null | 'settings' | 'transactions' | 'recurring' | { wallet: name }
  month: { year: today.getFullYear(), month: today.getMonth() },
  filters: freshFilters(),    // Transactions: type chips + the Filters sheet
  search: '',
  expanded: new Set(),        // expanded categories in reports
  limit: 100,                 // transactions shown before "Show more"
  data: isDemo ? demoData() : cached?.data || null,
  fetchedAt: isDemo ? Date.now() : cached?.fetchedAt || null,
  loading: false,
  error: null,
  menu: false,                // the ⋯ menu at the top right is open
  animate: true,              // play the entrance animation on the next render (navigation only)
};

// The pay cycle (day your month starts) lives in the sheet, so the Telegram bot shares it
const syncCycle = () => setPayCycle(state.data?.settings || {});
syncCycle();
state.month = periodOf(today);

const decimals = () => Number(settings.decimals) || 0;
const currency = () => settings.currency || (isDemo ? 'Rp' : '');
const money = (value) => formatMoney(value, { currency: currency(), decimals: decimals() });

// ---------- appearance: light, dark, or follow the iPhone (index.html applies it before first paint) ----------

let appearance = storage.get(KEYS.appearance) || 'auto'; // 'auto' | 'light' | 'dark'
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
const isDark = () => document.documentElement.dataset.theme === 'dark';

function applyTheme() {
  const dark = appearance === 'dark' || (appearance === 'auto' && !!darkQuery?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // Colour of the iPhone status bar area
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#070c1c' : '#e8edfb'));
}
function setAppearance(value) {
  appearance = value;
  storage.set(KEYS.appearance, value);
  applyTheme();
  render();
}
darkQuery?.addEventListener?.('change', () => { if (appearance === 'auto') { applyTheme(); render(); } });
applyTheme();

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
    const cycleChanged = JSON.stringify(data.settings) !== JSON.stringify(state.data?.settings);
    state.data = data;
    syncCycle();
    if (cycleChanged) state.month = periodOf(new Date());
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
  if (patch.settings) { syncCycle(); state.month = periodOf(new Date()); }
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
  const current = periodOf(new Date());
  const last = new Date(current.year, current.month - 1, 1);
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

async function saveCard(name, card) {
  if (!isDemo) await apiPost({ action: 'setWalletCard', wallet: name, card });
  setData({ wallets: state.data.wallets.map((w) => (w.name === name ? { ...w, card } : w)) });
  toast('Card saved');
}

function openCard(name) {
  const wallet = (state.data.wallets || []).find((w) => w.name === name);
  if (!wallet) return;
  const balance = computed().balances.get(name) || 0;
  openCardSheet({ wallet, amountHtml: cardMoney(balance), negative: balance < 0, onSave: (card) => saveCard(name, card) });
}

function openBalance(name) {
  const wallet = (state.data.wallets || []).find((w) => w.name === name);
  if (!wallet) return;
  openBalanceSheet({ wallet: name, type: wallet.type, current: computed().balances.get(name) || 0, money, onSave: (b) => saveBalance(name, b) });
}

// ---------- wallets: add / remove ----------

async function addWallet(wallet) {
  const clean = { ...wallet, card: '' };
  const wallets = isDemo ? [...(state.data.wallets || []), clean] : (await apiPost({ action: 'addWallet', wallet })).wallets;
  setData({ wallets });
  toast(`${wallet.name} added`);
}

function openNewWallet() {
  if (!state.data) return;
  openWalletSheet({ existing: (state.data.wallets || []).map((w) => w.name), onSave: addWallet });
}

async function removeWallet(name) {
  const txs = (state.data.transactions || []).filter((t) => t.wallet === name || t.toWallet === name);
  const scheduled = recurringItems().filter((r) => r.wallet === name || r.toWallet === name);
  const goals = (state.data.goals || []).filter((g) => g.wallet === name);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (txs.length) parts.push(plural(txs.length, 'transaction'));
  if (scheduled.length) parts.push(plural(scheduled.length, 'recurring item'));
  const warning = parts.length
    ? `Remove “${name}”?\n\nThis also deletes its ${parts.join(' and ')}. A transfer to or from another wallet disappears from that wallet too, so its balance changes. ${goals.length ? `Goals that follow it keep today's balance as their saved amount. ` : ''}This can't be undone.`
    : `Remove the wallet “${name}”?${goals.length ? ' Goals that follow it keep its balance as their saved amount.' : ''}`;
  if (!confirm(warning)) return;
  try {
    let patch;
    if (isDemo) {
      const balance = computed().balances.get(name) || 0;
      patch = {
        wallets: state.data.wallets.filter((w) => w.name !== name),
        transactions: (state.data.transactions || []).filter((t) => t.wallet !== name && t.toWallet !== name),
        recurring: recurringItems().filter((r) => r.wallet !== name && r.toWallet !== name),
        goals: (state.data.goals || []).map((g) => (g.wallet === name ? { ...g, wallet: '', saved: Math.max(0, balance) } : g)),
      };
    } else {
      patch = { wallets: (await apiPost({ action: 'deleteWallet', name, force: true })).wallets };
    }
    state.view = null;
    history.back();
    setData(patch);
    toast(`${name} removed`);
    if (!isDemo) refresh(); // pick up the deleted transactions, recurring items and goal changes
  } catch (error) {
    alert(error.message);
  }
}

// ---------- recurring ----------

const recurringItems = () => state.data?.recurring || [];

async function saveRecurring(transaction, id = null) {
  const item = { ...transaction, id: id || undefined, active: transaction.active !== false };
  delete item.date;
  let recurring;
  let created = 0;
  if (isDemo) {
    const list = [...recurringItems()];
    const at = list.findIndex((r) => r.id === id);
    const full = { ...item, day: Number(item.nextDate.slice(8, 10)), id: id || Math.max(0, ...list.map((r) => r.id)) + 1 };
    if (at === -1) list.push(full); else list[at] = full;
    recurring = list;
  } else {
    const result = await apiPost({ action: 'setRecurring', item });
    recurring = result.recurring;
    created = result.created;
  }
  setData({ recurring });
  toast(created ? `Saved · ${created} added to your transactions` : 'Recurring saved');
  if (created) refresh();
}

async function deleteRecurring(id) {
  const recurring = isDemo ? recurringItems().filter((r) => r.id !== id) : (await apiPost({ action: 'deleteRecurring', id })).recurring;
  setData({ recurring });
  toast('Recurring item deleted');
}

async function toggleRecurring(id) {
  const item = recurringItems().find((r) => r.id === id);
  if (!item) return;
  await saveRecurring({ ...item, active: !item.active }, id);
  toast(item.active ? 'Paused' : 'Resumed');
}

function openRecurring(id = null) {
  if (!state.data) return;
  const item = id ? recurringItems().find((r) => r.id === id) : null;
  if (id && !item) return;
  openEntrySheet({
    data: state.data,
    money,
    decimals: decimals(),
    tx: item ? { ...item, date: `${item.nextDate} 09:00` } : null,
    recurring: { frequency: item?.frequency || 'monthly' },
    onSave: (transaction) => saveRecurring({ ...transaction, active: item ? item.active : true }, item ? item.id : null),
    onDelete: item ? (rid) => deleteRecurring(rid) : null,
  });
}

// ---------- pay cycle ----------

async function saveCycle(values) {
  const saved = isDemo ? values : (await apiPost({ action: 'setSettings', ...values })).settings;
  setData({ settings: saved });
  toast('Pay cycle saved');
}

function openCycle() {
  if (!state.data) return;
  const settingsNow = state.data.settings || { payday: 1, paydayWeekdays: false };
  openPaydaySheet({
    settings: settingsNow,
    preview: (payday, paydayWeekdays) => {
      setPayCycle({ payday, paydayWeekdays }); // try the choice, then put the saved one back
      const now = new Date();
      const { year, month } = periodOf(now);
      const { start, end } = periodBounds(year, month);
      const result = {
        current: periodRange(year, month),
        next: end.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        start,
      };
      syncCycle();
      return result;
    },
    onSave: saveCycle,
  });
}

const cycleSummary = () => {
  const s = state.data?.settings || { payday: 1, paydayWeekdays: false };
  return s.payday === 1 && !s.paydayWeekdays ? 'Calendar month' : `Starts on day ${s.payday}${s.paydayWeekdays ? ' · weekdays only' : ''}`;
};

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

/** Amount for a wallet card: smaller currency, true minus sign, no count-up animation inside sheets. */
function cardMoney(value) {
  const cur = currency();
  return `${value < 0 ? '−' : ''}${cur ? `<span class="cur">${esc(cur)}</span>` : ''}<span class="num">${esc(formatMoney(Math.abs(value), { decimals: decimals() }))}</span>`;
}

/** Income (+, green) or spending (−, red) with a round icon, used wherever money in/out is shown. */
function flowStat(sign, label, html) {
  const plus = sign === '+';
  return `
    <div class="flow-stat">
      <span class="flow-ico ${plus ? 'pos' : 'neg'}" aria-hidden="true">${plus ? ICONS.plus : ICONS.minus}</span>
      <span class="flow-body"><span class="overline">${label}</span><strong class="${plus ? 'pos' : 'neg'}">${html}</strong></span>
    </div>`;
}

let carouselIndex = 0; // which card is centred (0 = All accounts); kept when the screen redraws

/**
 * The wallet cards on Home: "All accounts" then every wallet, as an endless swipe (the strip holds a few
 * copies and jumps back to the middle one when you stop), with a dot for each card.
 */
function walletCards() {
  const { balances } = computed();
  const wallets = state.data.wallets || [];
  const worth = netWorth(balances);
  const specs = [{
    title: 'All accounts',
    kicker: `${wallets.length} wallet${wallets.length === 1 ? '' : 's'}`,
    caption: 'Net worth',
    amountHtml: bigMoney(worth.net),
    footHtml: `Assets ${esc(money(worth.assets))} · Debts ${esc(money(worth.debts))}`,
    style: { colour: 'midnight', pattern: 'glass' },
    action: 'data-action="tab" data-tab="wallets"',
    label: 'All accounts: open the wallet list',
    negative: worth.net < 0,
  }];
  for (const w of wallets) {
    const balance = balances.get(w.name) || 0;
    const style = parseCard(w.card, w.type);
    specs.push({
      title: w.name,
      kicker: w.type || 'Other',
      caption: balance < 0 ? 'Owed' : 'Balance',
      amountHtml: bigMoney(balance),
      footHtml: esc(style.label),
      style,
      action: `data-action="wallet" data-name="${esc(w.name)}"`,
      label: `${w.name}: ${money(balance)}`,
      negative: balance < 0,
    });
  }
  const n = specs.length;
  const copies = n < 2 ? 1 : n >= 5 ? 3 : 5; // few cards → more copies, so a long fling can't reach the end
  const html = [];
  for (let c = 0; c < copies; c++) {
    const real = copies === 1 || c === Math.floor(copies / 2);
    specs.forEach((spec, i) => {
      html.push(cardHtml({
        ...spec,
        attrs: `${spec.action} data-i="${i}" ${real ? `aria-label="${esc(spec.label)}"` : 'aria-hidden="true" tabindex="-1"'}`,
      }));
    });
  }
  const dots = n > 1
    ? `<div class="dots" role="group" aria-label="Choose a card">${specs.map((spec, i) => `<button type="button" class="dot ${i === carouselIndex % n ? 'active' : ''}" data-action="dot" data-i="${i}" aria-label="Show ${esc(spec.title)}"></button>`).join('')}</div>`
    : '';
  return `
    <section class="wcards-wrap" aria-label="Wallets">
      <div class="wcards" data-n="${n}" data-copies="${copies}">${html.join('')}</div>
      ${dots}
    </section>`;
}

/** Where card 0 of the first copy would be centred (`base`) and the distance between two cards (`step`). */
function carouselGeometry(strip) {
  const [first, second] = strip.children;
  return {
    step: second ? second.offsetLeft - first.offsetLeft : first.offsetWidth,
    base: first.offsetLeft - (strip.clientWidth - first.offsetWidth) / 2,
  };
}

/** Starts the strip in the middle copy, tracks the centred card for the dots, and wraps around when scrolling stops. */
function setupCarousel() {
  const strip = app.querySelector('.wcards');
  const n = Number(strip?.dataset.n);
  if (!strip || n < 2) return;
  const mid = Math.floor(Number(strip.dataset.copies) / 2);
  const dots = [...app.querySelectorAll('.dots .dot')];
  const { step, base } = carouselGeometry(strip);
  const go = (i) => { strip.scrollLeft = base + i * step; };
  const index = () => Math.round((strip.scrollLeft - base) / step);
  const wrap = (i) => ((i % n) + n) % n;

  strip.style.scrollSnapType = 'none';
  go(mid * n + wrap(carouselIndex));
  requestAnimationFrame(() => { strip.style.scrollSnapType = ''; });

  let timer = 0;
  let touching = false;
  const settle = () => {
    if (touching) return;
    const i = index();
    const home = mid * n + wrap(i);
    if (home === i) return;
    strip.style.scrollSnapType = 'none'; // same picture, different copy: the jump is invisible
    go(home);
    requestAnimationFrame(() => { strip.style.scrollSnapType = ''; });
  };
  strip.addEventListener('scroll', () => {
    carouselIndex = wrap(index());
    dots.forEach((dot, k) => dot.classList.toggle('active', k === carouselIndex));
    clearTimeout(timer);
    timer = setTimeout(settle, 140);
  }, { passive: true });
  strip.addEventListener('touchstart', () => { touching = true; }, { passive: true });
  strip.addEventListener('touchend', () => { touching = false; clearTimeout(timer); timer = setTimeout(settle, 220); }, { passive: true });
}

/** Tapping a dot scrolls to that card by the shortest way round. */
function showCard(target) {
  const strip = app.querySelector('.wcards');
  const n = Number(strip?.dataset.n);
  if (!strip || n < 2) return;
  const { step, base } = carouselGeometry(strip);
  const i = Math.round((strip.scrollLeft - base) / step);
  const forward = (target - (((i % n) + n) % n) + n) % n;
  const delta = forward > n / 2 ? forward - n : forward;
  strip.scrollTo({ left: base + (i + delta) * step, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Budget circles at the top of Home: one ring per budget (or the biggest spending categories until you set budgets). */
function budgetRings(plan, monthTxs) {
  const rings = plan.budgets.length
    ? [...plan.budgets].sort((a, b) => b.fraction - a.fraction).map((b) => ({ name: b.category, fraction: b.fraction, cls: budgetClass(b.fraction) }))
    : byCategory(monthTxs, EXPENSE).slice(0, 6).map((c) => ({ name: c.category, fraction: c.share, cls: 'accent' }));
  const items = rings.map((r) => {
    const pct = Math.round(r.fraction * 100);
    const fill = Math.max(0, Math.min(100, pct));
    return `
      <button class="bring" data-action="plan" data-plan="budgets" aria-label="${esc(r.name)}: ${pct}%${plan.budgets.length ? ' of budget' : ' of spending'}">
        <span class="bring-ring ${r.cls}">
          <svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bring-track" cx="32" cy="32" r="29" pathLength="100"/><circle class="bring-fill" cx="32" cy="32" r="29" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - fill}"/></svg>
          <span class="bring-icon">${categoryIcon(r.name)}</span>
        </span>
        <span class="bring-name">${esc(r.name)}</span>
        <span class="bring-pct ${r.cls}">${pct}%</span>
      </button>`;
  });
  items.push(`
      <button class="bring bring-add" data-action="edit-budgets" aria-label="${plan.budgets.length ? 'Edit budgets' : 'Set budgets'}">
        <span class="bring-ring"><span class="bring-icon">${ICONS.plus}</span></span>
        <span class="bring-name">${plan.budgets.length ? 'Budgets' : 'Set budgets'}</span>
      </button>`);
  return `<section class="brings" aria-label="Budgets">${items.join('')}</section>`;
}

function txRow(tx, { perspective = null, query = '' } = {}) {
  const cls = amountClass(tx, perspective);
  const sign = cls === 'neg' ? '−' : cls === 'pos' ? '+' : '';
  let iconHtml, title, detail;
  if (tx.type === TRANSFER) {
    iconHtml = icon('arrows-left-right');
    title = esc('Transfer');
    detail = `${highlight(tx.wallet, query)} → ${highlight(tx.toWallet, query)}`;
  } else {
    iconHtml = categoryIcon(tx.category);
    title = highlight(tx.subcategory || tx.category || 'Uncategorized', query);
    detail = (tx.subcategory ? `${highlight(tx.category, query)} · ` : '') + highlight(tx.wallet, query);
  }
  const time = tx.when.toTimeString().slice(0, 5);
  // Tap to edit; swipe left to reveal Delete
  return `
    <li class="swipe">
      <button class="swipe-delete" data-action="delete-tx" data-id="${tx.id}" tabindex="-1">${ICONS.trash}<span>Delete</span></button>
      <div class="tx" data-action="edit-tx" data-id="${tx.id}" role="button" tabindex="0">
        <span class="tx-icon ${tx.type.toLowerCase()}">${iconHtml}</span>
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
  const current = periodOf(new Date());
  const atCurrent = year > current.year || (year === current.year && month >= current.month);
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Previous month">${ICONS.left}</button>
      <h2>${esc(monthLabel(year, month))}${isCustomCycle() ? `<small>${esc(periodRange(year, month))}</small>` : ''}</h2>
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
        ${flowStat('+', 'Money in', nb(plan.income))}
        ${flowStat('−', 'Money out', nb(plan.expense))}
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
  if (g.reached) return `<span class="pos">Reached ${icon('confetti')}</span>`;
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
  const { txs } = computed();
  const now = new Date();
  const cycle = periodOf(now);
  const monthTxs = inMonth(txs, cycle.year, cycle.month);
  const plan = monthPlan(state.data.budgets, monthTxs, cycle.year, cycle.month, now);
  const goals = goalsWithProgress();
  const cycleName = monthLabel(cycle.year, cycle.month).split(' ')[0];

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

  // Recurring items still to come before the next payday
  const end = periodBounds(cycle.year, cycle.month).end;
  let dueCount = 0;
  let dueOut = 0;
  for (const item of recurringItems().filter((r) => r.active)) {
    const dates = occurrences(item, end);
    dueCount += dates.length;
    if (item.type === EXPENSE) dueOut += dates.length * item.amount;
  }
  const scheduled = dueCount
    ? `<button class="card scheduled" data-action="open-view" data-view="recurring">
        <span class="scheduled-ico">${ICONS.repeat}</span>
        <span class="scheduled-text"><strong>Scheduled</strong><span class="muted small">${dueCount} coming up this month</span></span>
        ${dueOut ? `<span class="scheduled-amount neg">−${nb(dueOut)}</span>` : ''}
      </button>`
    : '';

  return `
    <div class="home-search">
      <button class="search-fake" data-action="open-search">${ICONS.search}<span>Search transactions</span></button>
      <button class="filter-btn" data-action="open-filters-home" aria-label="Filters">${ICONS.filter}</button>
    </div>
    ${budgetRings(plan, monthTxs)}
    ${walletCards()}
    <section class="card cash-card">
      <span class="tile-head"><span class="overline">Cash flow · ${esc(cycleName)}</span></span>
      <strong class="cash-net ${plan.income - plan.expense < 0 ? 'neg' : ''}">${plan.income - plan.expense < 0 ? '−' : ''}${nb(Math.abs(plan.income - plan.expense))}</strong>
      <div class="flow-pair">
        ${flowStat('+', 'Income', nb(plan.income))}
        ${flowStat('−', 'Spending', nb(plan.expense))}
      </div>
    </section>
    ${scheduled}
    <section class="gap-sm">${goalTile}</section>
    <section class="gap-xl">
      ${sectionTitle('Recent', '<button class="link" data-action="open-view" data-view="transactions">See all</button>')}
      ${txs.length ? txListByDay(txs, { limit: 5, showMore: false }) : '<p class="empty">No transactions yet. Tap <strong>+</strong> to add one.</p>'}
    </section>`;
}

function renderWallets() {
  const { balances } = computed();
  const wallets = state.data.wallets || [];
  const worth = netWorth(balances);
  const groups = groupWallets(wallets, balances);
  const list = groups.map((group) => `
    <h3 class="group-title"><span>${walletIcon(group.type)} ${esc(group.type)}</span>${group.wallets.length > 1 ? `<span class="${group.total < 0 ? 'neg' : ''}">${esc(money(group.total))}</span>` : ''}</h3>
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
    <section class="hero-block">
      <p class="overline">Net worth</p>
      <p class="display ${worth.net < 0 ? 'neg' : ''}">${bigMoney(worth.net)}</p>
      <p class="hero-sub">Assets ${nb(worth.assets)} · Debts ${nb(worth.debts)}</p>
    </section>
    <section class="gap-lg">
      ${list || '<p class="empty">No wallets yet. Add your first one below.</p>'}
    </section>
    <button class="btn-secondary" data-action="add-wallet">+ New wallet</button>
    <p class="hint small">Tap a wallet to see its card, adjust its balance, restyle it or remove it.</p>`;
}

function renderMore() {
  const active = recurringItems().filter((r) => r.active).length;
  const goals = (state.data.goals || []).length;
  const rows = [
    ['open-view', 'transactions', ICONS.transactions, 'Transactions', 'Search, filter and export'],
    ['open-view', 'recurring', ICONS.repeat, 'Recurring', recurringItems().length ? `${active} active` : 'Rent, subscriptions, salary…'],
    ['plan', 'goals', ICONS.goal, 'Goals', goals ? `${goals} saving goal${goals === 1 ? '' : 's'}` : 'Save for something'],
    ['cycle', '', ICONS.calendar, 'Pay cycle', cycleSummary()],
    ['settings', '', ICONS.settings, 'Settings', 'Connection, currency, decimals'],
  ];
  return `
    <ul class="card list menu">
      ${rows.map(([action, value, icon, label, sub]) => `
        <li>
          <button class="row menu-row" data-action="${action}" data-view="${value}" data-plan="${value}">
            <span class="menu-ico">${icon}</span>
            <span class="menu-text"><span class="row-label">${label}</span><span class="muted small">${esc(sub)}</span></span>
            <span class="row-chevron">${ICONS.chevron}</span>
          </button>
        </li>`).join('')}
    </ul>
    <section class="gap-lg">${appearancePicker()}</section>
    <p class="hint small">WhatTheFund ${APP_VERSION}</p>`;
}

function renderRecurring() {
  const items = [...recurringItems()].sort((a, b) => (a.active === b.active ? a.nextDate.localeCompare(b.nextDate) : a.active ? -1 : 1));
  if (!items.length) {
    return `
      <section class="card empty-card">
        <p class="empty-icon">${icon('repeat')}</p>
        <h2>Nothing repeats yet</h2>
        <p class="muted">Rent, subscriptions, a salary: set it once and it's added to your transactions on the day, every day, week, month or year.</p>
        <button class="btn-primary" data-action="new-recurring">New recurring item</button>
      </section>`;
  }
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 31);
  let out = 0;
  let inc = 0;
  for (const item of items.filter((r) => r.active)) {
    const count = occurrences(item, horizon).length;
    if (item.type === EXPENSE) out += count * item.amount;
    if (item.type === INCOME) inc += count * item.amount;
  }
  const row = (item) => {
    const title = item.type === TRANSFER ? 'Transfer' : item.note || item.subcategory || item.category;
    const iconHtml = item.type === TRANSFER ? icon('arrows-left-right') : categoryIcon(item.category);
    const cls = item.type === EXPENSE ? 'neg' : item.type === INCOME ? 'pos' : 'neutral';
    const sign = item.type === EXPENSE ? '−' : item.type === INCOME ? '+' : '';
    const next = item.nextDate ? new Date(`${item.nextDate}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
    const where = item.type === TRANSFER ? `${esc(item.wallet)} → ${esc(item.toWallet)}` : esc(item.wallet);
    return `
      <li class="card recur ${item.active ? '' : 'paused'}">
        <button class="recur-main" data-action="edit-recurring" data-id="${item.id}" aria-label="Edit ${esc(title)}">
          <span class="tx-icon ${item.type.toLowerCase()}">${iconHtml}</span>
          <span class="tx-main">
            <span class="tx-title">${esc(title)}</span>
            <span class="tx-detail">${esc(FREQUENCY_NAMES[item.frequency] || item.frequency)} · ${where}</span>
          </span>
          <span class="tx-side"><span class="amount ${cls}">${sign}${esc(money(item.amount))}</span></span>
        </button>
        <div class="goal-foot">
          <span class="muted small">${item.active ? `Next: ${esc(next)}` : 'Paused'}</span>
          <button class="pill-btn" data-action="toggle-recurring" data-id="${item.id}">${item.active ? 'Pause' : 'Resume'}</button>
        </div>
      </li>`;
  };
  return `
    <section class="card cash-card">
      <span class="tile-head"><span class="overline">Next 30 days</span></span>
      <div class="flow-pair">
        ${flowStat('+', 'Coming in', nb(inc))}
        ${flowStat('−', 'Going out', nb(out))}
      </div>
    </section>
    <ul class="goal-list gap-lg">${items.map(row).join('')}</ul>
    <button class="btn-secondary" data-action="new-recurring">+ New recurring item</button>
    <p class="hint small">Items are added to your transactions on their day, also when you haven't opened the app.</p>`;
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
        <p class="empty-icon">${icon('target')}</p>
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
        <p class="empty-icon">${icon('flag')}</p>
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
            <span class="muted small">${g.wallet ? `${walletIcon(wallets.get(g.wallet))} Follows ${esc(g.wallet)}` : `${icon('pencil-simple')} Updated by you`}</span>
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
        ${flowStat('+', 'Income', nb(totals.income))}
        <div class="stat">${flowStat('−', 'Spending', nb(totals.expense))}${delta}</div>
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
    pills.push(['range', '', `${icon('calendar-blank')} ${esc(label)}`, label]);
  }
  f.wallets.forEach((w) => pills.push(['wallet', w, esc(w), w]));
  f.categories.forEach((c) => pills.push(['category', c, `${categoryIcon(c)} ${esc(c)}`, c]));
  if (Number(f.min) > 0 || Number(f.max) > 0) {
    const label = f.min && f.max ? `${money(f.min)} – ${money(f.max)}` : f.min ? `≥ ${money(f.min)}` : `≤ ${money(f.max)}`;
    pills.push(['amount', '', esc(label), label]);
  }
  if (!pills.length) return '';
  return `<div class="pills">${pills.map(([kind, value, html, label]) => `
    <button class="pill" data-action="remove-filter" data-kind="${kind}" data-v="${esc(value)}" aria-label="Remove filter ${esc(label)}">${html}${ICONS.close}</button>`).join('')}
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
        ${flowStat('−', 'Out', nb(s.out))}
        ${flowStat('+', 'In', nb(s.in))}
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
  const cycle = periodOf(new Date());
  const flow = walletFlow(name, inMonth(mine, cycle.year, cycle.month));
  const balance = balances.get(name) || 0;
  const style = parseCard(wallet?.card, type);
  return `
    <section class="wallet-head">
      ${cardHtml({
        title: name,
        kicker: type,
        caption: balance < 0 ? 'Owed' : 'Balance',
        amountHtml: bigMoney(balance),
        footHtml: esc(style.label),
        style,
        tag: 'div',
        negative: balance < 0,
      })}
      <div class="card wallet-flow">
        ${flowStat('+', 'Income', nb(flow.moneyIn))}
        ${flowStat('−', 'Expense', nb(flow.moneyOut))}
      </div>
      ${wallet ? `<p class="muted small wallet-opening">Opening balance ${esc(money(wallet.openingBalance))}</p>` : ''}
    </section>
    <section class="gap-lg">
      ${sectionTitle('Transactions', `<span class="muted small">${mine.length}</span>`)}
      ${txListByDay(mine, { perspective: name })}
    </section>
`;
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
            <option value="0" ${decimals() === 2 ? '' : 'selected'}>0 (25.000)</option>
            <option value="2" ${decimals() === 2 ? 'selected' : ''}>2 (25,00)</option>
          </select>
        </label>
      </div>
      <p id="form-status" class="form-status" role="status"></p>
      <button type="submit" class="btn-primary">${firstRun ? 'Connect' : 'Save & test connection'}</button>
    </form>`;
}

function appearancePicker() {
  return `
    <section>
      ${sectionTitle('Appearance')}
      <div class="segmented three" role="radiogroup" aria-label="Appearance">
        ${[['auto', 'Match iPhone'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => `
          <button type="button" class="seg ${appearance === v ? 'active' : ''}" data-action="appearance" data-v="${v}" role="radio" aria-checked="${appearance === v}">${label}</button>`).join('')}
      </div>
    </section>`;
}

function renderSettings() {
  return `
    ${appearancePicker()}
    <section class="gap-lg">
      ${sectionTitle('Pay cycle')}
      <ul class="card list"><li><button class="row" data-action="cycle"><span class="row-label">Month starts</span><span class="row-value">${esc(cycleSummary())}</span><span class="row-chevron">${ICONS.chevron}</span></button></li></ul>
    </section>
    <section class="gap-lg">${sectionTitle('Connection')}</section>
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
      <h1>WhatThe<br><em>Fund</em></h1>
      <p class="muted">Connect to your Google Sheet using the Apps Script URL and API key. They're saved on this device only.</p>
      ${settingsForm({ firstRun: true })}
      <a class="btn-secondary" href="?demo">Preview with sample data</a>
    </main>`;
}

// ---------- layout ----------

const app = document.getElementById('app');

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

const userName = () => storage.get(KEYS.name) || 'Syu';

function editName() {
  const answer = prompt('What should the app call you?', userName());
  if (answer === null) return;
  const name = answer.replace(/\s+/g, ' ').trim().slice(0, 20);
  storage.set(KEYS.name, name || 'Syu');
  renderHeader();
}

function titleText() {
  if (typeof state.view === 'string') return VIEW_TITLES[state.view];
  if (state.view?.wallet) return state.view.wallet;
  return TAB_TITLES[state.tab];
}

/** "Night, Syu": the name is a button that lets you change it. */
function titleHtml() {
  if (state.view === null && state.tab === 'home') {
    return `${esc(greeting())}, <button class="name-btn" data-action="edit-name" aria-label="Your name: ${esc(userName())}. Tap to change.">${esc(userName())}</button>`;
  }
  return esc(titleText());
}

function statusText() {
  if (isDemo) return 'Sample data';
  if (state.loading) return 'Updating…';
  if (state.error) return 'Not updated';
  if (state.fetchedAt) return `Updated ${timeAgo(state.fetchedAt)}`;
  return 'Not updated yet';
}

/** A check mark next to the title: blue when your data is up to date, grey when it isn't (updating, offline, error). */
function syncMark() {
  const ok = isDemo || (!!state.fetchedAt && !state.error && !state.loading);
  const label = statusText();
  return `<span class="sync ${ok ? 'ok' : ''} ${state.loading ? 'busy' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${ICONS.check}</span>`;
}

/** What the ⋯ menu at the top right offers on the current screen (none → no button). */
function menuItems() {
  if (!state.data) return [];
  const wallet = state.view?.wallet;
  if (wallet) {
    if (!(state.data.wallets || []).some((w) => w.name === wallet)) return [];
    const attrs = `data-name="${esc(wallet)}"`;
    return [
      ['adjust-balance', attrs, ICONS.refresh, 'Adjust balance'],
      ['customize-card', attrs, ICONS.palette, 'Customize card'],
      ['remove-wallet', attrs, ICONS.trash, 'Remove wallet', true],
    ];
  }
  if (state.view === 'transactions') return [['open-filters', '', ICONS.filter, 'Filters'], ['export', '', ICONS.share, 'Export as CSV']];
  if (state.view === 'recurring') return [['new-recurring', '', ICONS.plus, 'New recurring item']];
  if (state.view !== null) return [];
  if (state.tab === 'wallets') return [['add-wallet', '', ICONS.plus, 'New wallet']];
  if (state.tab === 'budgets') return [['edit-budgets', '', ICONS.budgets, 'Edit budgets'], ['add-goal', '', ICONS.goal, 'New goal']];
  if (state.tab === 'home') return [['edit-budgets', '', ICONS.budgets, 'Edit budgets'], ['add-goal', '', ICONS.goal, 'New goal'], ['cycle', '', ICONS.calendar, 'Pay cycle']];
  return [];
}

function headerHtml() {
  const inner = state.view !== null;
  const items = menuItems();
  if (!items.length) state.menu = false;
  return `
    <div class="topbar-row">
      ${inner ? `<button class="icon-btn back" data-action="back" aria-label="Back">${ICONS.back}</button>` : ''}
      <div class="titles">
        <h1>${titleHtml()}${syncMark()}</h1>
      </div>
      <span class="hdr-loader ${state.loading ? 'on' : ''}" aria-hidden="true">${ICONS.refresh}</span>
      ${items.length ? `<button class="icon-btn menu-btn ${state.menu ? 'open' : ''}" data-action="toggle-menu" aria-label="More options" aria-expanded="${state.menu}">${ICONS.more}</button>` : ''}
    </div>
    ${state.menu && items.length ? `
    <div class="menu-pop" role="menu">
      ${items.map(([action, attrs, icon, label, danger]) => `<button role="menuitem" class="menu-item ${danger ? 'danger' : ''}" data-action="${action}" ${attrs}>${icon}<span>${label}</span></button>`).join('')}
    </div>` : ''}
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
  if (state.view === 'transactions') return renderTransactions();
  if (state.view === 'recurring') return renderRecurring();
  if (state.tab === 'wallets') return renderWallets();
  if (state.tab === 'budgets') return renderPlan();
  if (state.tab === 'reports') return renderReports();
  if (state.tab === 'more') return renderMore();
  return renderHome();
}

function tabButton(tab) {
  const active = state.tab === tab; // the tab you came from stays lit while you look at a wallet, search or settings
  return `<button class="tab ${active ? 'active' : ''}" data-action="tab" data-tab="${tab}" ${active && state.view === null ? 'aria-current="page"' : ''}>${ICONS[tab]}<span>${TAB_TITLES[tab]}</span></button>`;
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
      // The first frame's timestamp can be slightly earlier than `start`; never let progress go below 0
      const t = Math.min(1, Math.max(0, (now - start) / duration));
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
    <div class="bottom-block" aria-hidden="true"></div>
    <button class="fab" data-action="add" aria-label="Add transaction" ${state.data ? '' : 'disabled'}>${ICONS.plus}</button>
    <nav class="tabbar" aria-label="Main">${TABS.map(tabButton).join('')}</nav>`;
  setupCarousel();
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
  if (state.menu && !event.target.closest('.menu-pop, [data-action="toggle-menu"]')) { state.menu = false; renderHeader(); return; } // tap outside closes the menu
  const target = event.target.closest('[data-action]');
  if (!target) { closeSwipes(); return; }
  const action = target.dataset.action;
  if (state.menu && action !== 'toggle-menu') { state.menu = false; renderHeader(); } // choosing an item closes it

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
  } else if (action === 'toggle-theme') {
    setAppearance(isDark() ? 'light' : 'dark');
  } else if (action === 'appearance') {
    setAppearance(target.dataset.v);
  } else if (action === 'customize-card') {
    openCard(target.dataset.name);
  } else if (action === 'adjust-balance') {
    openBalance(target.dataset.name);
  } else if (action === 'add-goal') {
    openGoal();
  } else if (action === 'edit-goal') {
    openGoal(target.dataset.name);
  } else if (action === 'add-money') {
    const goal = findGoal(target.dataset.name);
    if (goal) openAddMoneySheet({ goal, money, onSave: saveGoal });
  } else if (action === 'toggle-menu') {
    state.menu = !state.menu;
    renderHeader();
  } else if (action === 'edit-name') {
    editName();
  } else if (action === 'open-view') {
    openView(target.dataset.view);
  } else if (action === 'open-search') {
    openView('transactions');
    document.getElementById('search')?.focus();
  } else if (action === 'open-filters-home') {
    openView('transactions');
    openFilters();
  } else if (action === 'dot') {
    showCard(Number(target.dataset.i));
  } else if (action === 'add-wallet') {
    openNewWallet();
  } else if (action === 'remove-wallet') {
    removeWallet(target.dataset.name);
  } else if (action === 'new-recurring') {
    openRecurring();
  } else if (action === 'edit-recurring') {
    openRecurring(Number(target.dataset.id));
  } else if (action === 'toggle-recurring') {
    toggleRecurring(Number(target.dataset.id)).catch((error) => toast(`Couldn't save: ${error.message}`));
  } else if (action === 'cycle') {
    openCycle();
  } else if (action === 'plan') {
    state.plan = target.dataset.plan;
    if (state.tab !== 'budgets' || state.view !== null) goTab('budgets');
    else { state.animate = true; render(); }
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

// ---------- pull down to refresh, and swipe in from a screen edge for back / forward ----------

const PULL_AT = 56;
let pull = null;
let edge = null;
const noGesture = () => document.body.classList.contains('sheet-open');

const loaderEl = () => document.querySelector('.hdr-loader');

/** While you pull, the loader at the top right turns with your finger; it spins once you let go (see syncMark / headerHtml). */
function showPull(distance) {
  const el = loaderEl();
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = distance > 4 ? String(Math.min(1, distance / PULL_AT)) : '0';
  el.style.transform = `rotate(${distance * 5}deg)`;
  el.classList.toggle('ready', distance >= PULL_AT);
}
function endPull() {
  const el = loaderEl();
  if (el) { el.style.transition = ''; el.style.opacity = ''; el.style.transform = ''; el.classList.remove('ready'); }
  pull = null;
}

window.addEventListener('touchstart', (event) => {
  const t = event.touches[0];
  pull = event.touches.length === 1 && window.scrollY <= 0 && !noGesture() && state.data ? { x: t.clientX, y: t.clientY, d: 0 } : null;
  const fromEdge = event.touches.length === 1 && !noGesture() && (t.clientX <= 22 || t.clientX >= window.innerWidth - 22);
  edge = fromEdge ? { x: t.clientX, y: t.clientY, left: t.clientX <= 22 } : null;
  if (edge) pull = null;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (!pull) return;
  const t = event.touches[0];
  const dx = t.clientX - pull.x;
  const dy = t.clientY - pull.y;
  if (window.scrollY > 0 || dy <= 0 || Math.abs(dx) > dy) { if (pull.d) endPull(); else pull = null; return; }
  pull.d = Math.min(96, dy * 0.5);
  showPull(pull.d);
}, { passive: true });

window.addEventListener('touchend', (event) => {
  if (pull) {
    const go = pull.d >= PULL_AT;
    endPull();
    if (go) { if (isDemo) toast('Sample data is always up to date'); else refresh(); }
  }
  if (edge) {
    const t = event.changedTouches[0];
    const dx = t.clientX - edge.x;
    const dy = t.clientY - edge.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
      if (edge.left && dx > 0 && state.view !== null) history.back();     // from the left edge: back
      else if (!edge.left && dx < 0) history.forward();                    // from the right edge: forward (if there is one)
    }
    edge = null;
  }
}, { passive: true });
window.addEventListener('touchcancel', () => { endPull(); edge = null; }, { passive: true });

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
if (startTab === 'transactions' || startTab === 'recurring') state.view = startTab;
if (startHash === 'goals') state.plan = 'goals';

// A link straight to a screen (#transactions) still gets a Home entry behind it, so Back and the tabs work
history.replaceState({ view: null }, '');
if (state.view) history.pushState({ view: state.view }, '');
render();
refresh();
if (startHash === 'add') openEntry();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When a new version has finished downloading and takes over, reload once so you see it right away
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || document.body.classList.contains('sheet-open')) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
}
