// "Pay cycle" sheet: the day your month starts, and whether a weekend payday moves to the Friday before.
import { esc } from './ui.js';

/**
 * @param {object} o
 * @param {{payday: number, paydayWeekdays: boolean}} o.settings  current values
 * @param {Function} o.preview  (day, weekdays) => {current: '23 Oct – 24 Nov', next: 'Wed, 25 Nov'}
 * @param {Function} o.onSave   async ({payday, paydayWeekdays}) => void
 */
export function openPaydaySheet({ settings, preview, onSave }) {
  const state = { day: settings.payday || 1, weekdays: !!settings.paydayWeekdays };
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="Pay cycle"></div>';
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };

  const previewHtml = () => {
    const p = preview(state.day, state.weekdays);
    return `<p class="payday-preview" aria-live="polite">Your “month” now runs <strong>${esc(p.current)}</strong>.<br>Next payday: <strong>${esc(p.next)}</strong>.</p>`;
  };

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Pay cycle</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <p class="field-label">My month starts on day</p>
        <div class="daygrid" role="radiogroup" aria-label="Payday">
          ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<button type="button" class="day-btn ${state.day === d ? 'active' : ''}" data-act="day" data-v="${d}" role="radio" aria-checked="${state.day === d}">${d}</button>`).join('')}
        </div>
        <label class="switch-row">
          <span><strong>Start payday on weekdays</strong><span class="muted small">If that day is a Saturday or Sunday, the month starts on the Friday before.</span></span>
          <input type="checkbox" class="switch" data-f="weekdays" role="switch" ${state.weekdays ? 'checked' : ''}>
        </label>
        <div class="payday-box">${previewHtml()}</div>
        <p class="muted small field-help">Budgets, “left to spend”, reports and the Telegram bot all use this month. Day 1 is the normal calendar month. Short months use their last day (31 → 28 Feb).</p>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save pay cycle'}</button>
      </div>`;
  }

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const { act, v } = el.dataset;
    if (act === 'cancel') close();
    else if (act === 'day') {
      state.day = Number(v);
      sheet.querySelectorAll('.day-btn').forEach((b) => {
        const on = Number(b.dataset.v) === state.day;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
      sheet.querySelector('.payday-box').innerHTML = previewHtml();
    } else if (act === 'save') {
      busy = true;
      error = '';
      render();
      try {
        await onSave({ payday: state.day, paydayWeekdays: state.weekdays });
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  backdrop.addEventListener('change', (event) => {
    if (event.target.dataset.f !== 'weekdays') return;
    state.weekdays = event.target.checked;
    sheet.querySelector('.payday-box').innerHTML = previewHtml();
  });

  render();
}
