// Pure calculation and formatting helpers — no DOM access, so they can be tested in Node.
// The rules mirror the Telegram bot (bot/bot.py) so both always show the same numbers.

export const EXPENSE = 'Expense';
export const INCOME = 'Income';
export const TRANSFER = 'Transfer';

// Order of wallet groups in the overview; unknown types are listed after these
export const WALLET_TYPES = ['Bank', 'Cash', 'E-wallet', 'Credit Card', 'Savings', 'Investment', 'Stock', 'Other'];

/** "2026-11-06 14:30" → Date in the phone's local time (Safari can't parse this format itself). */
export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(text || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** Date → "2026-11-06 14:30" (the format stored in the sheet). */
export function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Adds a parsed `when` Date to every transaction and sorts newest first. */
export function prepareTransactions(transactions) {
  return transactions
    .map((tx) => ({ ...tx, when: parseDate(tx.date) }))
    .filter((tx) => tx.when)
    .sort((a, b) => b.when - a.when || b.id - a.id);
}

export function walletBalances(wallets, transactions) {
  const balances = new Map(wallets.map((w) => [w.name, w.openingBalance || 0]));
  const add = (name, amount) => balances.set(name, (balances.get(name) || 0) + amount);
  for (const tx of transactions) {
    if (tx.type === EXPENSE) add(tx.wallet, -tx.amount);
    else if (tx.type === INCOME) add(tx.wallet, tx.amount);
    else if (tx.type === TRANSFER) {
      add(tx.wallet, -tx.amount);
      add(tx.toWallet, tx.amount);
    }
  }
  return balances;
}

/** True when a wallet uses the default currency (it has none of its own, or the same one). Only those count in net worth, cash flow and budgets. */
export const isBaseWallet = (wallet, base = '') =>
  !wallet?.currency || String(wallet.currency).toLowerCase() === String(base).toLowerCase();

/** Wallets grouped by type; the subtotal counts only default-currency wallets: [{type, total, wallets: [{name, type, balance, currency, base}]}]. */
export function groupWallets(wallets, balances, base = '') {
  const groups = new Map();
  for (const w of wallets) {
    const type = w.type || 'Other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({ name: w.name, type, balance: balances.get(w.name) || 0, currency: w.currency || '', base: isBaseWallet(w, base) });
  }
  const rank = (type) => {
    const i = WALLET_TYPES.findIndex((t) => t.toLowerCase() === type.toLowerCase());
    return i === -1 ? WALLET_TYPES.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      total: list.filter((w) => w.base).reduce((sum, w) => sum + w.balance, 0),
      baseCount: list.filter((w) => w.base).length,
      wallets: list,
    }));
}

/**
 * Wallets grouped by currency: the default currency first, then every other currency A–Z.
 * [{currency, base, total, wallets: [{name, type, card, balance, currency}]}], wallets in sheet order.
 */
export function groupByCurrency(wallets, balances, base = '') {
  const groups = new Map();
  for (const w of wallets) {
    const isBase = isBaseWallet(w, base);
    const currency = isBase ? base : String(w.currency).toUpperCase();
    if (!groups.has(currency)) groups.set(currency, { currency, base: isBase, total: 0, wallets: [] });
    const group = groups.get(currency);
    const balance = balances.get(w.name) || 0;
    group.wallets.push({ name: w.name, type: w.type || 'Other', card: w.card || '', balance, currency: w.currency || '' });
    group.total += balance;
  }
  return [...groups.values()].sort((a, b) => (a.base === b.base ? a.currency.localeCompare(b.currency) : a.base ? -1 : 1));
}

// ---------- pay cycle ----------
// A "month" runs from payday to the day before the next payday (set in Settings; the Telegram bot uses the same).
// Payday 1 is the calendar month. Otherwise the cycle is named after the month it ends in, so with payday 25
// "December" is 25 Nov – 24 Dec: the pay that arrives on 25 Nov funds December. With "weekdays only" on, a payday
// that lands on a weekend moves to the Friday before.

const DAY = 86400000;
let cycle = { day: 1, weekdays: false };

/** Sets the pay cycle from the sheet's settings: {payday: 1–31, paydayWeekdays: boolean}. */
export function setPayCycle({ payday = 1, paydayWeekdays = false } = {}) {
  const day = Math.round(Number(payday));
  cycle = { day: day >= 1 && day <= 31 ? day : 1, weekdays: !!paydayWeekdays };
}
export const isCustomCycle = () => cycle.day !== 1 || cycle.weekdays;

