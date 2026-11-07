// Small shared UI helpers: HTML escaping, icons, category emoji.

/** Escapes text from the sheet before putting it into HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>'),
  transactions: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  budgets: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  reports: svg('<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  backspace: svg('<path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  goal: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  wallets: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5z"/><circle cx="16" cy="13.5" r="1.2"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  check: svg('<circle cx="12" cy="12" r="9.5"/><path d="M7.8 12.4l2.9 2.9 5.6-6"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>'),
};

/**
 * Escapes `text` and wraps every case-insensitive match of `query` in <mark>.
 * Matching runs on the raw text, so "&" in a query can never break the HTML.
 */
export function highlight(text, query) {
  const raw = String(text ?? '');
  const q = String(query || '').trim().toLowerCase();
  if (!q) return esc(raw);
  let html = '';
  let from = 0;
  const lower = raw.toLowerCase();
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    html += esc(raw.slice(from, at)) + `<mark>${esc(raw.slice(at, at + q.length))}</mark>`;
    from = at + q.length;
  }
  return html + esc(raw.slice(from));
}

/** True when the phone asks for less motion (Settings → Accessibility → Motion). */
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

import { PH } from './icon-data.js';

/** An inline Phosphor duotone icon (see icon-data.js). It takes the surrounding text colour. */
export const icon = (name, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${PH[name] || PH.tag}</svg>`;

// First match wins, so "Transport" is checked before "sport"
const CATEGORY_RULES = [
  [/adjust/, 'scales'],
  [/transfer/, 'arrows-left-right'],
  [/groc|supermarket/, 'shopping-cart'],
  [/coffee|cafe/, 'coffee'],
  [/food|drink|dining|restaurant|meal|eat/, 'fork-knife'],
  [/fuel|petrol|gasoline/, 'gas-pump'],
  [/public transport|bus|commute/, 'bus'],
  [/transport|taxi|ride|car|parking|toll/, 'car'],
  [/shop|cloth|fashion|apparel/, 'shopping-bag'],
  [/electric|power/, 'lightning'],
  [/water/, 'drop'],
  [/internet|wifi/, 'wifi-high'],
  [/phone|mobile|pulsa|data plan/, 'device-mobile'],
  [/bill|utilit|tax/, 'receipt'],
  [/hous|rent|home|mortgage/, 'house'],
  [/pharm|medic|drug/, 'pill'],
  [/health|doctor|hospital|clinic/, 'heartbeat'],
  [/fitness|gym|\bsports?\b/, 'barbell'],
  [/movie|cinema|film/, 'film-slate'],
  [/game/, 'game-controller'],
  [/music/, 'music-notes'],
  [/subscri|streaming/, 'repeat'],
  [/entertain|fun|hobby/, 'popcorn'],
  [/educat|school|course|tuition|book|study/, 'graduation-cap'],
  [/travel|trip|flight|holiday|vacation|hotel/, 'airplane-tilt'],
  [/gift|donat|charity|zakat|tithe/, 'gift'],
  [/salary|wage|payroll|paycheck/, 'briefcase'],
  [/bonus|reward|prize/, 'confetti'],
  [/business|store|sales/, 'storefront'],
  [/saving/, 'piggy-bank'],
  [/invest|stock|dividend|crypto/, 'chart-line-up'],
  [/insur/, 'shield-check'],
  [/pet|dog|cat\b/, 'paw-print'],
  [/kid|child|baby/, 'baby'],
  [/beauty|salon|care|spa/, 'sparkle'],
  [/loan|debt|credit|installment/, 'hand-coins'],
  [/interest/, 'percent'],
  [/refund|cashback/, 'arrow-counter-clockwise'],
  [/repair|maintenance|service/, 'wrench'],
  [/electronic|gadget/, 'devices'],
];

/** Icon for a category (or subcategory) name; anything unknown gets a tag. */
export const categoryIcon = (name) => {
  const n = String(name || '').toLowerCase();
  const hit = CATEGORY_RULES.find(([re]) => re.test(n));
  return icon(hit ? hit[1] : 'tag');
};
