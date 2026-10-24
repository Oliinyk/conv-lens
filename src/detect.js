// Looks at a site from the server so the owner does not have to answer questions about it:
// what it is built on, and whether the Conv Lens tag is actually on the page.
// This is the "is it installed?" answer that otherwise takes a developer and a browser console.
import { lookup } from 'node:dns/promises';

const PLATFORMS = [
  { id: 'woocommerce', name: 'WooCommerce', re: /woocommerce|wc-ajax|wp-content\/plugins\/woocommerce/i },
  { id: 'shopify', name: 'Shopify', re: /cdn\.shopify\.com|Shopify\.theme|shopify-features/i },
  { id: 'opencart', name: 'OpenCart', re: /index\.php\?route=|catalog\/view\/theme|opencart/i },
  { id: 'horoshop', name: 'Horoshop', re: /horoshop/i, preset: 'opencart' },
  { id: 'prestashop', name: 'PrestaShop', re: /prestashop/i, preset: 'shop' },
  { id: 'magento', name: 'Magento', re: /Magento_|data-mage-init|x-magento-init|static\/version\d+\/frontend/i, preset: 'shop' },
  { id: 'tilda', name: 'Tilda', re: /tildacdn\.com|tilda\.cc/i, preset: 'leadgen' },
  { id: 'wix', name: 'Wix', re: /wixstatic\.com|_wixCssStates/i, preset: 'leadgen' },
  { id: 'webflow', name: 'Webflow', re: /webflow\.js|data-wf-site/i, preset: 'leadgen' },
  { id: 'wordpress', name: 'WordPress', re: /wp-content\/|wp-includes\/|wp-json/i, preset: 'leadgen' }
];

// A shop that is clearly a shop, even when the engine is unknown.
const SHOP_HINTS = /add[-_ ]?to[-_ ]?cart|додати в кошик|в кошик|у кошик|checkout|оформити замовлення|корзин/i;

const PRIVATE_IP = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:)/i;

// A URL the dashboard will fetch is a URL someone typed, so it must not be usable to reach
// the host's own network. Public http(s) addresses only.
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Підтримуються лише http:// і https://');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('Це локальна адреса — вкажіть публічну адресу сайту');
  }
  let addrs = [];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('Такого домену не існує або він не відповідає');
  }
  if (addrs.some((a) => PRIVATE_IP.test(a.address))) {
    throw new Error('Адреса веде у внутрішню мережу — вкажіть публічну адресу сайту');
  }
}

async function fetchPage(url) {
  const u = new URL(url);
  await assertPublic(u);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(u.href, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ConvLensSetup/2.0; +https://github.com/Oliinyk/conv-lens)',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) return { status: res.status, finalUrl: res.url, html: '' };
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < 600000) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
    }
    try { await reader.cancel(); } catch {}
    return { status: res.status, finalUrl: res.url, html: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

// A page title is usually "Brand — tagline, keywords, more keywords"; only the first part
// is a usable site name.
const titleOf = (html) => {
  const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  if (!m) return '';
  const full = m[1].replace(/\s+/g, ' ').trim();
  const head = full.split(/\s[|—–·•]\s|\s-\s|:\s/)[0].trim();
  return (head.length >= 3 ? head : full).slice(0, 60);
};

export async function inspectSite(url, siteKey = '') {
  let page;
  try {
    page = await fetchPage(url);
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Сайт не відповів за 9 секунд' : (e.message || 'Не вдалось відкрити сайт') };
  }
  if (page.status >= 400) {
    return { ok: false, error: `Сайт відповів кодом ${page.status}`, status: page.status };
  }
  if (!page.html) {
    return { ok: false, error: 'За цією адресою не HTML-сторінка', status: page.status };
  }

  const html = page.html;
  const hit = PLATFORMS.find((p) => p.re.test(html));
  const looksLikeShop = SHOP_HINTS.test(html);
  const preset = hit ? (hit.preset || hit.id) : (looksLikeShop ? 'shop' : 'leadgen');

  // The tag, and whether it is this site's tag: a key from another site records elsewhere.
  const tags = [...html.matchAll(/<script[^>]+src=["']([^"']*\/cl\/t\.js[^"']*)["']/gi)].map((m) => m[1]);
  const keys = tags.map((src) => (src.match(/[?&]s=([A-Za-z0-9_-]+)/) || [])[1]).filter(Boolean);
  const placeholder = tags.some((t) => /CONV-LENS-HOST|CONV-LENS-SITE-KEY|ВАШ-CONV-LENS/.test(t));

  return {
    ok: true,
    status: page.status,
    finalUrl: page.finalUrl,
    title: titleOf(html),
    platform: hit ? hit.name : (looksLikeShop ? 'магазин (двигун не впізнали)' : 'звичайний сайт'),
    preset,
    tag: {
      found: tags.length > 0,
      placeholder,
      src: tags[0] || '',
      keyMatches: siteKey ? keys.includes(siteKey) : null,
      otherKey: siteKey && keys.length > 0 && !keys.includes(siteKey)
    }
  };
}
