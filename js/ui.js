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

const CATEGORY_ICONS = {
  'food & drinks': '🍽️', transport: '🚗', shopping: '🛍️', 'bills & utilities': '🧾', housing: '🏠',
  health: '💊', entertainment: '🎬', education: '📚', travel: '✈️', 'gifts & donations': '🎁',
  salary: '💼', bonus: '🎉', business: '🏪', investment: '📈', gift: '🎁', other: '🏷️',
};

export const categoryIcon = (name) => CATEGORY_ICONS[String(name).toLowerCase()] || '🏷️';
