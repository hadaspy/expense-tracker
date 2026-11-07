// "Adjust balance" sheet: type what a wallet holds right now (same as /setbalance in Telegram).
// The difference is recorded as a "Balance adjustment" income/expense entry, so Cash Flow and Net Worth agree.
import { formatNumber } from './calc.js';
import { esc } from './ui.js';

const digits = (text) => {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  return d ? Number(d) : null;
};
const grouped = (n) => (n === null ? '' : formatNumber(n));

/**
 * @param {object} o
 * @param {string} o.wallet    wallet name
 * @param {string} o.type      wallet type (credit cards start in "owed" mode)
 * @param {number} o.current   balance now
 * @param {Function} o.money   number → text
 * @param {Function} o.onSave  async (newBalance) => void
 */
export function openBalanceSheet({ wallet, type, current, money, onSave }) {
  let amount = Math.abs(Math.round(current)); // whole units; the sheet keeps decimals if you type none
  let negative = current < 0 || (current === 0 && /credit/i.test(type || ''));
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="Adjust ${esc(wallet)} balance"></div>`;
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };

  const target = () => (amount === null ? null : negative ? -amount : amount);

  function changeLine() {
    const t = target();
    if (t === null) return 'Enter the balance';
    const diff = t - current;
    if (Math.abs(diff) < 0.005) return 'No change';
    return `Change: <strong class="${diff > 0 ? 'pos' : 'neg'}">${diff > 0 ? '+' : '−'}${esc(money(Math.abs(diff)))}</strong>`;
  }

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Adjust balance</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <p class="muted center">${esc(wallet)} · now <strong class="${current < 0 ? 'neg' : ''}">${esc(money(current))}</strong></p>
        <div class="segmented two balance-sign" role="radiogroup" aria-label="Balance kind">
          <button type="button" class="seg ${negative ? '' : 'active'}" data-act="sign" data-v="plus" role="radio" aria-checked="${!negative}">I have</button>
          <button type="button" class="seg ${negative ? 'active' : ''}" data-act="sign" data-v="minus" role="radio" aria-checked="${negative}">I owe</button>
        </div>
        <input class="note-input big-input center" data-f="amount" inputmode="numeric" placeholder="0" value="${esc(grouped(amount))}" aria-label="New balance">
        <p class="center balance-change" aria-live="polite">${changeLine()}</p>
        <p class="muted small field-help">Use this when the app and your real ${esc(wallet)} balance disagree. The difference is saved as a “Balance adjustment” entry (income if the balance goes up, expense if it goes down), so Cash Flow and Net Worth stay in step.</p>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Update balance'}</button>
      </div>`;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const act = el.dataset.act;
    if (act === 'cancel') close();
    if (act === 'sign') { negative = el.dataset.v === 'minus'; render(); }
    if (act === 'save') {
      const t = target();
      if (t === null) { error = 'Enter the balance.'; render(); return; }
      if (Math.abs(t - current) < 0.005) { close(); return; }
      busy = true;
      error = '';
      render();
      try {
        await onSave(t);
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  // Only the number and the "Change" line update while typing, so the keyboard stays open
  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f !== 'amount') return;
    amount = digits(event.target.value);
    event.target.value = grouped(amount);
    sheet.querySelector('.balance-change').innerHTML = changeLine();
  });

  render();
  setTimeout(() => {
    const input = sheet.querySelector('[data-f="amount"]');
    input?.focus();
    input?.select();
  }, 350);
}