/** The date a cycle starts in calendar month `month` (0–11; may overflow into other years). */
function paydayOn(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  const date = new Date(year, month, Math.min(cycle.day, last));
  if (cycle.weekdays) {
    const weekday = date.getDay();
    if (weekday === 6) date.setDate(date.getDate() - 1);
    else if (weekday === 0) date.setDate(date.getDate() - 2);
  }
  return date;
}

/** {start, end} (end exclusive) of the cycle named `year`/`month`. */
export function periodBounds(year, month) {
  return cycle.day === 1
    ? { start: paydayOn(year, month), end: paydayOn(year, month + 1) }
    : { start: paydayOn(year, month - 1), end: paydayOn(year, month) };
}

/** {year, month} of the cycle that contains `date`. */
export function periodOf(date = new Date()) {
  for (const delta of [0, 1, -1]) {
    const d = new Date(date.getFullYear(), date.getMonth() + delta, 1);
    const { start, end } = periodBounds(d.getFullYear(), d.getMonth());
    if (date >= start && date < end) return { year: d.getFullYear(), month: d.getMonth() };
  }
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function periodDays(year, month) {
  const { start, end } = periodBounds(year, month);
  return Math.round((end - start) / DAY);
}

/** "25 Oct – 24 Nov" (only meaningful when the cycle isn't the calendar month). */
export function periodRange(year, month) {
  const { start, end } = periodBounds(year, month);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(last)}`;
}

export function inMonth(transactions, year, month) {
  const { start, end } = periodBounds(year, month);
  return transactions.filter((tx) => tx.when >= start && tx.when < end);
}

export function monthTotals(transactions) {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (tx.type === INCOME) income += tx.amount;
    else if (tx.type === EXPENSE) expense += tx.amount;
  }
  return { income, expense, net: income - expense };
}

/** Totals per category (largest first) with subcategory breakdown, for Expense or Income. */
export function byCategory(transactions, type) {
  const categories = new Map();
  let grand = 0;
  for (const tx of transactions) {
    if (tx.type !== type) continue;
    const name = tx.category || 'Uncategorized';
    if (!categories.has(name)) categories.set(name, { category: name, total: 0, subs: new Map() });
    const entry = categories.get(name);
    entry.total += tx.amount;
    const sub = tx.subcategory || 'General';
    entry.subs.set(sub, (entry.subs.get(sub) || 0) + tx.amount);
    grand += tx.amount;
  }
  return [...categories.values()]
    .sort((a, b) => b.total - a.total)
    .map((c) => ({
      category: c.category,
      total: c.total,
      share: grand ? c.total / grand : 0,
      subs: [...c.subs.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    }));
}

/** [{category, limit, spent, fraction}] for the given month's transactions. */
export function budgetProgress(budgets, monthTransactions) {
  const spent = new Map(byCategory(monthTransactions, EXPENSE).map((c) => [c.category, c.total]));
  return Object.entries(budgets || {}).map(([category, limit]) => {
    const used = spent.get(category) || 0;
    return { category, limit, spent: used, fraction: limit ? used / limit : 0 };
  });
}

/** Money in/out of one wallet within the given transactions (transfers count both ways). */
export function walletFlow(name, transactions) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const tx of transactions) {
    if ((tx.type === INCOME && tx.wallet === name) || (tx.type === TRANSFER && tx.toWallet === name)) moneyIn += tx.amount;
    if ((tx.type === EXPENSE || tx.type === TRANSFER) && tx.wallet === name) moneyOut += tx.amount;
  }
  return { moneyIn, moneyOut };
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The "left to spend" number for a month (MoneyCoach's "left in your plan" + Spendee's daily allowance).
 * With budgets: total budget limits minus what was spent in those categories.
 * Without budgets: income minus spending.
 */
export function monthPlan(budgets, monthTransactions, year, month, now = new Date()) {
  const totals = monthTotals(monthTransactions);
  const progress = budgetProgress(budgets, monthTransactions);
  const days = periodDays(year, month);
  const { start, end } = periodBounds(year, month);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isCurrent = now >= start && now < end;
  const isPast = now >= end;
  const daysLeft = isCurrent ? Math.round((end - midnight) / DAY) : isPast ? 0 : days;

  let mode, total, used;
  if (progress.length) {
    mode = 'budget';
    total = progress.reduce((sum, b) => sum + b.limit, 0);
    used = progress.reduce((sum, b) => sum + b.spent, 0);
  } else {
    mode = 'income';
    total = totals.income;
    used = totals.expense;
  }
  const left = total - used;
  return {
    mode, total, used, left, daysLeft, ...totals,
    perDay: daysLeft > 0 ? Math.max(0, left) / daysLeft : 0,
    fraction: total > 0 ? used / total : used > 0 ? 1 : 0,
    budgets: progress,
  };
}

/**
 * Stable chart colours: the first 7 expense categories in the sheet's order get slots 1–7,
 * the rest share "Other". Colour follows the category, never its rank, so it's the same every month.
 */
export const COLOR_SLOTS = 7;
export function categorySlots(expenseCategoryNames) {
  const slots = new Map();
  expenseCategoryNames.slice(0, COLOR_SLOTS).forEach((name, i) => slots.set(name, i + 1));
  return slots;
}

/**
 * Parts for the "where it went" segmented bar: the biggest coloured categories (up to `maxParts`),
 * everything else folded into "Other". Each part: {name, total, share, slot (0 = Other)}.
 */
export function spendingParts(transactions, slots, maxParts = 5) {
  const categories = byCategory(transactions, EXPENSE);
  const total = categories.reduce((sum, c) => sum + c.total, 0);
  if (!total) return [];
  const parts = [];
  let other = 0;
  for (const c of categories) {
    const slot = slots.get(c.category);
    if (slot && parts.length < maxParts && c.share >= 0.03) parts.push({ name: c.category, total: c.total, share: c.share, slot });
    else other += c.total;
  }
  if (other > 0) parts.push({ name: 'Other', total: other, share: other / total, slot: 0 });
  return parts;
}

/** Income and expenses for `count` months ending with (year, month), oldest first. */
export function cashFlow(transactions, year, month, count = 6) {
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    const totals = monthTotals(inMonth(transactions, d.getFullYear(), d.getMonth()));
    result.push({ year: d.getFullYear(), month: d.getMonth(), ...totals });
  }
  return result;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Spendee-style insights for one month, compared with the month before. */
export function monthInsights(transactions, year, month, now = new Date()) {
  const monthTxs = inMonth(transactions, year, month);
  const prev = new Date(year, month - 1, 1);
  const prevTotals = monthTotals(inMonth(transactions, prev.getFullYear(), prev.getMonth()));
  const totals = monthTotals(monthTxs);
  const bounds = periodBounds(year, month);
  const isCurrent = now >= bounds.start && now < bounds.end;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = isCurrent ? Math.round((midnight - bounds.start) / DAY) + 1 : periodDays(year, month);

  const expenses = monthTxs.filter((tx) => tx.type === EXPENSE);
  const byWeekday = new Array(7).fill(0);
  for (const tx of expenses) byWeekday[tx.when.getDay()] += tx.amount;
  const busiest = byWeekday.indexOf(Math.max(...byWeekday));
  const biggest = expenses.reduce((max, tx) => (!max || tx.amount > max.amount ? tx : max), null);

  // Compare spending with the same number of days last month when this month isn't finished
  let prevComparable = prevTotals.expense;
  if (isCurrent) {
    const before = periodBounds(prev.getFullYear(), prev.getMonth()).start;
    const cutoff = new Date(before.getFullYear(), before.getMonth(), before.getDate() + days);
    prevComparable = monthTotals(inMonth(transactions, prev.getFullYear(), prev.getMonth()).filter((tx) => tx.when < cutoff)).expense;
  }

  return {
    count: monthTxs.length,
    avgPerDay: totals.expense / days,
    busiestDay: expenses.length ? { name: WEEKDAYS[busiest], total: byWeekday[busiest] } : null,
    biggest,
    previousMonth: prev,
    expenseChange: prevComparable > 0 ? totals.expense / prevComparable - 1 : null,
    comparedToDate: isCurrent,
  };
}

/** Rounds an axis maximum up to a clean number (1, 1.5, 2, 3, 4, 5, 6, 8 × 10ⁿ) — halves stay clean too. */
export function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

/** 1500000 → "1,5M", 250000 → "250K", 900 → "900" (decimal comma, matching formatNumber). */
export function compactNumber(value) {
  const abs = Math.abs(value);
  const fmt = (n, suffix) => `${String(Number(n.toFixed(n < 10 ? 1 : 0))).replace('.', ',')}${suffix}`;
  if (abs >= 1e9) return fmt(value / 1e9, 'B');
  if (abs >= 1e6) return fmt(value / 1e6, 'M');
  if (abs >= 1e3) return fmt(value / 1e3, 'K');
  return String(Math.round(value));
}

/** What you own (positive balances) minus what you owe (negative balances, e.g. credit cards). */
export function netWorth(balances) {
  let assets = 0;
  let debts = 0;
  for (const value of balances.values()) {
    if (value >= 0) assets += value;
    else debts -= value;
  }
  return { assets, debts, net: assets - debts };
}

/**
 * Indonesian number style: dots between thousands, a comma for decimals.
 * 3156000 → "3.156.000", 12.5 (2 decimals) → "12,50". Done by hand so every phone shows the same.
 */
export function formatNumber(value, decimals = 0) {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (value < 0 && Number(whole + (fraction || '')) !== 0 ? '-' : '') + grouped + (fraction ? `,${fraction}` : '');
}

/** Splits a formatted amount into the whole part ("12.345") and the decimals ("50", or "" when there are none). */
export function splitNumber(value, decimals = 0) {
  const [whole, fraction = ''] = formatNumber(Math.abs(value), decimals).replace('-', '').split(',');
  return { whole, fraction };
}

export function formatMoney(value, { currency = '', decimals = 0 } = {}) {
  const number = formatNumber(Math.abs(value), decimals);
  const sign = value < 0 && /[1-9]/.test(number) ? '-' : ''; // never "-0"
  return currency ? `${sign}${currency} ${number}` : `${sign}${number}`;
}

/** "Today", "Yesterday", or e.g. "Thu, 5 Nov" (plus the year if it's not this year). */
export function dayLabel(date, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('en-GB', options);
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(timestamp, now = Date.now()) {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---------- savings goals ----------

/** Whole months from `now` until a "YYYY-MM-DD" date (at least 1 while the date is ahead; 0 once passed). */
export function monthsUntil(isoDate, now = new Date()) {
  const target = parseDate(isoDate);
  if (!target) return null;
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59);
  if (end < now) return 0;
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months - (target.getDate() < now.getDate() ? 1 : 0));
}

/**
 * Progress of one goal. A goal linked to a wallet uses that wallet's balance (Monarch-style);
 * otherwise the "saved" amount you keep up to date yourself.
 */
export function goalProgress(goal, balances, now = new Date()) {
  const current = goal.wallet ? Math.max(0, balances.get(goal.wallet) || 0) : goal.saved || 0;
  const remaining = Math.max(0, goal.target - current);
  const reached = remaining === 0;
  const monthsLeft = goal.targetDate ? monthsUntil(goal.targetDate, now) : null;
  return {
    ...goal,
    current,
    remaining,
    reached,
    fraction: goal.target > 0 ? Math.min(1, current / goal.target) : 0,
    monthsLeft,
    overdue: !reached && monthsLeft === 0,
    perMonth: !reached && monthsLeft > 0 ? remaining / monthsLeft : null,
  };
}

// ---------- search & filters ----------

export const RANGES = [
  ['all', 'All time'], ['month', 'This month'], ['last-month', 'Last month'],
  ['3-months', 'Last 3 months'], ['year', 'This year'], ['custom', 'Custom'],
];

/** {start, end} (end exclusive) for a date-range preset, or null for "all time". */
export function rangeBounds(range, now = new Date(), from = '', to = '') {
  const y = now.getFullYear();
  const { year: py, month: pm } = periodOf(now); // "month" follows the pay cycle
  switch (range) {
    case 'month': return periodBounds(py, pm);
    case 'last-month': return periodBounds(py, pm - 1);
    case '3-months': return { start: periodBounds(py, pm - 2).start, end: periodBounds(py, pm).end };
    case 'year': return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
    case 'custom': {
      const start = parseDate(from);
      const endDay = parseDate(to);
      if (!start && !endDay) return null;
      return {
        start: start || new Date(1970, 0, 1),
        end: endDay ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1) : new Date(9999, 0, 1),
      };
    }
    default: return null;
  }
}

export const EMPTY_FILTERS = Object.freeze({ type: 'all', range: 'all', from: '', to: '', wallets: [], categories: [], min: '', max: '' });

/** Number of filters (besides the type chips and the search text) that are switched on. */
export function activeFilterCount(f) {
  return (f.range !== 'all' && rangeBounds(f.range, new Date(), f.from, f.to) ? 1 : 0)
    + (f.wallets.length ? 1 : 0) + (f.categories.length ? 1 : 0)
    + (Number(f.min) > 0 || Number(f.max) > 0 ? 1 : 0);
}

/**
 * Transactions matching the search text and filters.
 * The text matches notes, categories, subcategories, wallets, "#id", and amounts ("25000", "25k", "1.5m").
 */
export function filterTransactions(txs, query, f, now = new Date()) {
  const q = String(query || '').trim().toLowerCase();
  const qAmount = parseSearchAmount(q);
  const bounds = rangeBounds(f.range, now, f.from, f.to);
  const min = Number(f.min) || 0;
  const max = Number(f.max) || 0;
  return txs.filter((tx) => {
    if (f.type !== 'all' && tx.type !== f.type) return false;
    if (bounds && (tx.when < bounds.start || tx.when >= bounds.end)) return false;
    if (f.wallets.length && !f.wallets.includes(tx.wallet) && !f.wallets.includes(tx.toWallet)) return false;
    if (f.categories.length && !f.categories.includes(tx.category)) return false;
    if (min && tx.amount < min) return false;
    if (max && tx.amount > max) return false;
    if (!q) return true;
    if (qAmount !== null && tx.amount === qAmount) return true;
    return [tx.category, tx.subcategory, tx.note, tx.wallet, tx.toWallet, `#${tx.id}`, String(tx.amount)]
      .some((field) => String(field || '').toLowerCase().includes(q));
  });
}

