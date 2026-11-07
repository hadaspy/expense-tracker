// Sample data for "Preview with sample data". Generic names only — this file is public.
import { formatDateTime } from './calc.js';

export function demoData() {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (list) => list[Math.floor(random() * list.length)];

  const wallets = [
    { name: 'Main Bank', openingBalance: 8500000, type: 'Bank', card: 'royal|orbs|•••• 0329' },
    { name: 'Savings Bank', openingBalance: 15000000, type: 'Bank', card: 'gold|waves|Rainy-day money' },
    { name: 'Cash', openingBalance: 1500000, type: 'Cash', card: '' },
    { name: 'E-wallet', openingBalance: 800000, type: 'E-wallet', card: 'ocean|grid|' },
    { name: 'Credit Card', openingBalance: -1200000, type: 'Credit Card', card: 'graphite|glass|•••• 8841' },
    { name: 'Stocks', openingBalance: 5000000, type: 'Stock', card: 'violet|orbs|' },
  ];
  const categories = {
    Expense: {
      'Food & Drinks': ['Groceries', 'Restaurant', 'Coffee', 'Snacks'],
      Transport: ['Fuel', 'Public Transport', 'Taxi', 'Parking'],
      Shopping: ['Clothes', 'Electronics', 'Household'],
      'Bills & Utilities': ['Electricity', 'Water', 'Internet', 'Phone'],
      Entertainment: ['Movies', 'Games', 'Subscriptions'],
      Health: ['Doctor', 'Pharmacy', 'Fitness'],
    },
    Income: { Salary: [], Bonus: [], Investment: ['Dividends', 'Interest'] },
  };
  const budgets = { 'Food & Drinks': 3000000, Transport: 1000000, Entertainment: 500000 };

  const everyday = [
    ['Food & Drinks', 'Coffee', 25000, 45000, ['latte', 'iced coffee', '']],
    ['Food & Drinks', 'Restaurant', 50000, 180000, ['lunch', 'dinner with friends', '']],
    ['Food & Drinks', 'Groceries', 120000, 450000, ['weekly groceries', '']],
    ['Transport', 'Taxi', 20000, 80000, ['ride home', '']],
    ['Transport', 'Fuel', 100000, 200000, ['']],
    ['Shopping', 'Household', 40000, 250000, ['']],
    ['Entertainment', 'Movies', 50000, 100000, ['weekend movie']],
  ];
  const spendWallets = ['Cash', 'E-wallet', 'Main Bank', 'Credit Card'];

  const transactions = [];
  const now = new Date();
  const add = (daysAgo, hour, tx) => {
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, Math.floor(random() * 60));
    if (when > now) return;
    transactions.push({ id: 0, date: formatDateTime(when), wallet: '', toWallet: '', category: '', subcategory: '', note: '', ...tx });
  };

  for (let daysAgo = 45; daysAgo >= 0; daysAgo--) {
    const count = Math.floor(random() * 3) + (daysAgo === 0 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const [category, subcategory, min, max, notes] = pick(everyday);
      const amount = Math.round((min + random() * (max - min)) / 1000) * 1000;
      add(daysAgo, 8 + Math.floor(random() * 13), {
        type: 'Expense', amount, wallet: pick(spendWallets), category, subcategory, note: pick(notes),
      });
    }
  }
  for (const daysAgo of [33, 2]) {
    add(daysAgo, 9, { type: 'Income', amount: 12000000, wallet: 'Main Bank', category: 'Salary', note: 'monthly salary' });
    add(daysAgo, 10, { type: 'Transfer', amount: 3000000, wallet: 'Main Bank', toWallet: 'Savings Bank', note: 'save' });
    add(daysAgo, 11, { type: 'Expense', amount: 450000, wallet: 'Main Bank', category: 'Bills & Utilities', subcategory: 'Internet' });
    add(daysAgo, 12, { type: 'Expense', amount: 186000, wallet: 'Credit Card', category: 'Entertainment', subcategory: 'Subscriptions', note: 'streaming' });
  }
  add(20, 18, { type: 'Transfer', amount: 1500000, wallet: 'Main Bank', toWallet: 'Credit Card', note: 'card bill' });
  add(15, 15, { type: 'Income', amount: 320000, wallet: 'Stocks', category: 'Investment', subcategory: 'Dividends' });
  add(5, 19, { type: 'Transfer', amount: 500000, wallet: 'Main Bank', toWallet: 'E-wallet', note: 'top up' });
  add(30, 8, { type: 'Transfer', amount: 1000000, wallet: 'Main Bank', toWallet: 'Cash', note: 'ATM' });
  add(12, 8, { type: 'Transfer', amount: 1000000, wallet: 'Main Bank', toWallet: 'Cash', note: 'ATM' });

  transactions.sort((a, b) => a.date.localeCompare(b.date)).forEach((tx, i) => (tx.id = i + 1));
  const pad = (n) => String(n).padStart(2, '0');
  const ahead = (months) => {
    const d = new Date(now.getFullYear(), now.getMonth() + months + 1, 0); // end of that month
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const goals = [
    { name: 'Emergency fund', target: 30000000, wallet: 'Savings Bank', saved: 0, targetDate: '' },
    { name: 'New laptop', target: 20000000, wallet: '', saved: 6500000, targetDate: ahead(7) },
    { name: 'Holiday', target: 8000000, wallet: '', saved: 2000000, targetDate: ahead(10) },
  ];
  const inDays = (n) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const item = (id, n, frequency, fields) => ({ id, toWallet: '', category: '', subcategory: '', note: '', frequency, nextDate: inDays(n), day: Number(inDays(n).slice(8, 10)), active: true, ...fields });
  const recurring = [
    item(1, 4, 'monthly', { type: 'Expense', amount: 186000, wallet: 'Credit Card', category: 'Entertainment', subcategory: 'Subscriptions', note: 'Streaming' }),
    item(2, 9, 'monthly', { type: 'Expense', amount: 450000, wallet: 'Main Bank', category: 'Bills & Utilities', subcategory: 'Internet', note: 'Internet' }),
    item(3, 18, 'monthly', { type: 'Income', amount: 12000000, wallet: 'Main Bank', category: 'Salary', note: 'Monthly salary' }),
    item(4, 19, 'monthly', { type: 'Transfer', amount: 3000000, wallet: 'Main Bank', toWallet: 'Savings Bank', note: 'Save' }),
    item(5, 3, 'weekly', { type: 'Expense', amount: 150000, wallet: 'E-wallet', category: 'Health', subcategory: 'Fitness', note: 'Gym class', active: false }),
  ];
  const settings = { payday: 1, paydayWeekdays: false };
  return { sheet: 'Sample data', wallets, categories, budgets, goals, recurring, settings, transactions };
}
