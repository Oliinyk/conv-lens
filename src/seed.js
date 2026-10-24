import { ingestBatch } from './ingest.js';

const UA = {
  desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  mobileSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mobileChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
};

const MODELS = ['seiko-presage-ssa392', 'casio-ga-2100', 'orient-bambino-v4', 'tissot-prx-powermatic', 'citizen-promaster-ny0040', 'certina-ds-action'];
const REFS = [
  { ref: 'https://www.google.com/', w: 46 },
  { ref: '', w: 22 },
  { ref: 'https://www.facebook.com/', w: 14 },
  { ref: 'https://www.instagram.com/', w: 8 },
  { ref: 'https://t.me/', w: 5 },
  { ref: 'https://hotline.ua/', w: 5 }
];

let rng = 42;
function rnd() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
function weighted(list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = rnd() * total;
  for (const x of list) { r -= x.w; if (r <= 0) return x; }
  return list[0];
}
const uid = () => Math.random().toString(16).slice(2, 11) + Date.now().toString(16).slice(-5);

function layout(device, kind) {
  const w = device === 'mobile' ? 390 : 1440;
  const els = [];
  const push = (x, y, ww, h, k, t, extra = {}) => els.push({ x, y, w: ww, h, k, t, ...extra });
  const pad = device === 'mobile' ? 16 : 120;
  const cw = w - pad * 2;
  push(0, 0, w, 64, 'box', '', { bg: 'rgb(17,17,17)' });
  push(pad, 20, 150, 24, 'heading', 'CHRONO.UA', { c: 'rgb(255,255,255)', fs: 18, fw: '700' });
  if (device !== 'mobile') {
    ['Годинники', 'Бренди', 'Аксесуари', 'Доставка', 'Контакти'].forEach((t, i) =>
      push(pad + 300 + i * 120, 24, 110, 18, 'link', t, { c: 'rgb(230,230,230)', fs: 14, fw: '400', sel: 'nav>a:nth-of-type(' + (i + 1) + ')' }));
  } else {
    push(w - 56, 20, 32, 24, 'button', '☰', { c: 'rgb(255,255,255)', fs: 20, fw: '400', sel: '.menu-toggle' });
  }
  if (kind === 'product') {
    const imgH = device === 'mobile' ? 360 : 520;
    push(pad, 96, device === 'mobile' ? cw : 560, imgH, 'img', '', { sel: '.woocommerce-product-gallery__image' });
    const colX = device === 'mobile' ? pad : pad + 620;
    let y = device === 'mobile' ? 96 + imgH + 24 : 110;
    push(colX, y, device === 'mobile' ? cw : 560, 36, 'heading', 'Seiko Presage SSA392J1 Cocktail Time', { c: 'rgb(17,17,17)', fs: device === 'mobile' ? 24 : 30, fw: '700' });
    y += device === 'mobile' ? 70 : 56;
    push(colX, y, 220, 34, 'heading', '18 450 ₴', { c: 'rgb(17,17,17)', fs: 28, fw: '700' });
    push(colX + 240, y + 8, 160, 20, 'box', '21 900 ₴', { c: 'rgb(130,130,130)', fs: 16, fw: '400' });
    y += 58;
    push(colX, y, 180, 22, 'box', 'В наявності · 3 шт', { c: 'rgb(12,163,12)', fs: 15, fw: '500' });
    y += 46;
    push(colX, y, 120, 20, 'box', 'Ремінець', { c: 'rgb(82,81,78)', fs: 14, fw: '500' });
    y += 28;
    ['Сталь', 'Шкіра', 'Каучук'].forEach((t, i) =>
      push(colX + i * 104, y, 96, 44, 'button', t, { c: 'rgb(17,17,17)', fs: 14, fw: '500', sel: '.variation-strap .swatch:nth-of-type(' + (i + 1) + ')' }));
    y += 72;
    const ctaY = device === 'mobile' ? y + 120 : y;
    if (device === 'mobile') {
      push(pad, y, cw, 96, 'box', 'Офіційна гарантія 24 місяці. Доставка Новою поштою 1–2 дні.', { c: 'rgb(82,81,78)', fs: 14, fw: '400' });
    }
    push(colX, ctaY, device === 'mobile' ? cw : 320, 56, 'button', 'Додати в кошик', { bg: 'rgb(17,17,17)', c: 'rgb(255,255,255)', fs: 17, fw: '600', sel: '.single_add_to_cart_button' });
    push(colX, ctaY + 76, device === 'mobile' ? cw : 320, 220, 'box', 'Характеристики: механізм 4R35, сапфірове скло, 50 м, діаметр 40.5 мм', { c: 'rgb(82,81,78)', fs: 14, fw: '400' });
    return { w, h: ctaY + 640, els, ctaY };
  }
  if (kind === 'checkout') {
    let y = 110;
    push(pad, y, cw, 36, 'heading', 'Оформлення замовлення', { c: 'rgb(17,17,17)', fs: 28, fw: '700' });
    y += 64;
    const fw2 = device === 'mobile' ? cw : 620;
    [['billing_first_name', "Ім'я"], ['billing_last_name', 'Прізвище'], ['billing_phone', 'Телефон'], ['billing_email', 'E-mail'], ['billing_city', 'Місто'], ['billing_address_1', 'Відділення Нової Пошти']].forEach(([n, l]) => {
      push(pad, y, fw2, 20, 'box', l, { c: 'rgb(82,81,78)', fs: 13, fw: '500' });
      push(pad, y + 24, fw2, 48, 'input', l, { sel: 'input[name=' + n + ']' });
      y += 92;
    });
    push(pad, y, fw2, 120, 'box', 'Разом: 18 450 ₴ · Доставка: 250 ₴ · Накладний платіж +20 ₴', { c: 'rgb(17,17,17)', fs: 16, fw: '600' });
    y += 150;
    push(pad, y, fw2, 56, 'button', 'Підтвердити замовлення', { bg: 'rgb(17,17,17)', c: 'rgb(255,255,255)', fs: 17, fw: '600', sel: '#place_order' });
    return { w, h: y + 200, els, ctaY: y };
  }
  let y = 100;
  push(pad, y, cw, 34, 'heading', 'Чоловічі механічні годинники', { c: 'rgb(17,17,17)', fs: 26, fw: '700' });
  y += 60;
  const cols = device === 'mobile' ? 2 : 4;
  const cardW = Math.floor((cw - (cols - 1) * 20) / cols);
  for (let i = 0; i < cols * 3; i++) {
    const cx = pad + (i % cols) * (cardW + 20);
    const cy = y + Math.floor(i / cols) * 380;
    push(cx, cy, cardW, 240, 'img', '', { sel: '.product:nth-of-type(' + (i + 1) + ') img' });
    push(cx, cy + 252, cardW, 40, 'link', 'Seiko / Orient / Citizen модель ' + (i + 1), { c: 'rgb(17,17,17)', fs: 15, fw: '500', sel: '.product:nth-of-type(' + (i + 1) + ') a' });
    push(cx, cy + 300, 120, 24, 'box', int(4, 24) + ' 900 ₴', { c: 'rgb(17,17,17)', fs: 18, fw: '700' });
  }
  return { w, h: y + 3 * 380 + 200, els, ctaY: 0 };
}

