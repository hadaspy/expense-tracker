// Wallet cards: each wallet shows as a payment-card-style tile on Home, and you can style it yourself
// (colour, pattern, a label such as "•••• 0329"). The look is saved in the sheet's Wallets → Card column
// as "colour|pattern|label", so it's the same on every device.
import { esc } from './ui.js';

// Every colour keeps small white text at 4.5:1 or better (with the 16% shade the stylesheet adds).
export const CARD_COLOURS = [
  ['royal', 'Royal blue', 'linear-gradient(145deg, #4c74ec 0%, #4a66ee 52%, #5650e2 100%)'],
  ['midnight', 'Midnight', 'linear-gradient(145deg, #2a3d78 0%, #141d3d 55%, #0b1024 100%)'],
  ['ocean', 'Ocean', 'linear-gradient(145deg, #1281b0 0%, #1f63d6 60%, #2347b8 100%)'],
  ['violet', 'Violet', 'linear-gradient(145deg, #7d55e6 0%, #6a43dc 55%, #4b2db8 100%)'],
  ['emerald', 'Emerald', 'linear-gradient(145deg, #0f8c69 0%, #0c7f69 55%, #0a5e54 100%)'],
  ['sunset', 'Sunset', 'linear-gradient(145deg, #d9622c 0%, #de4a52 55%, #b52d63 100%)'],
  ['rose', 'Rose', 'linear-gradient(145deg, #c94f8c 0%, #c13f86 55%, #8f2a72 100%)'],
  ['graphite', 'Graphite', 'linear-gradient(145deg, #4a5263 0%, #2b313d 55%, #161a22 100%)'],
  ['gold', 'Gold', 'linear-gradient(145deg, #a87e2c 0%, #9c6f1f 55%, #6e4a10 100%)'],
  // Light cards: dark text (the stylesheet switches on `is-light`)
  ['white', 'White', 'linear-gradient(145deg, #ffffff 0%, #eef1f8 100%)', true],
  ['platinum', 'Platinum', 'linear-gradient(145deg, #eceff4 0%, #d0d6e1 55%, #bcc4d3 100%)', true],
  ['silver', 'Silver', 'linear-gradient(145deg, #d6dae1 0%, #b3b9c5 55%, #939ba9 100%)', true],
];

export const CARD_SCHEMES = [['', 'None'], ['visa', 'Visa'], ['mastercard', 'Mastercard']];
const isLight = (colour) => !!CARD_COLOURS.find(([id]) => id === colour)?.[3];

export const CARD_PATTERNS = [
  ['none', 'Plain'],
  ['orbs', 'Orbs'],
  ['waves', 'Waves'],
  ['grid', 'Grid'],
  ['glass', 'Glass'],
];

// Default colour per wallet type, used until you pick one
const TYPE_COLOURS = {
  bank: 'royal', 'credit card': 'graphite', 'e-wallet': 'ocean', cash: 'emerald',
  savings: 'gold', investment: 'violet', stock: 'violet',
};

/** "royal|waves|•••• 0329|visa" → {colour, pattern, label, scheme}, with type-based defaults. */
export function parseCard(card, type = '') {
  const [colour = '', pattern = '', label = '', scheme = '', valid = ''] = String(card || '').split('|');
  const known = CARD_COLOURS.some(([id]) => id === colour);
  return {
    colour: known ? colour : TYPE_COLOURS[String(type).toLowerCase()] || 'midnight',
    pattern: CARD_PATTERNS.some(([id]) => id === pattern) ? pattern : 'orbs',
    label: label.slice(0, 24),
    scheme: CARD_SCHEMES.some(([id]) => id === scheme) ? scheme : '',
    valid: /^(0[1-9]|1[0-2])\/\d{2}$/.test(valid) ? valid : '',
  };
}

export const formatCard = ({ colour, pattern, label, scheme, valid }) =>
  [colour, pattern, String(label || '').replace(/\|/g, '').trim(), scheme || '', valid || ''].join('|').replace(/\|+$/, '');

const background = (colour) => (CARD_COLOURS.find(([id]) => id === colour) || CARD_COLOURS[1])[2];

const CONTACTLESS = '<svg class="wcard-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8.5 8.5a5 5 0 0 1 0 7"/><path d="M12 5.8a8.6 8.6 0 0 1 0 12.4"/><path d="M15.5 3a12.4 12.4 0 0 1 0 18"/></svg>';

