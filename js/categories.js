// A small sheet to type a name (new / rename a category or subcategory), with an optional Delete.
import { PICKABLE_COLOURS, PICKABLE_ICONS, esc, icon } from './ui.js';

/**
 * @param {object} o
 * @param {string} o.title       e.g. "New expense category"
 * @param {string} o.label       field label
 * @param {string} [o.value]     current name
 * @param {string} [o.hint]      small text under the field
 * @param {string} o.saveLabel
 * @param {object} [o.style]    {icon, colour, autoIcon, autoColour}: shows the icon and colour pickers ('' = automatic)
 * @param {Function} o.onSave    async (name, {icon, colour}) => void; throw an Error to show its message
 * @param {Function} [o.onDelete] async () => void; shows a Delete button
 */
export function openNameSheet({ title, label, value = '', hint = '', saveLabel = 'Save', style = null, onSave, onDelete }) {
  let busy = false;
  let error = '';
  let name = value;
  const look = style ? { icon: style.icon || '', colour: style.colour || '' } : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet ${style ? '' : 'sheet-short'}" role="dialog" aria-modal="true"></div>`;
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
        ${look ? `
        <div class="look-preview"><span class="look-dot" style="--cat:${esc(look.colour || style.autoColour)}">${icon(look.icon || style.autoIcon)}</span><span class="muted small">Preview</span></div>
        <p class="field-label">Icon</p>
        <div class="icon-grid" role="radiogroup" aria-label="Icon">
          <button type="button" class="icon-pick auto ${!look.icon ? 'active' : ''}" data-act="icon" data-v="" role="radio" aria-checked="${!look.icon}" aria-label="Automatic icon">Auto</button>
          ${PICKABLE_ICONS.map((n) => `<button type="button" class="icon-pick ${look.icon === n ? 'active' : ''}" data-act="icon" data-v="${n}" role="radio" aria-checked="${look.icon === n}" aria-label="${n.replace(/-/g, ' ')}">${icon(n)}</button>`).join('')}
        </div>
        <p class="field-label">Colour</p>
        <div class="swatches" role="radiogroup" aria-label="Colour">
          <button type="button" class="swatch-btn auto-swatch ${!look.colour ? 'active' : ''}" style="--card-bg:${esc(style.autoColour)}" data-act="colour" data-v="" role="radio" aria-checked="${!look.colour}" aria-label="Automatic colour"><span>Auto</span></button>
          ${PICKABLE_COLOURS.map((h) => `<button type="button" class="swatch-btn ${look.colour === h ? 'active' : ''}" style="--card-bg:${h}" data-act="colour" data-v="${h}" role="radio" aria-checked="${look.colour === h}" aria-label="Colour ${h}"></button>`).join('')}
        </div>` : ''}
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
    else if (el.dataset.act === 'icon' || el.dataset.act === 'colour') {
      look[el.dataset.act] = el.dataset.v;
      const top = sheet.querySelector('.sheet-body').scrollTop;
      render();
      sheet.querySelector('.sheet-body').scrollTop = top;
    } else if (el.dataset.act === 'save') run(() => onSave(name, look));
    else if (el.dataset.act === 'delete') {
      if (!window.confirm(`Delete “${value}”?`)) return;
      run(onDelete);
    }
  });
  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f === 'name') name = event.target.value;
  });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.dataset.f === 'name') { event.preventDefault(); if (!busy) run(() => onSave(name, look)); }
  });

  render();
  setTimeout(() => sheet.querySelector('[data-f="name"]')?.focus(), 350);
}
