// Pure calculation and formatting helpers — no DOM access, so they can be tested in Node.
// The rules mirror the Telegram bot (bot/bot.py) so both always show the same numbers.

export const EXPENSE = 'Expense';
export const INCOME = 'Income';
export const TRANSFER = 'Transfer';

// Order of wallet groups in the overview; unknown types are listed after these
export const WALLET_TYPES = ['Bank', 'Cash', 'E-wallet', 'Credit Card', 'Savings', 'Investment', 'Stock', 'Other'];

const WALLET_ICONS = {
  bank: '🏦', cash: '💵', 'e-wallet': '📱', 'credit card': '💳',
  savings: '🐷', investment: '📈', stock: '📈',
};

export function walletIcon(type) {
  return WALLET_ICONS[String(type || '').toLowerCase()] || '👛';
}

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

/** Wallets grouped by type with subtotals: [{type, icon, total, wallets: [{name, type, balance}]}]. */
export function groupWallets(wallets, balances) {
  const groups = new Map();
  for (const w of wallets) {
    const type = w.type || 'Other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({ name: w.name, type, balance: balances.get(w.name) || 0 });
  }
  const rank = (type) => {
    const i = WALLET_TYPES.findIndex((t) => t.toLowerCase() === type.toLowerCase());
    return i === -1 ? WALLET_TYPES.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      icon: walletIcon(type),
      total: list.reduce((sum, w) => sum + w.balance, 0),
      wallets: list,
    }));
}

export function inMonth(transactions, year, month) {
  return transactions.filter((tx) => tx.when.getFullYear() === year && tx.when.getMonth() === month);
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
  const days = daysInMonth(year, month);
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());
  const daysLeft = isCurrent ? days - now.getDate() + 1 : isPast ? 0 : days;

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
  const isCurrent = now.getFullYear() === year && now.getMonth() === month;
  const days = isCurrent ? now.getDate() : daysInMonth(year, month);

  const expenses = monthTxs.filter((tx) => tx.type === EXPENSE);
  const byWeekday = new Array(7).fill(0);
  for (const tx of expenses) byWeekday[tx.when.getDay()] += tx.amount;
  const busiest = byWeekday.indexOf(Math.max(...byWeekday));
  const biggest = expenses.reduce((max, tx) => (!max || tx.amount > max.amount ? tx : max), null);

  // Compare spending with the same number of days last month when this month isn't finished
  let prevComparable = prevTotals.expense;
  if (isCurrent) {
    const cutoff = new Date(prev.getFullYear(), prev.getMonth(), Math.min(now.getDate(), daysInMonth(prev.getFullYear(), prev.getMonth())), 23, 59);
    prevComparable = monthTotals(inMonth(transactions, prev.getFullYear(), prev.getMonth()).filter((tx) => tx.when <= cutoff)).expense;
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

/** 1500000 → "1.5M", 250000 → "250K", 900 → "900". */
export function compactNumber(value) {
  const abs = Math.abs(value);
  const fmt = (n, suffix) => `${Number(n.toFixed(n < 10 ? 1 : 0))}${suffix}`;
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

export function formatMoney(value, { currency = '', decimals = 0 } = {}) {
  const number = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = value < 0 ? '-' : '';
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