// Card network logos; with no network chosen a generic card mark is shown
const NETWORKS = {
  mastercard: '<svg class="net-logo" viewBox="0 0 48 30" role="img" aria-label="Mastercard"><circle cx="17" cy="15" r="13" fill="#eb001b"/><circle cx="31" cy="15" r="13" fill="#f79e1b"/><path d="M24 4.6a13 13 0 0 1 0 20.8 13 13 0 0 1 0-20.8z" fill="#ff5f00"/></svg>',
  visa: '<svg class="net-logo" viewBox="0 0 48 30" role="img" aria-label="Visa"><text x="24" y="22" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-style="italic" font-weight="800" font-size="19" letter-spacing="-1" fill="currentColor">VISA</text></svg>',
  // No network chosen: a gold EMV chip
  '': '<svg class="chip-logo" viewBox="0 0 42 31" aria-hidden="true"><defs><linearGradient id="chip-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dc8a"/><stop offset="0.55" stop-color="#d9aa45"/><stop offset="1" stop-color="#b98427"/></linearGradient></defs><rect x="1" y="1" width="40" height="29" rx="6" fill="url(#chip-gold)"/><g fill="none" stroke="#7a5412" stroke-opacity="0.55" stroke-width="1.2"><path d="M1 10.5h12.5a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H1M41 10.5H28.5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3H41M16.5 1v8M25.5 1v8M16.5 22v8M25.5 22v8"/><rect x="16.5" y="9" width="9" height="13" rx="3"/></g></svg>',
};

/**
 * One card.
 * @param {object} o
 * @param {string} o.title      wallet name (or "All accounts")
 * @param {string} o.kicker     small text top-left (wallet type)
 * @param {string} o.caption    small text above the amount
 * @param {string} o.amountHtml the formatted amount (already escaped)
 * @param {string} [o.footHtml] bottom-left text (label or details, already escaped)
 * @param {object} o.style      {colour, pattern}
 * @param {string} [o.attrs]    extra attributes (data-action etc.)
 * @param {string} [o.tag]      'button' (default) or 'div'
 */
export function cardHtml({ title, kicker, caption, amountHtml, footHtml = '', style, attrs = '', tag = 'button', negative = false }) {
  return `
    <${tag} class="wcard pattern-${style.pattern} ${isLight(style.colour) ? 'is-light' : ''} ${negative ? 'is-negative' : ''}" style="--card-bg:${background(style.colour)}" ${attrs}>
      <span class="wcard-top"><span class="wcard-kicker">${esc(kicker)}</span><span class="wcard-title">${esc(title)}</span></span>
      ${CONTACTLESS}
      <span class="wcard-mid"><span class="wcard-caption">${esc(caption)}</span><span class="wcard-amount">${amountHtml}</span></span>
      <span class="wcard-foot"><span class="wcard-foot-left"><span class="wcard-label">${footHtml}</span>${style.valid ? `<span class="wcard-valid"><small>VALID THRU</small>${esc(style.valid)}</span>` : ''}</span>${NETWORKS[style.scheme || '']}</span>
    </${tag}>`;
}

/**
 * "Customize card" sheet with a live preview.
 * @param {object} o
 * @param {object} o.wallet   {name, type, card}
 * @param {string} o.amountHtml formatted balance for the preview
 * @param {boolean} o.negative
 * @param {Function} o.onSave async (cardString) => void
 */
const pad2 = (n) => String(n).padStart(2, '0');
/** Two-digit years from this year for 15 years (plus the saved one if it falls outside). */
function validYears(current) {
  const first = new Date().getFullYear() % 100;
  const years = Array.from({ length: 16 }, (_, i) => pad2((first + i) % 100));
  if (current && !years.includes(current)) years.unshift(current);
  return years;
}

