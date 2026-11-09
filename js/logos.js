// Bank, e-wallet and broker logos for the wallet list. The name you give a wallet ("BCA", "Credit Card - BCA",
// "GoPay") is matched against the list below; the pictures are bundled in img/logos (no network needed).
// A wallet whose name isn't known gets an icon for its type instead, and you can set a logo yourself in
// Customize card → "Logo website" (for example bca.co.id).
import { CHIPS, MONO } from './logo-data.js';
import { esc, icon } from './ui.js';

const RULES = [
  ['bca', /\bbca\b|klikbca/], ['blu', /\bblu\b/], ['mandiri', /mandiri|livin/], ['bni', /\bbni\b/], ['bri', /\bbri\b|brimo/],
  ['cimb', /cimb|octo/], ['dbs', /\bdbs\b|digibank/], ['jago', /\bjago\b/], ['seabank', /sea ?bank/],
  ['gopay', /go-?pay|gojek/], ['ovo', /\bovo\b/], ['dana', /\bdana\b/], ['shopeepay', /shopee/], ['jenius', /jenius|btpn/],
  ['ocbc', /ocbc/], ['permata', /permata/], ['danamon', /danamon/], ['btn', /\bbtn\b/], ['bsi', /\bbsi\b|syariah indonesia/],
  ['maybank', /maybank/], ['hsbc', /hsbc/], ['scb', /standard chartered|\bscb\b/], ['paypal', /paypal/], ['wise', /\bwise\b|transferwise/],
  ['stockbit', /stockbit/], ['ajaib', /ajaib/], ['binance', /binance/], ['indodax', /indodax/], ['tokocrypto', /tokocrypto/],
  ['pluang', /pluang/], ['kredivo', /kredivo/], ['akulaku', /akulaku/], ['revolut', /revolut/], ['tokopedia', /tokopedia|tokped/],
  ['traveloka', /traveloka/], ['airwallex', /airwallex/], ['nex', /\bnex\b/], ['superbank', /super ?bank/],
];

// logos that are wide even as a tile: they get less padding so the lettering stays readable
const WIDE_TILES = ['bca', 'mandiri', 'stockbit'];

const TYPE_ICONS = {
  bank: 'bank', cash: 'coins', 'e-wallet': 'device-mobile', 'credit card': 'credit-card',
  savings: 'piggy-bank', investment: 'chart-line-up', stock: 'chart-line-up',
};

/** The bundled logo's file name for a wallet name, or '' when none matches. */
export function logoKey(name) {
  const n = String(name || '').toLowerCase();
  const hit = RULES.find(([, re]) => re.test(n));
  return hit ? hit[0] : '';
}

/** Picture address: your own website if you set one, else a bundled logo, else ''. */
export function logoSrc(name, custom = '') {
  const domain = String(custom || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9.-]{3,60}$/.test(domain)) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  const key = logoKey(name);
  return key ? `img/logos/${key}.png` : '';
}

/** The round logo tile: the picture on top of a type icon, which stays visible if the picture can't load. */
export function walletLogo(wallet, custom = '') {
  const src = logoSrc(wallet.name, custom);
  const key = custom ? '' : logoKey(wallet.name);
  const glyph = icon(TYPE_ICONS[String(wallet.type || '').toLowerCase()] || 'wallet');
  return `<span class="wlogo ${src ? 'has-img' : ''} ${WIDE_TILES.includes(key) ? 'wide' : ''}">${glyph}${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

/**
 * The logo at the top right of a card, in the card's text colour so it always contrasts with the background
 * (one-colour logos are drawn as a mask; solid-square ones and your own website's logo sit in a small white chip).
 * BCA's logo (and any other wordmark that already says the name, like Mandiri or Superbank) replaces the wallet name. → {html, hideTitle}
 */
export function cardBrand(name, custom = '') {
  const domain = String(custom || '').trim();
  if (domain) {
    return { html: `<img class="wcard-chip" src="${esc(logoSrc(name, domain))}" alt="" onerror="this.remove()">`, hideTitle: false };
  }
  const key = logoKey(name);
  if (!key) return { html: '', hideTitle: false };
  if (MONO[key]) {
    const big = MONO[key] >= 2.5; // a wordmark that already says the name: shown larger, and the wallet name is left out
    return {
      html: `<span class="wcard-brand ${big ? 'big' : ''}" role="img" aria-label="${esc(name)}" style="--ar:${MONO[key]};-webkit-mask-image:url(img/logos/mono/${key}.png);mask-image:url(img/logos/mono/${key}.png)"></span>`,
      hideTitle: big,
    };
  }
  if (CHIPS.includes(key)) return { html: `<img class="wcard-chip" src="img/logos/${key}.png" alt="" onerror="this.remove()">`, hideTitle: false };
  return { html: '', hideTitle: false };
}
