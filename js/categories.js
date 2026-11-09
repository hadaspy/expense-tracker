// A small sheet to type a name (new / rename a category or subcategory), with an optional Delete.
import { esc } from './ui.js';

/**
 * @param {object} o
 * @param {string} o.title       e.g. "New expense category"
 * @param {string} o.label       field label
 * @param {string} [o.value]     current name
 * @param {string} [o.hint]      small text under the field
 * @param {string} o.saveLabel
 * @param {Function} o.onSave    async (name) => void; throw an Error to show its message
 * @param {Function} [o.onDelete] async () => void; shows a Delete button
 */
export function openNameSheet({ title, label, value = '', hint = '', saveLabel = 'Save', onSave, onDelete }) {
  let busy = false;
  let error = '';
  let name = value;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = '<div class="sheet sheet-short" role="dialog" aria-modal="true"></div>';
  const sheet = backdrop.firstElementChild;
  sheet.setAttribute('aria-label', title);
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
        <h2>${esc(title)}</h2>
        <span></span>
      </header>
      <div class="sheet-body">
        <label class="field">
          <span class="field-label">${esc(label)}</span>
          <input class="note-input" data-f="name" maxlength="40" autocomplete="off" value="${esc(name)}">
        </label>
        ${hint ? `<p class="muted small field-help">${esc(hint)}</p>` : ''}
        ${onDelete ? '<button type="button" class="btn-danger" data-act="delete">Delete</button>' : ''}
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : esc(saveLabel)}</button>
      </div>`;
  }

  async function run(fn) {
    busy = true;
    error = '';
    render();
    try {
      await fn();
      close();
    } catch (e) {
      busy = false;
      error = e.message || 'Could not save.';
      render();
      sheet.querySelector('[data-f="name"]')?.focus();
    }
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    if (el.dataset.act === 'cancel') close();
    else if (el.dataset.act === 'save') run(() => onSave(name));
    else if (el.dataset.act === 'delete') {
      if (!window.confirm(`Delete “${value}”?`)) return;
      run(onDelete);
    }
  });
  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f === 'name') name = event.target.value;
  });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.dataset.f === 'name') { event.preventDefault(); if (!busy) run(() => onSave(name)); }
  });

  render();
  setTimeout(() => sheet.querySelector('[data-f="name"]')?.focus(), 350);
}
