// Savings goal sheets: create / edit a goal, or quickly add money to a goal you track by hand.
// A goal can follow a wallet's balance (e.g. a savings account), or a "saved" amount you update yourself.
import { formatNumber } from './calc.js';
import { icon, walletIcon } from './ui.js';
import { ICONS, esc } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : 0;
};
const grouped = (n) => (n ? formatNumber(n) : '');

function mountSheet(label) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="${esc(label)}"></div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };
  return { backdrop, sheet: backdrop.firstElementChild, close };
}

/**
 * Create or edit a goal.
 * @param {object} o
 * @param {object} [o.goal]      existing goal → edit mode
 * @param {Array}  o.wallets     [{name, type}]
 * @param {Function} o.money     number → text
 * @param {Function} o.onSave    async (goal, originalName) => void
 * @param {Function} [o.onDelete] async (name) => void
 */
export function openGoalSheet({ goal = null, wallets, money, onSave, onDelete }) {
  const form = {
    name: goal?.name || '',
    target: goal?.target || 0,
    wallet: goal?.wallet || '',
    saved: goal?.saved || 0,
    targetDate: goal?.targetDate || '',
  };
  let busy = false;
  let error = '';
  const { backdrop, sheet, close } = mountSheet(goal ? 'Edit goal' : 'New goal');

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>${goal ? 'Edit goal' : 'New goal'}</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <label class="field">
          <span class="field-label">Name</span>
          <input class="note-input" data-f="name" maxlength="60" placeholder="e.g. Emergency fund, New laptop" value="${esc(form.name)}" enterkeyhint="next">
        </label>
        <label class="field">
          <span class="field-label">Target amount</span>
          <input class="note-input big-input" data-f="target" inputmode="numeric" placeholder="0" value="${esc(grouped(form.target))}">
        </label>
        <p class="field-label">Track progress with</p>
        <div class="chip-row wrap">
          <button type="button" class="chip ${form.wallet ? '' : 'active'}" data-act="wallet" data-v="">${icon('pencil-simple')} Amount I enter</button>
          ${wallets.map((w) => `<button type="button" class="chip ${form.wallet === w.name ? 'active' : ''}" data-act="wallet" data-v="${esc(w.name)}">${walletIcon(w.type)} ${esc(w.name)}</button>`).join('')}
        </div>
        <p class="muted small field-help">${form.wallet
          ? `Progress follows the balance of <strong>${esc(form.wallet)}</strong>, so moving money there counts automatically.`
          : 'You update the saved amount yourself, e.g. with “Add money”.'}</p>
        ${form.wallet ? '' : `
        <label class="field">
          <span class="field-label">Saved so far</span>
          <input class="note-input" data-f="saved" inputmode="numeric" placeholder="0" value="${esc(grouped(form.saved))}">
        </label>`}
        <label class="field">
          <span class="field-label">Target date <span class="muted">(optional)</span></span>
          <input class="note-input" data-f="targetDate" type="date" value="${esc(form.targetDate)}">
        </label>
        ${goal && onDelete ? `<button type="button" class="btn-danger" data-act="delete">${ICONS.trash} Delete goal</button>` : ''}
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : goal ? 'Save changes' : 'Create goal'}</button>
      </div>`;
  }

  async function run(task) {
    busy = true;
    error = '';
    render();
    try {
      await task();
      close();
    } catch (e) {
      busy = false;
      error = e.message || 'Could not save.';
      render();
    }
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const act = el.dataset.act;
    if (act === 'cancel') close();
    if (act === 'wallet') { form.wallet = el.dataset.v; render(); }
    if (act === 'delete') {
      if (confirm(`Delete the goal “${goal.name}”? Your money and transactions are not affected.`)) run(() => onDelete(goal.name));
    }
    if (act === 'save') {
      if (!form.name.trim()) { error = 'Give the goal a name.'; render(); return; }
      if (!(form.target > 0)) { error = 'Enter a target amount.'; render(); return; }
      run(() => onSave({ ...form, name: form.name.trim(), saved: form.wallet ? 0 : form.saved }, goal?.name));
    }
  });

  backdrop.addEventListener('input', (event) => {
    const f = event.target.dataset.f;
    if (!f) return;
    if (f === 'target' || f === 'saved') {
      form[f] = digits(event.target.value);
      event.target.value = grouped(form[f]);
    } else {
      form[f] = event.target.value;
    }
  });

  render();
  if (!goal) setTimeout(() => sheet.querySelector('[data-f="name"]')?.focus(), 350);
}

/** Quick "Add money" to a goal that isn't linked to a wallet. */
export function openAddMoneySheet({ goal, money, onSave }) {
  let amount = 0;
  let busy = false;
  let error = '';
  const { backdrop, sheet, close } = mountSheet(`Add money to ${goal.name}`);

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Add money</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <p class="muted center">${esc(goal.name)} · ${esc(money(goal.saved || 0))} of ${esc(money(goal.target))}</p>
        <input class="note-input big-input center" data-f="amount" inputmode="numeric" placeholder="0" value="${esc(grouped(amount))}" aria-label="Amount to add">
        <div class="chip-row wrap center-row">
          ${[100000, 500000, 1000000].map((v) => `<button type="button" class="chip" data-act="quick" data-v="${v}">+${esc(money(v))}</button>`).join('')}
        </div>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Add'}</button>
      </div>`;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const act = el.dataset.act;
    if (act === 'cancel') close();
    if (act === 'quick') { amount += Number(el.dataset.v); render(); }
    if (act === 'save') {
      if (!(amount > 0)) { error = 'Enter an amount.'; render(); return; }
      busy = true;
      error = '';
      render();
      try {
        await onSave({ ...goal, saved: (goal.saved || 0) + amount }, goal.name);
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f !== 'amount') return;
    amount = digits(event.target.value);
    event.target.value = grouped(amount);
  });

  render();
  setTimeout(() => sheet.querySelector('[data-f="amount"]')?.focus(), 350);
}
