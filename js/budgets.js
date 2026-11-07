// "Edit budgets" sheet: one monthly limit per expense category, written to the sheet's Budgets tab.
// Shows last month's spending next to each category as a starting point (MoneyCoach-style).
import { formatNumber } from './calc.js';
import { categoryIcon, esc } from './ui.js';

export function openBudgetSheet({ categories, budgets, lastMonth, lastMonthLabel, money, onSave }) {
  const values = Object.fromEntries(categories.map((c) => [c, budgets[c] ? String(Math.round(budgets[c])) : '']));
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="Edit budgets"></div>';
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const parse = (text) => {
    const digits = String(text).replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  };
  const total = () => categories.reduce((sum, c) => sum + parse(values[c]), 0);

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Monthly budgets</h2>
        <span class="sheet-head-spacer"></span>
      </header>
      <div class="sheet-body">
        <p class="muted small">Set a monthly limit per category. Leave empty for no budget. ${lastMonthLabel ? `Grey numbers show what you spent in ${esc(lastMonthLabel)}.` : ''}</p>
        <ul class="card list budget-edit">
          ${categories.map((c) => `
            <li>
              <label class="budget-edit-row">
                <span class="budget-edit-name">${categoryIcon(c)} ${esc(c)}
                  ${lastMonth[c] ? `<small class="muted">${esc(money(lastMonth[c]))}</small>` : ''}
                </span>
                <input inputmode="numeric" pattern="[0-9.,]*" placeholder="—" data-cat="${esc(c)}" value="${esc(values[c] ? formatNumber(Number(values[c])) : '')}" aria-label="Monthly limit for ${esc(c)}">
              </label>
            </li>`).join('')}
        </ul>
      </div>
      <div class="sheet-foot">
        <p class="budget-total">Total budget: <strong>${esc(money(total()))}</strong> per month</p>
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save budgets'}</button>
      </div>`;
  }

  function close() {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 250);
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (busy || !act) return;
    if (act === 'cancel') close();
    if (act === 'save') {
      const result = {};
      for (const c of categories) if (parse(values[c]) > 0) result[c] = parse(values[c]);
      busy = true;
      error = '';
      render();
      try {
        await onSave(result);
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  // Format with thousands separators as you type, and keep the total up to date without re-rendering
  backdrop.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.dataset.cat) return;
    const number = parse(input.value);
    values[input.dataset.cat] = number ? String(number) : '';
    input.value = number ? formatNumber(number) : '';
    sheet.querySelector('.budget-total strong').textContent = money(total());
  });

  render();
}
