// Editing categories and subcategories. The same rules run in the Apps Script (Code.gs → editCategory); this copy is
// used by the sample data and by the tests. Renaming is carried over to everything that uses the name.
//
// applyCategoryEdit(data, op) → the parts of `data` that changed: {categories, budgets, transactions, recurring}.
// Throws an Error with a plain message when the change isn't allowed.

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const kindOf = (type) => (same(type, 'income') ? 'Income' : same(type, 'expense') ? 'Expense' : '');

export function applyCategoryEdit(data, op) {
  const kind = kindOf(op.type);
  if (!kind) throw new Error('Type must be Expense or Income.');
  const categories = JSON.parse(JSON.stringify(data.categories || { Expense: {}, Income: {} }));
  const group = (categories[kind] = categories[kind] || {});
  let budgets = { ...(data.budgets || {}) };
  let transactions = [...(data.transactions || [])];
  let recurring = [...(data.recurring || [])];
  const find = (name) => Object.keys(group).find((c) => same(c, name));
  const usedBy = (list, category, sub) => list.filter((t) => same(t.type, kind) && t.category === category && (sub === undefined || t.subcategory === sub));

  if (op.op === 'addCategory') {
    const name = clean(op.name, 40);
    if (!name) throw new Error('Give the category a name.');
    if (find(name)) throw new Error(`A ${kind.toLowerCase()} category called "${name}" already exists.`);
    group[name] = [];
  } else if (op.op === 'renameCategory') {
    const old = find(op.category);
    const name = clean(op.newName, 40);
    if (!old) throw new Error(`Unknown category "${op.category}".`);
    if (!name) throw new Error('Give the category a name.');
    if (!same(old, name) && find(name)) throw new Error(`A ${kind.toLowerCase()} category called "${name}" already exists.`);
    const renamed = {};
    for (const [key, subs] of Object.entries(group)) renamed[key === old ? name : key] = subs;
    categories[kind] = renamed;
    if (kind === 'Expense' && budgets[old] !== undefined) {
      budgets = Object.fromEntries(Object.entries(budgets).map(([key, v]) => [key === old ? name : key, v]));
    }
    transactions = transactions.map((t) => (same(t.type, kind) && t.category === old ? { ...t, category: name } : t));
    recurring = recurring.map((t) => (same(t.type, kind) && t.category === old ? { ...t, category: name } : t));
  } else if (op.op === 'deleteCategory') {
    const old = find(op.category);
    if (!old) throw new Error(`Unknown category "${op.category}".`);
    const count = usedBy(transactions, old).length + usedBy(recurring, old).length;
    if (count) throw new Error(`"${old}" is used by ${count} ${count === 1 ? 'entry' : 'entries'}. Rename it, or move those entries to another category first.`);
    delete group[old];
    if (kind === 'Expense') delete budgets[old];
  } else {
    const parent = find(op.category);
    if (!parent) throw new Error(`Unknown category "${op.category}".`);
    const subs = group[parent];
    if (op.op === 'addSubcategory') {
      const name = clean(op.name, 40);
      if (!name) throw new Error('Give the subcategory a name.');
      if (subs.some((s) => same(s, name))) throw new Error(`"${parent}" already has a subcategory called "${name}".`);
      subs.push(name);
    } else if (op.op === 'renameSubcategory') {
      const old = subs.find((s) => same(s, op.name));
      const name = clean(op.newName, 40);
      if (!old) throw new Error(`Unknown subcategory "${op.name}".`);
      if (!name) throw new Error('Give the subcategory a name.');
      if (!same(old, name) && subs.some((s) => same(s, name))) throw new Error(`"${parent}" already has a subcategory called "${name}".`);
      group[parent] = subs.map((s) => (s === old ? name : s));
      const move = (t) => (same(t.type, kind) && t.category === parent && t.subcategory === old ? { ...t, subcategory: name } : t);
      transactions = transactions.map(move);
      recurring = recurring.map(move);
    } else if (op.op === 'deleteSubcategory') {
      const old = subs.find((s) => same(s, op.name));
      if (!old) throw new Error(`Unknown subcategory "${op.name}".`);
      group[parent] = subs.filter((s) => s !== old);
      // entries keep their category and simply lose the subcategory
      const clear = (t) => (same(t.type, kind) && t.category === parent && t.subcategory === old ? { ...t, subcategory: '' } : t);
      transactions = transactions.map(clear);
      recurring = recurring.map(clear);
    } else {
      throw new Error('Unknown change.');
    }
  }
  return { categories, budgets, transactions, recurring };
}
