// Wallet cards: each wallet shows as a payment-card-style tile on Home, and you can style it yourself
// (colour, pattern, a label such as "•••• 0329"). The look is saved in the sheet's Wallets → Card column
// as "colour|pattern|label", so it's the same on every device.
import { walletIcon } from './calc.js';
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
];

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

/** "royal|waves|•••• 0329" → {colour, pattern, label}, with type-based defaults. */
export function parseCard(card, type = '') {
  const [colour = '', pattern = '', label = ''] = String(card || '').split('|');
  const known = CARD_COLOURS.some(([id]) => id === colour);
  return {
    colour: known ? colour : TYPE_COLOURS[String(type).toLowerCase()] || 'midnight',
    pattern: CARD_PATTERNS.some(([id]) => id === pattern) ? pattern : 'orbs',
    label: label.slice(0, 24),
  };
}

export const formatCard = ({ colour, pattern, label }) => [colour, pattern, String(label || '').replace(/\|/g, '').trim()].join('|');

const background = (colour) => (CARD_COLOURS.find(([id]) => id === colour) || CARD_COLOURS[1])[2];

const CHIP = '<svg class="card-chip" viewBox="0 0 34 26" aria-hidden="true"><rect x=".5" y=".5" width="33" height="25" rx="6"/><path d="M11 .5v25M23 .5v25M.5 9h10.5M23 9h10.5M.5 17h10.5M23 17h10.5"/></svg>';

/**
 * One card.
 * @param {object} o
 * @param {string} o.title      wallet name (or "All accounts")
 * @param {string} o.kicker     small text top-right (wallet type)
 * @param {string} o.caption    small text above the amount
 * @param {string} o.amountHtml the formatted amount (already escaped)
 * @param {string} [o.footHtml] bottom-left text (label or details, already escaped)
 * @param {object} o.style      {colour, pattern}
 * @param {string} [o.attrs]    extra attributes (data-action etc.)
 * @param {string} [o.tag]      'button' (default) or 'div'
 */
export function cardHtml({ title, kicker, caption, amountHtml, footHtml = '', style, attrs = '', tag = 'button', negative = false }) {
  return `
    <${tag} class="wcard pattern-${style.pattern} ${negative ? 'is-negative' : ''}" style="--card-bg:${background(style.colour)}" ${attrs}>
      <span class="wcard-top"><span class="wcard-title">${esc(title)}</span><span class="wcard-kicker">${esc(kicker)}</span></span>
      <span class="wcard-mid"><span class="wcard-caption">${esc(caption)}</span><span class="wcard-amount">${amountHtml}</span></span>
      <span class="wcard-foot"><span class="wcard-label">${footHtml}</span>${CHIP}</span>
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
    kicker: `${walletIcon(wallet.type)} ${wallet.type}`,
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
          ${CARD_COLOURS.map(([id, name, bg]) => `
            <button type="button" class="swatch-btn ${style.colour === id ? 'active' : ''}" style="--card-bg:${bg}" data-act="colour" data-v="${id}" role="radio" aria-checked="${style.colour === id}" aria-label="${name}" title="${name}"></button>`).join('')}
        </div>
        <p class="field-label">Pattern</p>
        <div class="chip-row wrap">
          ${CARD_PATTERNS.map(([id, name]) => `<button type="button" class="chip ${style.pattern === id ? 'active' : ''}" data-act="pattern" data-v="${id}" aria-pressed="${style.pattern === id}">${name}</button>`).join('')}
        </div>
        <label class="field">
          <span class="field-label">Label on the card <span class="muted">(optional)</span></span>
          <input class="note-input" data-f="label" maxlength="24" placeholder="e.g. •••• 0329 or Daily spending" value="${esc(style.label)}">
        </label>
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
    if (act === 'colour' || act === 'pattern' || act === 'reset') {
      if (act === 'colour') style.colour = v;
      if (act === 'pattern') style.pattern = v;
      if (act === 'reset') Object.assign(style, parseCard('', wallet.type), { label: '' });
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

  backdrop.addEventListener('input', (event) => {
    if (event.target.dataset.f !== 'label') return;
    style.label = event.target.value.replace(/\|/g, '');
    refreshPreview();
  });

  render();
}
