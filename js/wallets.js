// "New wallet" sheet: name, type and what it holds today (its opening balance).
import { WALLET_TYPES, formatNumber } from './calc.js';
import { esc, walletIcon } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : null;
};
const grouped = (n) => (n === null ? '' : formatNumber(n));

/**
 * @param {object} o
 * @param {string[]} o.existing  names already in use (case-insensitive check)
 * @param {Function} o.onSave    async ({name, type, openingBalance}) => void
 */
export function openWalletSheet({ existing = [], onSave }) {
  const state = { name: '', type: 'Bank', amount: null, owe: false };
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="New wallet"></div>';
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
        <h2>New wallet</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <label class="field">
          <span class="field-label">Name</span>
          <input class="note-input" data-f="name" maxlength="40" placeholder="e.g. BCA, Cash, GoPay" value="${esc(state.name)}" enterkeyhint="next" autocomplete="off">
        </label>
        <p class="field-label">Type</p>
        <div class="chip-row wrap">
          ${WALLET_TYPES.map((t) => `<button type="button" class="chip ${state.type === t ? 'active' : ''}" data-act="type" data-v="${esc(t)}" aria-pressed="${state.type === t}">${walletIcon(t)} ${esc(t)}</button>`).join('')}
        </div>
        <p class="field-label">What does it hold today?</p>
        <div class="segmented two balance-sign" role="radiogroup" aria-label="Balance kind">
          <button type="button" class="seg ${state.owe ? '' : 'active'}" data-act="sign" data-v="have" role="radio" aria-checked="${!state.owe}">I have</button>
          <button type="button" class="seg ${state.owe ? 'active' : ''}" data-act="sign" data-v="owe" role="radio" aria-checked="${state.owe}">I owe</button>
        </div>
        <input class="note-input big-input center" data-f="amount" inputmode="numeric" placeholder="0" value="${esc(grouped(state.amount))}" aria-label="Opening balance">
        <p class="muted small field-help">This is the starting balance. After that, every transaction moves it. You can fix it any time with Adjust balance, and style the card afterwards.</p>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : 'Add wallet'}</button>
      </div>`;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const { act, v } = el.dataset;
    if (act === 'cancel') close();
    else if (act === 'type') {
      state.type = v;
      if (/credit/i.test(v)) state.owe = true;
      render();
    } else if (act === 'sign') { state.owe = v === 'owe'; render(); }
    else if (act === 'save') {
      const name = state.name.replace(/\s+/g, ' ').trim();
      if (!name) { error = 'Give the wallet a name.'; render(); return; }
      if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) { error = `You already have a wallet called “${name}”.`; render(); return; }
      busy = true;
      error = '';
      render();
      try {
        await onSave({ name, type: state.type, openingBalance: (state.amount || 0) * (state.owe ? -1 : 1) });
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  // Typing only updates the state, so the keyboard stays open
  backdrop.addEventListener('input', (event) => {
    const f = event.target.dataset.f;
    if (f === 'name') state.name = event.target.value;
    if (f === 'amount') {
      state.amount = digits(event.target.value);
      event.target.value = grouped(state.amount);
    }
  });

  render();
  setTimeout(() => sheet.querySelector('[data-f="name"]')?.focus(), 350);
}
