// "New wallet" sheet: name, type and what it holds today (its opening balance).
import { WALLET_TYPES, formatNumber } from './calc.js';
import { esc } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : null;
};
const grouped = (n) => (n === null ? '' : formatNumber(n));

/**
 * @param {object} o
 * @param {string[]} o.existing  names already in use (case-insensitive check)
 * @param {string[]} [o.types]  type names already used by your wallets (offered as chips next to the standard ones)
 * @param {number} [o.sameTypeCount] how many wallets (including this one) have this wallet's current type
 * @param {Function} o.onSave    async ({name, type, openingBalance}) => void
 */
export function openWalletSheet({ existing = [], wallet = null, defaultCurrency = '', types = [], sameTypeCount = 0, onSave }) {
  const editing = !!wallet;
  const state = { name: wallet?.name || '', type: wallet?.type || 'Bank', currency: wallet?.currency || '', amount: null, owe: false, renameAll: false };
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

  const allTypes = [...new Set([...WALLET_TYPES, ...types.filter(Boolean)])];

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>${editing ? 'Edit wallet' : 'New wallet'}</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <label class="field">
          <span class="field-label">Name</span>
          <input class="note-input" data-f="name" maxlength="40" placeholder="e.g. BCA, Cash, GoPay" value="${esc(state.name)}" enterkeyhint="next" autocomplete="off">
        </label>
        <p class="field-label">Type</p>
        <div class="chip-row wrap">
          ${allTypes.map((t) => `<button type="button" class="chip ${state.type === t ? 'active' : ''}" data-act="type" data-v="${esc(t)}" aria-pressed="${state.type === t}">${esc(t)}</button>`).join('')}
        </div>
        <label class="field">
          <span class="field-label">Type name <span class="muted">(you can edit it)</span></span>
          <input class="note-input" data-f="type" maxlength="30" placeholder="e.g. Bank, Super app, Pocket money" value="${esc(state.type)}" autocomplete="off">
        </label>
        ${editing && sameTypeCount > 1 && state.type.trim() && state.type.trim() !== wallet.type ? `
        <label class="switch-row">
          <span><strong>Rename “${esc(wallet.type)}” everywhere</strong><span class="muted small">${sameTypeCount - 1} other wallet${sameTypeCount === 2 ? '' : 's'} with this type will get the new name too.</span></span>
          <input type="checkbox" class="switch" data-f="rename-all" role="switch" ${state.renameAll ? 'checked' : ''}>
        </label>` : ''}
        <label class="field">
          <span class="field-label">Currency <span class="muted">(optional)</span></span>
          <input class="note-input" data-f="currency" maxlength="6" placeholder="${esc(defaultCurrency ? `Default: ${defaultCurrency}` : 'Default currency')}" value="${esc(state.currency)}" autocomplete="off" autocapitalize="characters">
          <span class="muted small field-help">Leave empty to use the default currency. A wallet in another currency (say USD) is left out of net worth, cash flow and budgets, and gets its own net worth card in the Wallets tab.</span>
        </label>
        ${editing ? `<p class="muted small field-help">Renaming updates all its transactions, recurring items and goals. To change what it holds, use Adjust balance.</p>` : `        <p class="field-label">What does it hold today?</p>
        <div class="segmented two balance-sign" role="radiogroup" aria-label="Balance kind">
          <button type="button" class="seg ${state.owe ? '' : 'active'}" data-act="sign" data-v="have" role="radio" aria-checked="${!state.owe}">I have</button>
          <button type="button" class="seg ${state.owe ? 'active' : ''}" data-act="sign" data-v="owe" role="radio" aria-checked="${state.owe}">I owe</button>
        </div>
        <input class="note-input big-input center" data-f="amount" inputmode="numeric" placeholder="0" value="${esc(grouped(state.amount))}" aria-label="Opening balance">
        <p class="muted small field-help">This is the starting balance. After that, every transaction moves it. You can fix it any time with Adjust balance, and style the card afterwards.</p>`}
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save changes' : 'Add wallet'}</button>
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
      // Changing only the capitals of its own name (Mandiri → MANDIRI) is fine; any other wallet with that name is not
      const ownName = editing && name.toLowerCase() === wallet.name.toLowerCase();
      if (!ownName && existing.some((n) => n.toLowerCase() === name.toLowerCase() && n !== wallet?.name)) { error = `You already have a wallet called “${name}”.`; render(); return; }
      busy = true;
      error = '';
      render();
      try {
        const currency = state.currency.trim();
        const type = state.type.replace(/\s+/g, ' ').trim() || 'Other';
        await onSave(editing ? { name, type, currency, renameType: state.renameAll && type !== wallet.type } : { name, type, currency, openingBalance: (state.amount || 0) * (state.owe ? -1 : 1) });
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
    if (f === 'currency') state.currency = event.target.value.slice(0, 6);
    if (f === 'type') {
      state.type = event.target.value;
      if (/credit/i.test(state.type)) state.owe = true;
      const box = sheet.querySelector('.switch-row [data-f="rename-all"]');
      if (editing && sameTypeCount > 1 && (!!box) !== !!(state.type.trim() && state.type.trim() !== wallet.type)) { const pos = event.target.selectionStart; render(); const el = sheet.querySelector('[data-f="type"]'); el.focus(); el.setSelectionRange(pos, pos); }
    }
    if (f === 'amount') {
      state.amount = digits(event.target.value);
      event.target.value = grouped(state.amount);
    }
  });

  backdrop.addEventListener('change', (event) => {
    if (event.target.dataset.f === 'rename-all') state.renameAll = event.target.checked;
  });

  render();
  setTimeout(() => sheet.querySelector('[data-f="name"]')?.focus(), 350);
}
