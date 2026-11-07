// "New budget" sheet: pick a category that has no budget yet (or create a new category) and set its monthly limit.
import { formatNumber } from './calc.js';
import { categoryIcon, esc } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : 0;
};

/**
 * @param {object} o
 * @param {string[]} o.categories  every expense category
 * @param {object} o.budgets       {category: limit} already set
 * @param {Function} o.onSave      async ({category, limit, isNew}) => void
 */
export function openNewBudgetSheet({ categories, budgets, defaultCurrency = '', onSave }) {
  const free = categories.filter((c) => !budgets[c]);
  const state = { category: free[0] || '', creating: !free.length, name: '', limit: 0 };
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="New budget"></div>';
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>New budget</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <p class="field-label">Category</p>
        <div class="chip-row wrap">
          ${free.map((c) => `<button type="button" class="chip ${!state.creating && state.category === c ? 'active' : ''}" data-act="category" data-v="${esc(c)}" aria-pressed="${!state.creating && state.category === c}">${categoryIcon(c)} ${esc(c)}</button>`).join('')}
          <button type="button" class="chip ${state.creating ? 'active' : ''}" data-act="create" aria-pressed="${state.creating}">+ New category</button>
        </div>
        ${state.creating ? `
        <label class="field">
          <span class="field-label">Category name</span>
          <input class="note-input" data-f="name" maxlength="40" placeholder="e.g. Pets, Gifts" value="${esc(state.name)}" autocomplete="off">
        </label>` : ''}
        <p class="field-label">Monthly limit${defaultCurrency ? ` (${esc(defaultCurrency)})` : ''}</p>
        <input class="note-input big-input center" data-f="limit" inputmode="numeric" placeholder="0" value="${state.limit ? esc(formatNumber(state.limit)) : ''}" aria-label="Monthly limit">
        <p class="muted small field-help">${free.length || state.creating ? 'Budgets repeat every month. The Telegram bot uses the same limits.' : ''}${!free.length ? ' Every category already has a budget, so you can add a new category here.' : ''}</p>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Add budget'}</button>
      </div>`;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const { act, v } = el.dataset;
    if (act === 'cancel') close();
    else if (act === 'category') { state.category = v; state.creating = false; render(); }
    else if (act === 'create') { state.creating = true; render(); sheet.querySelector('[data-f="name"]')?.focus(); }
    else if (act === 'save') {
      const category = state.creating ? state.name.replace(/\s+/g, ' ').trim() : state.category;
      if (!category) { error = state.creating ? 'Give the category a name.' : 'Pick a category.'; render(); return; }
      if (state.creating && categories.some((c) => c.toLowerCase() === category.toLowerCase())) {
        error = budgets[categories.find((c) => c.toLowerCase() === category.toLowerCase())] ? `“${category}” already has a budget. Use Edit budgets to change it.` : `“${category}” already exists: pick it from the list.`;
        render();
        return;
      }
      if (!(state.limit > 0)) { error = 'Enter the monthly limit.'; render(); return; }
      busy = true;
      error = '';
      render();
      try {
        await onSave({ category, limit: state.limit, isNew: state.creating });
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  backdrop.addEventListener('input', (event) => {
    const f = event.target.dataset.f;
    if (f === 'name') state.name = event.target.value;
    if (f === 'limit') {
      state.limit = digits(event.target.value);
      event.target.value = state.limit ? formatNumber(state.limit) : '';
    }
  });

  render();
}