/**
 * Reads an amount typed into search: "25000", "25.000", "1.500.000", "25k", "1,5m", "12,50".
 * Dots or commas followed by exactly three digits are thousands separators; otherwise a decimal point.
 */
export function parseSearchAmount(q) {
  const m = /^(\d[\d.,]*)\s*([km]?)$/.exec(q);
  if (!m) return null;
  const digits = m[1].replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.');
  const n = parseFloat(digits);
  if (!isFinite(n)) return null;
  return n * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
}

/** Count and money out / in for a list of transactions (transfers move money, so they count in neither). */
export function summarize(txs) {
  let out = 0;
  let income = 0;
  for (const tx of txs) {
    if (tx.type === EXPENSE) out += tx.amount;
    else if (tx.type === INCOME) income += tx.amount;
  }
  return { count: txs.length, out, in: income };
}

/** Transactions as CSV (same columns as the sheet), oldest first. */
export function toCsv(txs) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['ID', 'Date', 'Type', 'Amount', 'Wallet', 'To Wallet', 'Category', 'Subcategory', 'Note'];
  const lines = [...txs].reverse().map((t) => [t.id, t.date, t.type, t.amount, t.wallet, t.toWallet, t.category, t.subcategory, t.note].map(cell).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}

// ---------- recurring transactions ----------

export const FREQUENCY_NAMES = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

/** The day after `day` ('YYYY-MM-DD') for a frequency; same rule as the sheet's script (month-end days clamp: 31 → 28 Feb). */
export function advanceDay(day, frequency, anchor = 0) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  let date;
  if (frequency === 'daily') date = new Date(Date.UTC(y, m, d + 1));
  else if (frequency === 'weekly') date = new Date(Date.UTC(y, m, d + 7));
  else {
    const target = new Date(Date.UTC(y, m + (frequency === 'yearly' ? 12 : 1), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(anchor || d, last)));
  }
  return date.toISOString().slice(0, 10);
}

/** Dates ('YYYY-MM-DD') an active recurring item is due on from its next date up to, but not including, `until` (a Date). */
export function occurrences(item, until) {
  const stop = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`;
  const dates = [];
  let day = item.nextDate;
  for (let guard = 0; day && day < stop && guard < 400; guard++) {
    dates.push(day);
    day = advanceDay(day, item.frequency, item.day);
  }
  return dates;
}