export async function seed(db, cfg, opts = {}) {
  const days = opts.days || 14;
  const perDay = opts.perDay || 64;
  const now = Date.now();
  let made = 0, orders = 0;
  // A pool of known visitors so some sessions are people coming back, not only first-timers.
  const visitors = [];
  const GEO = [
    { country: 'UA', region: '30', cities: ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv', 'Dnipro'], w: 62 },
    { country: 'PL', region: '14', cities: ['Warsaw', 'Krakow', 'Wroclaw'], w: 16 },
    { country: 'DE', region: 'BE', cities: ['Berlin', 'Munich', 'Hamburg'], w: 14 },
    { country: 'CZ', region: '10', cities: ['Prague', 'Brno'], w: 8 }
  ];

  for (let d = days - 1; d >= 0; d--) {
    const dayStart = now - d * 86400000 - 14 * 3600000;
    const volume = Math.round(perDay * (0.7 + rnd() * 0.6));
    for (let i = 0; i < volume; i++) {
      const isMobile = chance(0.68);
      const device = isMobile ? 'mobile' : chance(0.88) ? 'desktop' : 'tablet';
      const ua = isMobile ? (chance(0.55) ? UA.mobileSafari : UA.mobileChrome) : (chance(0.8) ? UA.desktopChrome : UA.desktopFirefox);
      const vw = device === 'mobile' ? pick([390, 375, 412]) : device === 'tablet' ? 820 : pick([1440, 1536, 1920]);
      const vh = device === 'mobile' ? pick([664, 844, 915]) : 900;
      const src = weighted(REFS);
      const t0 = dayStart + int(0, 13) * 3600000 + int(0, 59) * 60000;
      const sid = uid();
      // A returning visitor reuses an id from an earlier day, so "new vs returning" is real.
      const back = visitors.length > 12 && chance(0.3);
      const vid = back ? visitors[int(0, visitors.length - 1)] : uid();
      if (!back) visitors.push(vid);
      const geo = weighted(GEO);
      const city = pick(geo.cities);
      const model = pick(MODELS);
      const isFb = /facebook/.test(src.ref);
      const slowDay = d > 9;

      const events = [];
      let ts = t0, seq = 0;
      let path = chance(0.4) ? '/catalog/men' : `/product/${model}`;
      const push = (type, data, gap = int(400, 2500)) => {
        ts += gap; events.push({ t: type, ts, p: path, s: ++seq, d: data });
      };

      events.push({ t: 'session_start', ts, p: path, s: ++seq, d: { ref: src.ref, entry: path } });
      const perfLcp = device === 'mobile'
        ? (path.startsWith('/catalog') ? int(3800, 6200) : int(2100, 4200)) + (slowDay ? 900 : 0)
        : int(1200, 2600);
      push('perf', { metric: 'ttfb', value: int(180, 900) }, 60);
      push('perf', { metric: 'lcp', value: perfLcp }, 80);
      push('pageview', { step: path.startsWith('/catalog') ? 'catalog' : 'product', title: 'CHRONO.UA' }, 20);

      const lay = layout(device, path.startsWith('/catalog') ? 'catalog' : 'product');
      events.push({ t: 'snapshot', ts: ts + 900, p: path, s: ++seq, d: { w: lay.w, h: lay.h, els: lay.els } });

      if (isFb && chance(0.72)) {
        push('scroll', { y: int(0, 200), depth: int(8, 25) });
        push('page_leave', { ms: int(1200, 6000), depth: int(8, 25), dirChanges: 1, lastField: '' });
        await flushSession();
        continue;
      }

      const mouseP = [];
      for (let m = 0; m < int(6, 22); m++) mouseP.push([int(0, lay.w), int(0, Math.min(lay.h, 2200)), m * 300]);
      push('mouse', { pts: mouseP }, 300);

      let depth = 0;
      const scrolls = int(2, 7);
      for (let s2 = 0; s2 < scrolls; s2++) {
        depth = Math.min(100, depth + int(8, 28));
        push('scroll', { y: Math.round((depth / 100) * lay.h), depth, since: ts - t0 });
      }
      if (device === 'mobile' && chance(0.3)) push('hscroll', { sw: lay.w + 40, cw: lay.w });
      if (device === 'mobile' && chance(0.22)) push('zoom', { scale: 1.6 });

      if (path.startsWith('/catalog')) {
        if (chance(0.62)) {
          push('click', { sel: '.product:nth-of-type(3)>a', label: 'Orient Bambino', tag: 'A', inter: 1, x: 300, y: 500, ew: 240, eh: 40 });
          path = `/product/${model}`;
          push('pageview', { step: 'product', title: model }, 1200);
          const pl = layout(device, 'product');
          events.push({ t: 'snapshot', ts: ts + 800, p: path, s: ++seq, d: { w: pl.w, h: pl.h, els: pl.els } });
          lay.ctaY = pl.ctaY;
        } else {
          push('exit_intent', { since: ts - t0, depth });
          push('page_leave', { ms: ts - t0, depth, dirChanges: int(2, 9), lastField: '' });
          await flushSession();
          continue;
        }
      }

      const ctaBelowFold = device === 'mobile' && lay.ctaY > vh;
      push('element_pos', { sel: '.single_add_to_cart_button', label: 'Додати в кошик', y: lay.ctaY, fold: vh }, 150);
      const sawCta = !ctaBelowFold || depth > 45;
      if (sawCta) push('element_seen', { sel: '.single_add_to_cart_button', label: 'Додати в кошик', after: ts - t0, kind: 'cta' });

      if (chance(0.34)) {
        push('dead_click', { sel: '.woocommerce-product-gallery__image', label: '', tag: 'IMG', x: 300, y: 400 });
        if (chance(0.3)) push('dead_click', { sel: '.woocommerce-product-gallery__image', label: '', tag: 'IMG', x: 310, y: 420 });
      }
      if (chance(0.18)) push('copy', { text: 'Seiko Presage SSA392' });

      const wantsCart = sawCta && chance(device === 'mobile' ? 0.16 : 0.17);
      if (!wantsCart) {
        if (chance(0.4)) push('exit_intent', { since: ts - t0, depth });
        if (chance(0.12)) {
          push('survey_shown', { step: 'product' });
          push('survey_answer', {
            answer: weighted([
              { v: 'Ціна зависока', w: 30 }, { v: 'Умови доставки / оплати', w: 26 },
              { v: 'Мало інформації про годинник', w: 18 }, { v: 'Не знайшов потрібну модель', w: 12 },
              { v: 'Сайт незручний або щось зламалось', w: 8 }, { v: 'Просто дивлюсь, не збирався купувати', w: 6 }
            ]).v,
            text: chance(0.25) ? pick(['Доставка дорожча ніж у конкурентів', 'Не зрозумів чи є гарантія', 'Хотів оригінал а тут незрозуміло', 'Довго думаю, ціна велика']) : '',
            step: 'product'
          });
        }
        push('page_leave', { ms: ts - t0, depth, dirChanges: int(2, 11), lastField: '' });
        await flushSession();
        continue;
      }

      push('click', { sel: '.single_add_to_cart_button', label: 'Додати в кошик', tag: 'BUTTON', inter: 1, x: 300, y: lay.ctaY, ew: 320, eh: 56 });
      const ajaxFails = chance(0.14);
      if (ajaxFails) {
        push('net_error', { url: '/?wc-ajax=add_to_cart', status: 500, ms: int(900, 4000), kind: 'xhr' }, 900);
        push('rage_click', { sel: '.single_add_to_cart_button', label: 'Додати в кошик', n: 3, x: 300, y: lay.ctaY });
        push('click', { sel: '.single_add_to_cart_button', label: 'Додати в кошик', tag: 'BUTTON', inter: 1, x: 300, y: lay.ctaY });
        push('page_leave', { ms: ts - t0, depth, dirChanges: int(3, 9), lastField: '' });
        await flushSession();
        continue;
      }

      push('custom', { name: 'add_to_cart', props: { item: model, value: int(4000, 24000) }, step: 'add_to_cart' });
      if (!chance(0.62)) { push('page_leave', { ms: ts - t0, depth, dirChanges: 3, lastField: '' }); await flushSession(); continue; }

      path = '/cart';
      push('pageview', { step: 'cart', title: 'Кошик' }, 1500);
      push('custom', { name: 'view_cart', props: {}, step: 'cart' });
      if (chance(0.42)) { push('page_leave', { ms: ts - t0, depth: 70, dirChanges: 2, lastField: '' }); await flushSession(); continue; }

      path = '/checkout';
      push('pageview', { step: 'checkout', title: 'Оформлення' }, 1800);
      push('custom', { name: 'begin_checkout', props: {}, step: 'checkout' });
      push('scroll', { y: 0, depth: 22, since: ts - t0 }, 900);
      push('mouse', { pts: Array.from({ length: 8 }, (_, m) => [int(20, 360), int(100, 900), m * 320]) }, 300);
      const cl = layout(device, 'checkout');
      events.push({ t: 'snapshot', ts: ts + 700, p: path, s: ++seq, d: { w: cl.w, h: cl.h, els: cl.els } });

      const safariBug = /Safari\/604/.test(ua) && chance(0.55);
      if (safariBug) {
        push('js_error', {
          msg: "TypeError: undefined is not an object (evaluating 'wc_checkout_params.order_total')",
          src: '/wp-content/themes/chrono/js/checkout.js', line: 184,
          stack: 'at updateTotals | at HTMLDocument.<anonymous>'
        }, 1200);
      }

      const fields = [["billing_first_name", "Ім'я"], ['billing_last_name', 'Прізвище'], ['billing_phone', 'Телефон'], ['billing_email', 'E-mail'], ['billing_city', 'Місто'], ['billing_address_1', 'Відділення']];
      let abandonedAt = '';
      for (const [name, label] of fields) {
        push('field_focus', { key: name, label, type: 'text', since: ts - t0 }, int(500, 2200));
        const phoneTrouble = name === 'billing_phone' && chance(0.52);
        const keys = int(6, 24), back = phoneTrouble ? int(8, 20) : int(0, 3);
        if (phoneTrouble) {
          push('validation_error', { key: name, label, msg: 'Введіть телефон у форматі +380XXXXXXXXX', since: ts - t0 }, 700);
          if (chance(0.5)) push('validation_error', { key: name, label, msg: 'Введіть телефон у форматі +380XXXXXXXXX', since: ts - t0 }, 1500);
        }
        push('field_blur', { key: name, label, type: 'text', ms: phoneTrouble ? int(14000, 42000) : int(1800, 9000), keys, back, errors: phoneTrouble ? 2 : 0, filled: 1, len: int(4, 20), valid: phoneTrouble ? 0 : 1 }, 600);
        if (phoneTrouble && chance(0.55)) { abandonedAt = name; break; }
        if (name === 'billing_city' && chance(0.16)) { abandonedAt = name; break; }
      }

      push('scroll', { y: Math.max(0, cl.ctaY - 500), depth: 72, since: ts - t0 }, 800);
      const shippingShock = !abandonedAt && chance(0.34);
      if (abandonedAt || shippingShock || safariBug) {
        if (shippingShock) {
          push('scroll', { y: cl.ctaY - 200, depth: 85 });
          push('exit_intent', { since: ts - t0, depth: 85 }, 2400);
          push('survey_shown', { step: 'checkout' });
          if (chance(0.5)) push('survey_answer', { answer: 'Умови доставки / оплати', text: chance(0.4) ? 'Доставка 250 грн це дорого, у конкурентів безкоштовно' : '', step: 'checkout' });
        }
        if (safariBug) {
          push('click', { sel: '#place_order', label: 'Підтвердити замовлення', tag: 'BUTTON', inter: 1, x: 300, y: cl.ctaY, ew: 320, eh: 56 });
          push('rage_click', { sel: '#place_order', label: 'Підтвердити замовлення', n: 4, x: 300, y: cl.ctaY }, 1400);
        }
        push('page_leave', { ms: ts - t0, depth: int(60, 95), dirChanges: int(4, 14), lastField: abandonedAt || 'billing_address_1' });
        await flushSession();
        continue;
      }

      push('form_submit', { sel: 'form.checkout', fields: 12, since: ts - t0 }, 1500);
      const value = int(4000, 26000);
      push('goal', { name: 'purchase', value, currency: 'UAH', props: { value, orderId: int(10000, 99999) } }, 2600);
      path = '/checkout/order-received';
      push('pageview', { step: 'purchase', title: 'Дякуємо за замовлення' }, 1400);
      push('page_leave', { ms: ts - t0, depth: 60, dirChanges: 2, lastField: '' });
      orders++;
      await flushSession();

      async function flushSession() {
        const env = {
          sid, vid, href: 'https://chrono.ua' + path + (src.ref && /facebook/.test(src.ref) ? '?utm_source=facebook&utm_medium=paid_social&utm_campaign=watch_retarget' : ''),
          path, ref: src.ref, title: 'CHRONO.UA', lang: 'uk-UA', ua,
          dev: device, vw, vh, touch: device !== 'desktop', startedAt: t0, items: events
        };
        await ingestBatch(db, cfg, env, {
          ip: '203.0.113.' + int(1, 254), ua,
          country: geo.country, city: city, region: geo.region
        });
        made++;
      }
    }
  }
  return { sessions: made, orders };
}