export function openCardSheet({ wallet, amountHtml, negative, onSave }) {
  const style = parseCard(wallet.card, wallet.type);
  let busy = false;
  let error = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet sheet-short" role="dialog" aria-modal="true" aria-label="Customize ${esc(wallet.name)} card"></div>`;
  const sheet = backdrop.firstElementChild;
  document.body.appendChild(backdrop);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => backdrop.classList.add('open'));
  const close = () => {
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    setTimeout(() => backdrop.remove(), 300);
  };

  const preview = () => cardHtml({
    title: wallet.name,
    kicker: wallet.type || 'Other',
    caption: 'Balance',
    amountHtml,
    footHtml: esc(style.label || '•••• ••••'),
    style,
    tag: 'div',
    negative,
  });

  function render() {
    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <header class="sheet-head">
        <button type="button" class="link" data-act="cancel">Cancel</button>
        <h2>Customize card</h2>
        <button type="button" class="link end" data-act="reset">Reset</button>
      </header>
      <div class="sheet-body">
        <div class="card-preview">${preview()}</div>
        <p class="field-label">Colour</p>
        <div class="swatches" role="radiogroup" aria-label="Card colour">
          ${CARD_COLOURS.map(([id, name, bg, light]) => `
            <button type="button" class="swatch-btn ${light ? 'light' : ''} ${style.colour === id ? 'active' : ''}" style="--card-bg:${bg}" data-act="colour" data-v="${id}" role="radio" aria-checked="${style.colour === id}" aria-label="${name}" title="${name}"></button>`).join('')}
        </div>
        <p class="field-label">Pattern</p>
        <div class="chip-row wrap">
          ${CARD_PATTERNS.map(([id, name]) => `<button type="button" class="chip ${style.pattern === id ? 'active' : ''}" data-act="pattern" data-v="${id}" aria-pressed="${style.pattern === id}">${name}</button>`).join('')}
        </div>
        <p class="field-label">Card network <span class="muted">(optional)</span></p>
        <div class="chip-row wrap">
          ${CARD_SCHEMES.map(([id, name]) => `<button type="button" class="chip ${style.scheme === id ? 'active' : ''}" data-act="scheme" data-v="${id}" aria-pressed="${style.scheme === id}">${name}</button>`).join('')}
        </div>
        <label class="field">
          <span class="field-label">Label on the card <span class="muted">(optional)</span></span>
          <input class="note-input" data-f="label" maxlength="24" placeholder="e.g. •••• 0329 or Daily spending" value="${esc(style.label)}">
        </label>
        <label class="switch-row">
          <span><strong>Show valid thru</strong><span class="muted small">Optional, shown after the label as month / year.</span></span>
          <input type="checkbox" class="switch" data-f="valid-on" role="switch" ${style.valid ? 'checked' : ''}>
        </label>
        ${style.valid ? `
        <div class="valid-row">
          <select data-f="valid-month" aria-label="Valid thru month">${Array.from({ length: 12 }, (_, i) => pad2(i + 1)).map((m) => `<option ${m === style.valid.slice(0, 2) ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <span class="valid-slash">/</span>
          <select data-f="valid-year" aria-label="Valid thru year">${validYears(style.valid.slice(3)).map((y) => `<option ${y === style.valid.slice(3) ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </div>` : ''}
        <p class="muted small field-help">Saved in your sheet (Wallets → Card), so the card looks the same on every device.</p>
      </div>
      <div class="sheet-foot">
        ${error ? `<p class="form-status error" role="alert">${esc(error)}</p>` : ''}
        <button type="button" class="btn-primary save" data-act="save" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save card'}</button>
      </div>`;
  }

  const refreshPreview = () => { sheet.querySelector('.card-preview').innerHTML = preview(); };

  backdrop.addEventListener('click', async (event) => {
    if (event.target === backdrop) { if (!busy) close(); return; }
    const el = event.target.closest('[data-act]');
    if (busy || !el) return;
    const { act, v } = el.dataset;
    if (act === 'cancel') { close(); return; }
    if (act === 'colour' || act === 'pattern' || act === 'scheme' || act === 'reset') {
      if (act === 'colour') style.colour = v;
      if (act === 'scheme') style.scheme = v;
      if (act === 'pattern') style.pattern = v;
      if (act === 'reset') Object.assign(style, parseCard('', wallet.type), { label: '', scheme: '', valid: '' });
      const scroll = sheet.querySelector('.sheet-body').scrollTop;
      render();
      sheet.querySelector('.sheet-body').scrollTop = scroll;
      return;
    }
    if (act === 'save') {
      busy = true;
      error = '';
      render();
      try {
        await onSave(formatCard(style));
        close();
      } catch (e) {
        busy = false;
        error = e.message || 'Could not save.';
        render();
      }
    }
  });

  // Valid thru: switch on/off and the two selects
  backdrop.addEventListener('change', (event) => {
    const f = event.target.dataset.f;
    if (!f || !f.startsWith('valid')) return;
    if (f === 'valid-on') {
      const now = new Date();
      style.valid = event.target.checked ? `${pad2(now.getMonth() + 1)}/${pad2((now.getFullYear() + 3) % 100)}` : '';
    } else {
      const month = sheet.querySelector('[data-f="valid-month"]').value;
      const year = sheet.querySelector('[data-f="valid-year"]').value;
      style.valid = `${month}/${year}`;
    }
    const scroll = sheet.querySelector('.sheet-body').scrollTop;
    render();
    sheet.querySelector('.sheet-body').scrollTop = scroll;
  });

  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f !== 'label') return;
    style.label = event.target.value.replace(/\|/g, '');
    refreshPreview();
  });

  render();
}
