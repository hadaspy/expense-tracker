// Notifications: a reminder to add entries, a daily and a weekly insight, and a note for every entry that
// was added outside the app (Shortcuts, Telegram, the sheet). They are worked out here when the app opens
// or comes back to the front (a web app can't run in the background on iPhone), kept on this device, and
// shown behind the bell in the header.
//
// Everything in this file is plain logic (no screen, no storage), so it can be tested on its own.

export const DEFAULT_PREFS = { reminder: true, reminderTime: '20:00', daily: true, weekly: true, insightTime: '08:00', activity: true };
export const MAX_ITEMS = 40;
const ADJUST = 'Balance adjustment';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDay = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const nowMinutes = (now) => now.getHours() * 60 + now.getMinutes();
const dayOf = (tx) => String(tx.date).slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function expensesBetween(txs, from, to) {
  return txs.filter((t) => t.type === 'Expense' && dayOf(t) >= from && dayOf(t) <= to);
}
const total = (list) => list.reduce((sum, t) => sum + t.amount, 0);
function topCategory(list) {
  const by = new Map();
  for (const t of list) by.set(t.category || 'Uncategorized', (by.get(t.category || 'Uncategorized') || 0) + t.amount);
  const best = [...by].sort((a, b) => b[1] - a[1])[0];
  return best ? { name: best[0], amount: best[1] } : null;
}
const change = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** "Don't forget to add today's entries": only when nothing was added today (balance adjustments don't count). */
export function reminderFor(txs, now, prefs) {
  const today = dayKey(now);
  if (!prefs.reminder || nowMinutes(now) < minutes(prefs.reminderTime)) return null;
  if (txs.some((t) => dayOf(t) === today && t.category !== ADJUST)) return null;
  return {
    id: `reminder-${today}`, kind: 'reminder', title: 'Add today’s entries',
    body: 'Nothing is logged for today yet. Add what you spent or received so your numbers stay right.',
  };
}

/** Yesterday's spending: total, the biggest category and how it compares with a usual day. */
export function dailyInsight(txs, now, fmt) {
  const yesterday = dayKey(shiftDay(now, -1));
  const list = expensesBetween(txs, yesterday, yesterday);
  const sum = total(list);
  const usual = total(expensesBetween(txs, dayKey(shiftDay(now, -8)), dayKey(shiftDay(now, -2)))) / 7;
  let body;
  if (!list.length) {
    body = 'No expenses were logged yesterday. If you spent anything, add it now.';
  } else {
    const top = topCategory(list);
    const diff = change(sum, usual);
    body = `You spent ${fmt(sum)} yesterday (${plural(list.length, 'entry', 'entries')}). Biggest: ${top.name}, ${fmt(top.amount)}.`;
    if (diff !== null && Math.abs(diff) >= 5) body += ` That's ${Math.abs(diff)}% ${diff > 0 ? 'above' : 'below'} your usual day.`;
  }
  return { id: `daily-${yesterday}`, kind: 'daily', title: 'Yesterday’s spending', body };
}

/** The last full week (Monday to Sunday): spending, change from the week before, top category and income. */
export function weeklyInsight(txs, now, fmt) {
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
  const start = shiftDay(now, -weekday - 7);
  const from = dayKey(start), to = dayKey(shiftDay(start, 6));
  const list = expensesBetween(txs, from, to);
  const before = total(expensesBetween(txs, dayKey(shiftDay(start, -7)), dayKey(shiftDay(start, -1))));
  const income = total(txs.filter((t) => t.type === 'Income' && dayOf(t) >= from && dayOf(t) <= to));
  const sum = total(list);
  let body;
  if (!list.length) {
    body = 'No expenses were logged last week.';
  } else {
    const top = topCategory(list);
    const diff = change(sum, before);
    body = `You spent ${fmt(sum)} last week (${plural(list.length, 'entry', 'entries')})`;
    body += diff === null ? '.' : `, ${Math.abs(diff)}% ${diff >= 0 ? 'more' : 'less'} than the week before.`;
    body += ` Biggest: ${top.name}, ${fmt(top.amount)}.`;
  }
  if (income > 0) body += ` Income: ${fmt(income)}.`;
  return { id: `weekly-${from}`, kind: 'weekly', title: 'Last week in review', body };
}

/** Entries that appeared since the last check without being made here. `describe(tx)` gives their text. */
export function activityFor(txs, seen, describe) {
  const fresh = txs.filter((t) => t.id > 0 && !seen.has(t.id)).sort((a, b) => a.id - b.id);
  if (!fresh.length) return [];
  if (fresh.length > 3) {
    return [{
      id: `entries-${fresh[0].id}-${fresh[fresh.length - 1].id}`, kind: 'activity', title: `${fresh.length} new entries`,
      body: `Added outside the app, for example by a Shortcut, Telegram, a recurring item or the sheet. Latest: ${describe(fresh[fresh.length - 1])}`,
    }];
  }
  return fresh.map((t) => ({
    id: `entry-${t.id}`, kind: 'activity', txId: t.id, title: `Entry #${t.id} added`, body: describe(t),
  }));
}

/**
 * The whole check. `store` is {items, seen, prefs}; `ctx` is {txs (every wallet), baseTxs (default currency only),
 * now, fmt(amount), describe(tx)}. Returns {store, changed}; the first run only learns which entries exist.
 */
export function evaluate(store, ctx) {
  const prefs = { ...DEFAULT_PREFS, ...(store?.prefs || {}) };
  const first = !store?.seen;
  const seen = new Set(store?.seen || []);
  let items = [...(store?.items || [])];
  let changed = first;
  const has = (id) => items.some((i) => i.id === id);
  const add = (n) => { if (n && !has(n.id)) { items.unshift({ ...n, at: ctx.now.getTime(), read: false }); changed = true; } };

  // today's reminder disappears once an entry for today exists
  const reminder = reminderFor(ctx.txs, ctx.now, prefs);
  const todayId = `reminder-${dayKey(ctx.now)}`;
  if (reminder) add(reminder);
  else if (items.some((i) => i.id === todayId) && ctx.txs.some((t) => dayOf(t) === dayKey(ctx.now) && t.category !== ADJUST)) {
    items = items.filter((i) => i.id !== todayId);
    changed = true;
  }
  const insightsOpen = nowMinutes(ctx.now) >= minutes(prefs.insightTime);
  if (prefs.daily && insightsOpen && ctx.baseTxs.length) add(dailyInsight(ctx.baseTxs, ctx.now, ctx.fmt));
  const monday = (ctx.now.getDay() + 6) % 7 === 0;
  if (prefs.weekly && (!monday || insightsOpen) && ctx.baseTxs.length) add(weeklyInsight(ctx.baseTxs, ctx.now, ctx.fmt));
  if (prefs.activity && !first) activityFor(ctx.txs, seen, ctx.describe).slice().reverse().forEach(add);

  for (const t of ctx.txs) if (t.id > 0 && !seen.has(t.id)) { seen.add(t.id); changed = true; }
  items = items.slice(0, MAX_ITEMS);
  return { store: { items, seen: [...seen].sort((a, b) => a - b).slice(-1000), prefs: store?.prefs || {} }, changed };
}

export const unreadCount = (store) => (store?.items || []).filter((i) => !i.read).length;
