import { h, nf, money, dur, funnelChart, lineChart, compareBars, barChart, depthCurve, showTip, hideTip } from './charts.js';
import { renderLiveHeatmap } from './live-heatmap.js';
import { renderLiveReplay } from './live-replay.js';
import { renderSetup, renderSettings } from './setup.js';
import { renderReplay, renderHeatmap } from './replay.js';

const view = document.getElementById('view');
// Dashboard key: asked once, kept in this browser. A ?key= in the link is saved and removed from the address bar.
const KEY_STORE = 'conv-lens-key';
function readKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
function saveKey(k) { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} }
let KEY = readKey();
{
  const u = new URL(location.href);
  const fromUrl = u.searchParams.get('key');
  if (fromUrl) { KEY = fromUrl; saveKey(fromUrl); u.searchParams.delete('key'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
}
class AuthError extends Error {}
const state = { tab: 'overview', days: 30, device: '', source: '', currency: '', cache: {}, player: null, site: '', sites: [], presets: [], compare: false };

async function api(path, params = {}) {
  const q = new URLSearchParams({
    from: String(Date.now() - state.days * 86400000),
    to: String(Date.now()),
    ...(state.site ? { site: state.site } : {}),
    ...(state.device ? { device: state.device } : {}),
    ...(state.source ? { source: state.source } : {}),
    ...params
  });
  if (!KEY) throw new AuthError('no key');
  const res = await fetch(`/api/${path}?${q}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (res.status === 401) throw new AuthError('bad key');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function apiPost(path, body = {}) {
  if (!KEY) throw new AuthError('no key');
  const sep = path.includes('?') ? '&' : '?';
  const url = `/api/${path}${state.site ? sep + 'site=' + encodeURIComponent(state.site) : ''}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401) throw new AuthError('bad key');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const SEV_LABEL = { critical: 'критично', serious: 'серйозно', warning: 'увага', info: 'інфо' };

// Change against the previous period of the same length. `up` says whether growth is good,
// so a rising bounce rate is red and a rising conversion is green.
function delta(now, before, up = true, suffix = '') {
  if (before == null || !isFinite(before) || (!before && !now)) return null;
  const diff = now - before;
  if (!before) return h('span', { class: 'dlt new' }, 'нове');
  const pctChange = Math.round((diff / Math.abs(before)) * 1000) / 10;
  if (Math.abs(pctChange) < 0.5) return h('span', { class: 'dlt flat' }, 'без змін');
  const good = up ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '▲' : '▼';
  const abs = suffix ? `${diff > 0 ? '+' : ''}${Math.round(diff * 10) / 10}${suffix}` : `${pctChange > 0 ? '+' : ''}${pctChange}%`;
  return h('span', { class: 'dlt ' + (good ? 'good' : 'bad'), title: `було ${nf(before)}${suffix}` }, `${arrow} ${abs}`);
}

const withDelta = (node, text) => (node ? h('span', {}, [node, ' · ' + text]) : text);

function tile(label, value, sub, cls = '') {
  return h('div', { class: 'card tile ' + cls }, [
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    sub ? h('div', { class: 'sub' }, sub) : null
  ]);
}
function card(title, note, body) {
  return h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [h('h2', {}, title), note ? h('p', {}, note) : null]),
    body
  ]);
}
function table(headers, rows) {
  return h('div', { style: 'overflow:auto' }, h('table', {}, [
    h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x.num ? 'num' : '' }, x.label || x)))),
    h('tbody', {}, rows)
  ]));
}
function loading() { view.innerHTML = ''; view.appendChild(h('div', { class: 'empty' }, 'Завантаження…')); }
function fail(e) {
  if (e instanceof AuthError) return showLogin(e.message === 'bad key');
  view.innerHTML = ''; view.appendChild(h('div', { class: 'empty' }, 'Помилка: ' + e.message));
}

function showLogin(wrong) {
  view.innerHTML = '';
  const input = h('input', { type: 'password', id: 'clKey', autocomplete: 'current-password', placeholder: 'Ключ доступу', style: 'width:100%;padding:12px 14px;font:inherit;border:1px solid var(--line, #ccc);border-radius:10px;background:transparent;color:inherit' });
  const form = h('form', { class: 'card', style: 'max-width:420px;margin:48px auto;padding:28px;display:grid;gap:14px' }, [
    h('h2', { style: 'margin:0;font-size:20px' }, 'Вхід у Conv Lens'),
    h('p', { style: 'margin:0;opacity:.75;line-height:1.5' }, 'Введіть ключ доступу до дашборда. Браузер запам\'ятає його, вводити знову не доведеться.'),
    wrong ? h('p', { style: 'margin:0;color:#d43031;font-weight:600' }, 'Ключ не підійшов. Перевірте і спробуйте ще раз.') : null,
    h('label', { for: 'clKey', style: 'font-size:13px;font-weight:600' }, 'Ключ'),
    input,
    h('button', { class: 'primary', type: 'submit', style: 'padding:12px' }, 'Увійти')
  ]);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const k = input.value.trim();
    if (!k) return;
    KEY = k; saveKey(k);
    boot();
  });
  view.appendChild(form);
  setTimeout(() => input.focus(), 0);
}

function logout() { KEY = ''; saveKey(''); showLogin(false); }

async function renderOverview() {
  const d = await api('overview', state.compare ? { compare: '1' } : {});
  const ins = await api('insights');
  state.currency = d.overview.currency;
  const o = d.overview;
  // Comparing against a window with no data would only produce nonsense arrows.
  const p = d.previous && d.previous.overview.sessions > 0 ? d.previous.overview : null;
  view.innerHTML = '';

  if (state.compare) {
    const r = d.previous ? d.previous.range : null;
    const fmt = (ms) => new Date(ms).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    view.appendChild(h('div', { class: 'cmp-note' }, p
      ? `Порівняння з попереднім періодом: ${fmt(r.from)} – ${fmt(r.to)}, ${nf(p.sessions)} сесій.`
      : 'За попередній період даних ще немає — порівнювати нема з чим.'));
  }

  view.appendChild(h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, [
    tile('Люди', nf(o.visitors), withDelta(p && delta(o.visitors, p.visitors), `${nf(o.sessions)} сесій · ${nf(o.ips || 0)} різних IP`), 'hero'),
    tile('Оцінка втрат', money(ins.estimatedLost.low, o.currency), 'нижня межа, причини перетинаються'),
    tile('Конверсія', o.cr + '%', withDelta(p && delta(o.cr, p.cr, true, ' п.п.'), `${nf(o.orders)} замовлень з ${nf(o.sessions)} сесій`)),
    tile('Пішли майже одразу', o.bounceRate + '%', withDelta(p && delta(o.bounceRate, p.bounceRate, false, ' п.п.'), 'до 5 с і без скролу')),
    tile('Середній фрикшн', o.avgFriction + '/100', withDelta(p && delta(o.avgFriction, p.avgFriction, false), 'індекс складнощів у сесії')),
    tile('Сесії з rage-кліками', nf(o.withRage), withDelta(p && delta(o.withRage, p.withRage, false), `${Math.round((o.withRage / Math.max(o.sessions, 1)) * 100)}% усіх сесій`)),
    tile('Сесії з JS-помилкою', nf(o.withJsError), withDelta(p && delta(o.withJsError, p.withJsError, false), `запити падали у ${nf(o.withNetError)}`)),
    tile('Середня глибина скролу', o.avgDepth + '%', withDelta(p && delta(o.avgDepth, p.avgDepth, true, ' п.п.'), `${o.avgPageviews} сторінок, ${o.avgDuration} с`))
  ]));

  const fnPrev = d.previous ? d.previous.funnel : null;
  view.appendChild(card('Фунел продажу',
    `${nf(d.funnel.total)} сесій у вибірці`,
    h('div', {}, [
      funnelChart(d.funnel.steps, d.funnel.total),
      fnPrev && p ? h('div', { class: 'fn-cmp' }, d.funnel.steps.map((st, i) => {
        const was = fnPrev.steps[i];
        const dd = was ? delta(st.shareOfTotal, was.shareOfTotal, true, ' п.п.') : null;
        return h('span', {}, [h('b', {}, st.name), ' ', dd || h('span', { class: 'dlt flat' }, '—')]);
      })) : null
    ])));

  view.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, [
    card('Сесії по днях', null, lineChart(o.daily, { xKey: 'day', yKey: 'sessions', label: 'Сесій' })),
    card('Конверсія по днях, %', null, lineChart(o.daily, { xKey: 'day', yKey: 'cr', label: 'Конверсія', fmt: (v) => (Math.round(v * 10) / 10) + '%', color: 'var(--series-2)' }))
  ]));

  const top = ins.insights.slice(0, 3);
  if (top.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Головні причини', 'повний список — у вкладці «Діагнози»',
      h('div', { class: 'grid', style: 'gap:10px' }, top.map(insightCard)))));
  }

  view.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, [
    card('Пристрої', 'де найбільше втрат', table(
      ['Пристрій', { label: 'Сесій', num: 1 }, { label: 'CR', num: 1 }, { label: 'LCP', num: 1 }, { label: 'Фрикшн', num: 1 }],
      d.devices.map((x) => h('tr', {}, [
        h('td', {}, x.device),
        h('td', { class: 'num' }, nf(x.sessions)),
        h('td', { class: 'num' }, x.cr + '%'),
        h('td', { class: 'num' }, nf(x.lcp) + ' мс'),
        h('td', { class: 'num' }, String(x.friction))
      ])))),
    card('Де найчастіше йдуть', 'сторінки виходу без покупки', table(
      ['Сторінка', { label: 'Виходів', num: 1 }, { label: 'Час', num: 1 }, { label: 'Фрикшн', num: 1 }],
      d.exits.map((x) => h('tr', { class: 'clickable', onclick: () => { state.heatPath = x.path; switchTab('heat'); } }, [
        h('td', { class: 'mono trunc' }, x.path),
        h('td', { class: 'num' }, nf(x.n)),
        h('td', { class: 'num' }, x.dwell + ' с'),
        h('td', { class: 'num' }, String(x.friction))
      ]))))
  ]));
}

function insightCard(i) {
  return h('div', { class: 'card insight ' + i.severity }, [
    h('div', { class: 'card-head', style: 'margin-bottom:8px' }, [
      h('h3', {}, i.title),
      h('span', { class: 'pill ' + i.severity }, SEV_LABEL[i.severity])
    ]),
    h('p', { class: 'detail' }, i.detail),
    i.evidence.length ? h('div', { class: 'evidence' }, i.evidence.map((e) =>
      h('span', {}, [e.label + ': ', h('b', {}, String(e.value))]))) : null,
    h('div', { class: 'action' }, [
      h('span', { class: 'arrow' }, '→'),
      h('span', {}, i.action),
      i.lost.orders > 0 ? h('span', { class: 'loss', style: 'margin-left:auto' }, [
        'оцінка втрат ', h('b', {}, `~${i.lost.orders} замовлень`), ` ≈ ${money(i.lost.money, state.currency)}`
      ]) : null
    ]),
    i.sessions && i.sessions.length ? h('div', { style: 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' },
      [h('span', { class: 'sub', style: 'color:var(--muted);font-size:12px;align-self:center' }, 'записи:')].concat(
        i.sessions.slice(0, 5).map((id) => h('button', { class: 'ghost', onclick: () => openSession(id) }, '▶ ' + id.slice(0, 7)))
      )) : null
  ]);
}

async function renderInsights() {
  const ins = await api('insights');
  state.currency = ins.currency;
  view.innerHTML = '';
  view.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' }, [
    h('div', { class: 'card-head' }, [
      h('h2', {}, 'Що саме ламає продажі'),
      h('p', {}, `${ins.insights.length} причин · базова конверсія ${ins.baseCr}% · оцінка втрат ${money(ins.estimatedLost.low, ins.currency)} – ${money(ins.estimatedLost.high, ins.currency)}`)
    ]),
    h('p', { class: 'note', style: 'margin:0' }, ins.estimatedLost.note)
  ]));
  view.appendChild(h('div', { id: 'replayHost' }));
  view.appendChild(h('div', { class: 'grid', style: 'gap:12px' }, ins.insights.map(insightCard)));
}

async function renderFunnel() {
  const d = await api('overview');
  view.innerHTML = '';
  view.appendChild(card('Фунел', `${nf(d.funnel.total)} сесій`, funnelChart(d.funnel.steps, d.funnel.total)));
  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Крок за кроком', '«дійшли» — сесії, що досягли мінімум цієї глибини; «були на кроці» — фактичні візити',
    table(['Крок', { label: 'Дійшли', num: 1 }, { label: 'Були на кроці', num: 1 }, { label: '% трафіку', num: 1 }, { label: 'Зупинились тут', num: 1 }, { label: 'Пішли далі', num: 1 }],
      d.funnel.steps.map((s) => h('tr', {}, [
        h('td', {}, s.name),
        h('td', { class: 'num' }, nf(s.reached)),
        h('td', { class: 'num' }, nf(s.hit)),
        h('td', { class: 'num' }, s.shareOfTotal + '%'),
        h('td', { class: 'num' }, s.dropped ? h('span', { class: 'pill ' + (s.dropRate > 60 ? 'critical' : s.dropRate > 35 ? 'warning' : '') }, `${nf(s.dropped)} (${s.dropRate}%)`) : '—'),
        h('td', { class: 'num' }, s.conversionToNext + '%')
      ]))))));
  const src = await api('sources');
  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Канали', 'куди йде бюджет і що з нього виходить',
    table(['Канал', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'CR', num: 1 }, { label: 'Відмов', num: 1 }, { label: 'Час', num: 1 }],
      src.sources.map((x) => h('tr', {}, [
        h('td', {}, `${x.source} / ${x.medium}`),
        h('td', { class: 'num' }, nf(x.sessions)),
        h('td', { class: 'num' }, nf(x.orders)),
        h('td', { class: 'num' }, x.orders === 0 && x.sessions >= 15 ? h('span', { class: 'pill critical' }, '0%') : x.cr + '%'),
        h('td', { class: 'num' }, x.bounceRate + '%'),
        h('td', { class: 'num' }, x.dwell + ' с')
      ]))))));
}

async function renderSessions() {
  const sort = state.sort || 'recent';
  const only = state.only || 'lost';
  const d = await api('sessions', { sort, only, limit: '80' });
  view.innerHTML = '';
  view.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
    h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'Показати:'),
    select([['lost', 'тих, хто не купив'], ['struggled', 'тих, кому було важко'], ['converted', 'тих, хто купив'], ['', 'усі сесії']], only, (v) => { state.only = v; renderTab(); }),
    h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'Сортувати:'),
    select([['recent', 'за часом'], ['friction', 'за фрикшном'], ['deep', 'за глибиною фунела'], ['duration', 'за тривалістю']], sort, (v) => { state.sort = v; renderTab(); }),
    h('span', { class: 'note', style: 'margin:0 0 0 auto' }, 'клік по рядку — відтворити сесію')
  ]));
  view.appendChild(h('div', { id: 'replayHost', style: 'margin-bottom:14px' }));
  view.appendChild(h('div', { class: 'card pad-0' }, table(
    ['Коли', 'Хто', 'Пристрій', 'Канал', { label: 'Фрикшн', num: 1 }, 'Дійшов до', { label: 'Сигнали', num: 0 }, { label: 'Трив.', num: 1 }, 'Вихід', ''],
    d.sessions.map((s) => h('tr', { class: 'clickable', onclick: () => openSession(s.id) }, [
      h('td', { class: 'mono' }, new Date(s.started_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
      h('td', {}, who(s)),
      h('td', {}, `${s.device}, ${s.browser}`),
      h('td', { class: 'trunc' }, s.source),
      h('td', { class: 'num' }, h('span', { class: 'pill ' + (s.friction >= 50 ? 'critical' : s.friction >= 20 ? 'warning' : '') }, String(s.friction))),
      h('td', {}, s.converted ? h('span', { class: 'pill good' }, 'купив') : (s.max_step_id || '—')),
      h('td', {}, signals(s)),
      h('td', { class: 'num' }, dur(s.duration)),
      h('td', { class: 'mono trunc' }, s.exit_path),
      h('td', { class: 'row-menu-cell' }, rowMenu(s))
    ]))
  )));
}

// Visitor = browser (localStorage id); IP shows whether several browsers belong to one network or person.
export function visitorTag(id) { return (id || '').slice(0, 4).toUpperCase() || '—'; }
function who(s) {
  const place = [s.city, s.region, s.country].filter(Boolean).join(', ');
  return h('div', { style: 'display:grid;gap:2px;min-width:160px' }, [
    h('div', {}, [h('b', {}, 'Відвідувач ' + visitorTag(s.visitor_id)), h('span', { class: 'note', style: 'margin:0 0 0 6px' }, s.visits > 1 ? `візит ${s.visit_no} з ${s.visits}` : 'перший візит')]),
    h('div', { class: 'mono', style: 'font-size:12px;opacity:.75' }, (s.ip || 'IP невідомий') + (s.ip_people > 1 ? ` · ${s.ip_people} людей з цього IP` : '')),
    place ? h('div', { style: 'font-size:12px;opacity:.75' }, place) : null
  ]);
}

// "⋯" menu on a session row: click map of this session, delete (with a confirm step).
function rowMenu(sess) {
  const pop = h('div', { class: 'row-pop', role: 'menu', hidden: 'hidden' });
  const btn = h('button', { class: 'row-menu', type: 'button', 'aria-label': 'Дії з сесією', 'aria-haspopup': 'menu', title: 'Дії' }, '⋯');
  const close = () => { pop.hidden = true; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== btn) close(); };
  function fill(confirming) {
    pop.innerHTML = '';
    if (!confirming) {
      pop.append(
        h('button', { type: 'button', role: 'menuitem', onclick: (e) => { e.stopPropagation(); close(); state.heatSid = sess.id; switchTab('heat'); } }, 'Карта кліків сесії'),
        h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: (e) => { e.stopPropagation(); fill(true); } }, 'Видалити')
      );
    } else {
      pop.append(
        h('div', { class: 'row-pop-q' }, 'Видалити цю сесію разом із записом?'),
        h('div', { class: 'row-pop-actions' }, [
          h('button', { type: 'button', class: 'ghost', onclick: (e) => { e.stopPropagation(); fill(false); } }, 'Скасувати'),
          h('button', { type: 'button', class: 'danger-solid', onclick: async (e) => {
            e.stopPropagation();
            e.target.disabled = true; e.target.textContent = 'Видаляємо…';
            try {
              await apiPost('delete', { id: sess.id });
              const tr = btn.closest('tr'); tr.style.transition = 'opacity .25s'; tr.style.opacity = '0';
              setTimeout(() => tr.remove(), 250);
              if (state.player && state.playerId === sess.id) { state.player.destroy(); document.getElementById('replayHost').innerHTML = ''; state.player = null; }
              close();
            } catch (err) { e.target.disabled = false; e.target.textContent = 'Не вдалось, ще раз'; }
          } }, 'Видалити')
        ])
      );
    }
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.row-pop').forEach((p) => { p.hidden = true; });
    if (open) {
      fill(false); pop.hidden = false;
      // fixed positioning so the table's overflow does not clip the menu
      const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.right - pw)) + 'px';
      pop.style.top = (r.bottom + 6 + ph > innerHeight - 8 ? r.top - ph - 6 : r.bottom + 6) + 'px';
      setTimeout(() => { document.addEventListener('click', outside, true); addEventListener('scroll', close, { once: true, capture: true }); }, 0);
    } else close();
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  return h('div', { class: 'row-menu-wrap' }, [btn, pop]);
}

function signals(s) {
  const out = [];
  if (s.rage) out.push(['critical', `rage ${s.rage}`]);
  if (s.js_errors) out.push(['critical', `JS ${s.js_errors}`]);
  if (s.net_errors) out.push(['critical', `запит ${s.net_errors}`]);
  if (s.dead) out.push(['warning', `мертвих ${s.dead}`]);
  if (s.validation_errors) out.push(['warning', `валід. ${s.validation_errors}`]);
  if (!s.cta_seen && s.max_step >= 2) out.push(['warning', 'не бачив CTA']);
  if (s.last_field) out.push(['warning', 'обрив: ' + s.last_field.replace('billing_', '')]);
  return h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, out.slice(0, 4).map(([c, t]) => h('span', { class: 'pill ' + c }, t)));
}

function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    options.map(([v, l]) => h('option', { value: v, ...(String(v) === String(value) ? { selected: 'selected' } : {}) }, l)));
}

async function openSession(id) {
  const host = document.getElementById('replayHost') || view.insertBefore(h('div', { id: 'replayHost' }), view.firstChild);
  host.innerHTML = '';
  host.appendChild(h('div', { class: 'empty' }, 'Готуємо запис…'));
  try {
    const d = await api('session', { id });
    if (state.player) state.player.destroy();
    host.innerHTML = '';
    const box = h('div', { class: 'card pad-0' });
    host.appendChild(box);
    const close = () => { box.remove(); state.player = null; };
    const liveOrigin = liveReplaySite();
    if (liveOrigin) {
      state.player = renderLiveReplay(box, d, {
        visitorTag, onClose: close, siteOrigin: liveOrigin,
        onHeatmap: () => { state.heatSid = id; switchTab('heat'); },
        // The site never answered: no Conv Lens tag on it, no replay API, or it refuses framing.
        onUnavailable: () => {
          if (state.player) state.player.destroy();
          box.innerHTML = '';
          box.appendChild(h('div', { class: 'cmp-note', style: 'margin:12px' },
            'Справжню сторінку відкрити не вдалось — показуємо запис зі знімка верстки. Перевірте, що тег Conv Lens стоїть на сайті і сторінка не забороняє показ у фреймі.'));
          state.player = renderReplay(box, d, close);
        }
      });
    } else {
      state.player = renderReplay(box, d, close);
    }
    state.playerId = id;
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    host.innerHTML = '';
    host.appendChild(h('div', { class: 'empty' }, 'Не вдалось відкрити запис: ' + e.message));
  }
}

async function renderHeat() {
  const [paths, recent] = await Promise.all([api('paths'), api('sessions', { only: '', sort: 'recent', limit: '60' })]);
  const path = state.heatPath || paths.paths[0]?.path || '/';
  state.heatPath = path;
  const mode = state.heatMode || 'all';
  const sid = state.heatSid || '';
  const sessOpts = [['', 'усі сесії'], ...recent.sessions.map((x) => [x.id,
    `${new Date(x.started_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · Відвідувач ${visitorTag(x.visitor_id)} · ${x.device}`])];
  if (sid && !sessOpts.some(([v]) => v === sid)) sessOpts.push([sid, 'вибрана сесія']);
  view.innerHTML = '';
  view.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
    h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'Сторінка:'),
    select(paths.paths.map((p) => [p.path, `${p.path} (${p.sessions})`]), path, (v) => { state.heatPath = v; renderTab(); }),
    h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'Сесія:'),
    select(sessOpts, sid, (v) => { state.heatSid = v; renderTab(); }),
    h('span', { style: 'font-size:13px;color:var(--text-2)' }, 'Показати:'),
    select([['all', 'усі кліки'], ['lost', 'лише тих, хто не купив'], ['rage', 'лише rage-кліки'], ['dead', 'лише кліки без реакції']], mode, (v) => { state.heatMode = v; renderTab(); }),
    sid ? h('button', { class: 'ghost', onclick: () => { state.heatSid = ''; renderTab(); } }, '✕ усі сесії') : null
  ]));
  const d = await api('heatmap', { path, ...(state.device ? { device: state.device } : {}), ...(sid ? { sid } : {}) });
  const host = h('div', { class: 'card pad-0', style: 'padding:12px' });
  view.appendChild(host);
  if (state.heat) state.heat.destroy();
  state.heat = sameOriginSite()
    ? renderLiveHeatmap(host, d, { mode, single: !!sid })
    : renderHeatmap(host, d, mode);
  if (!sid) view.appendChild(h('div', { style: 'margin-top:14px' }, card('Глибина перегляду', 'скільки сесій долистало до цієї частини сторінки', depthCurve(d.depth))));
}

async function renderElements() {
  const d = await api('elements');
  view.innerHTML = '';
  view.appendChild(h('div', { id: 'replayHost', style: 'margin-bottom:14px' }));
  view.appendChild(card('Елементи, що злять людей', 'rage — нервові повторні кліки, мертві — кліки без реакції', table(
    ['Елемент', 'Сторінка', 'Селектор', { label: 'Rage', num: 1 }, { label: 'Мертвих', num: 1 }, { label: 'Кліків', num: 1 }, { label: 'Не купили', num: 1 }],
    d.elements.map((x) => h('tr', {}, [
      h('td', {}, (x.label || '—').slice(0, 36)),
      h('td', { class: 'mono trunc' }, x.path),
      h('td', { class: 'mono trunc' }, x.sel),
      h('td', { class: 'num' }, x.rage ? h('span', { class: 'pill critical' }, nf(x.rage)) : '—'),
      h('td', { class: 'num' }, x.dead ? h('span', { class: 'pill warning' }, nf(x.dead)) : '—'),
      h('td', { class: 'num' }, nf(x.clicks)),
      h('td', { class: 'num' }, `${nf(x.lost_sessions)} / ${nf(x.sessions)}`)
    ])))));
  if (d.cta.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Видимість кнопок', 'якщо кнопка нижче першого екрана — частина людей її не побачить', table(
      ['Кнопка', 'Сторінка', 'Пристрій', { label: 'Позиція', num: 1 }, { label: 'Екран', num: 1 }, { label: 'Сесій', num: 1 }],
      d.cta.map((x) => h('tr', {}, [
        h('td', {}, (x.label || x.sel || '').slice(0, 36)),
        h('td', { class: 'mono trunc' }, x.path),
        h('td', {}, x.device),
        h('td', { class: 'num' }, x.belowFold ? h('span', { class: 'pill warning' }, nf(x.avg_y) + ' px') : nf(x.avg_y) + ' px'),
        h('td', { class: 'num' }, nf(x.fold) + ' px'),
        h('td', { class: 'num' }, nf(x.sessions))
      ]))))));
  }
}

async function renderForms() {
  const d = await api('forms');
  view.innerHTML = '';
  if (!d.fields.length) { view.appendChild(h('div', { class: 'empty' }, 'Ще немає даних по полях форм')); return; }
  view.appendChild(h('div', { id: 'replayHost', style: 'margin-bottom:14px' }));
  view.appendChild(card('Поля форми оформлення', 'відсортовано за шкодою: обриви, помилки, переписування', table(
    ['Поле', 'Сторінка', { label: 'Обрив тут', num: 1 }, { label: 'Помилок', num: 1 }, { label: 'Переписувань', num: 1 }, { label: 'Час у полі', num: 1 }, { label: 'Лишають порожнім', num: 1 }, 'Текст помилки'],
    d.fields.map((x) => h('tr', {}, [
      h('td', {}, x.label || x.field),
      h('td', { class: 'mono trunc' }, x.path),
      h('td', { class: 'num' }, x.abandonedHere ? h('span', { class: 'pill critical' }, nf(x.abandonedHere)) : '—'),
      h('td', { class: 'num' }, x.errors ? h('span', { class: 'pill warning' }, nf(x.errors)) : '—'),
      h('td', { class: 'num' }, x.correctionRate + '%'),
      h('td', { class: 'num' }, x.avgSeconds + ' с'),
      h('td', { class: 'num' }, x.leftEmptyRate + '%'),
      h('td', { class: 'trunc' }, x.errorSample || '—')
    ])))));
  const errs = await api('errors');
  if (errs.js.length || errs.net.length) {
    view.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, [
      card('JS-помилки', 'ламають сценарій', table(['Помилка', { label: 'Сесій', num: 1 }, { label: 'Не купили', num: 1 }, 'Браузери'],
        errs.js.map((x) => h('tr', {}, [
          h('td', { class: 'trunc', title: x.msg }, x.msg),
          h('td', { class: 'num' }, nf(x.sessions)),
          h('td', { class: 'num' }, nf(x.lost)),
          h('td', { class: 'trunc' }, x.browsers || '—')
        ])))),
      card('Невдалі запити', 'кнопка натиснута — реакції немає', table(['URL', { label: 'Код', num: 1 }, { label: 'Сесій', num: 1 }, { label: 'Не купили', num: 1 }],
        errs.net.map((x) => h('tr', {}, [
          h('td', { class: 'mono trunc' }, x.url),
          h('td', { class: 'num' }, h('span', { class: 'pill critical' }, String(x.status || 'fail'))),
          h('td', { class: 'num' }, nf(x.sessions)),
          h('td', { class: 'num' }, nf(x.lost))
        ]))))
    ]));
  }
}

async function renderSpeed() {
  const d = await api('speed');
  view.innerHTML = '';
  const labels = { good: 'LCP до 2.5 с', 'needs-improvement': 'LCP 2.5–4 с', poor: 'LCP понад 4 с', unknown: 'без даних' };
  const buckets = d.buckets.filter((b) => b.bucket !== 'unknown').map((b) => ({ ...b, name: labels[b.bucket] }));
  view.appendChild(card('Конверсія залежно від швидкості', 'одна смуга — одна група сесій за LCP',
    barChart(buckets, { labelKey: 'name', valueKey: 'cr', fmt: (v) => v + '%', note: (it) => `${nf(it.sessions)} сесій, ${nf(it.orders)} замовлень` })));
  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Найповільніші сторінки входу', 'LCP, INP і CLS за реальними відвідувачами', table(
    ['Сторінка', { label: 'Сесій', num: 1 }, { label: 'LCP', num: 1 }, { label: 'INP', num: 1 }, { label: 'CLS', num: 1 }, { label: 'CR', num: 1 }],
    d.byPath.map((x) => h('tr', {}, [
      h('td', { class: 'mono trunc' }, x.path),
      h('td', { class: 'num' }, nf(x.sessions)),
      h('td', { class: 'num' }, h('span', { class: 'pill ' + (x.lcp > 4000 ? 'critical' : x.lcp > 2500 ? 'warning' : 'good') }, nf(x.lcp) + ' мс')),
      h('td', { class: 'num' }, nf(x.inp) + ' мс'),
      h('td', { class: 'num' }, String(x.cls)),
      h('td', { class: 'num' }, x.cr + '%')
    ]))))));
}

async function renderSegments() {
  const d = await api('segments');
  view.innerHTML = '';
  view.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' }, [
    h('div', { class: 'card-head' }, [
      h('h2', {}, 'Чим ті, хто не купив, відрізняються від покупців'),
      h('p', {}, `${nf(d.restSessions)} без покупки проти ${nf(d.convSessions)} покупців`)
    ]),
    h('div', { class: 'legend' }, [
      h('span', {}, [h('i', { style: 'background:var(--series-2)' }), 'Не купили']),
      h('span', {}, [h('i', { style: 'background:var(--series-1)' }), 'Купили'])
    ]),
    compareBars(d.features),
    h('p', { class: 'note' }, 'Що більша різниця — то сильніший підозрюваний. Це кореляція, а не доказ: перевіряйте записами сесій.')
  ]));
  view.appendChild(card('Таблиця', null, table(
    ['Ознака', { label: 'Не купили', num: 1 }, { label: 'Купили', num: 1 }, { label: 'Різниця', num: 1 }, { label: 'Сесій', num: 1 }],
    d.features.map((f) => h('tr', {}, [
      h('td', {}, f.label),
      h('td', { class: 'num' }, f.nonConverters + '%'),
      h('td', { class: 'num' }, f.converters + '%'),
      h('td', { class: 'num' }, f.delta > 8 ? h('span', { class: 'pill critical' }, '+' + f.delta + ' п.п.') : (f.delta > 0 ? '+' : '') + f.delta + ' п.п.'),
      h('td', { class: 'num' }, nf(f.affected))
    ])))));
}

async function renderSurvey() {
  const d = await api('survey');
  view.innerHTML = '';
  if (!d.answered) {
    view.appendChild(h('div', { class: 'empty' }, 'Відповідей ще немає. Опитування показується на виході зі сторінки товару, кошика чи оформлення.'));
    return;
  }
  view.appendChild(card('Що люди відповідають', `${nf(d.answered)} відповідей з ${nf(d.shown)} показів`,
    barChart(d.grouped, { labelKey: 'answer', valueKey: 'n', note: (it) => `${it.converted} з них усе ж купили` })));
  if (d.texts.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Своїми словами', 'найцінніше в усій утиліті',
      h('div', {}, d.texts.map((t) => h('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' }, [
        h('div', { style: 'font-size:14px' }, '«' + t.text + '»'),
        h('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px;display:flex;gap:10px;align-items:center' }, [
          h('span', {}, t.answer),
          h('span', {}, t.device),
          h('span', {}, new Date(t.ts).toLocaleString('uk-UA')),
          h('button', { class: 'ghost', onclick: () => openSession(t.session_id) }, '▶ запис')
        ])
      ]))))));
  }
}

const TABS = {
  overview: renderOverview, insights: renderInsights, funnel: renderFunnel,
  sessions: renderSessions, heat: renderHeat, elements: renderElements,
  forms: renderForms, speed: renderSpeed, segments: renderSegments, survey: renderSurvey,
  sources: renderSources, audience: renderAudience, journey: renderJourney,
  events: renderEvents, settings: renderSettingsTab
};

// Who comes: first-timers against people who came back, and where they are.
async function renderAudience() {
  const d = await api('audience');
  const cur = d.currency || state.currency || '';
  const n = d.new, r = d.returning;
  const total = n.sessions + r.sessions;
  view.innerHTML = '';

  if (!total) {
    view.appendChild(h('div', { class: 'empty' }, 'За цей період ще немає візитів.'));
    return;
  }

  const share = (x) => Math.round((x / total) * 100) + '%';
  view.appendChild(h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, [
    tile('Нові', nf(n.sessions), `${share(n.sessions)} сесій · конверсія ${n.cr}%`),
    tile('Повернулись', nf(r.sessions), `${share(r.sessions)} сесій · конверсія ${r.cr}%`),
    tile('Різниця в конверсії', r.cr || n.cr ? (Math.round((r.cr - n.cr) * 10) / 10 > 0 ? '+' : '') + Math.round((r.cr - n.cr) * 10) / 10 + ' п.п.' : '—',
      r.cr > n.cr ? 'повторні купують охочіше' : r.cr < n.cr ? 'повторні купують гірше' : 'однаково'),
    tile('Дохід від повторних', money(r.revenue, cur), `з усіх ${money(n.revenue + r.revenue, cur)}`)
  ]));

  const kindRow = (x, label) => h('tr', {}, [
    h('td', {}, label),
    h('td', { class: 'num' }, nf(x.sessions)),
    h('td', { class: 'num' }, share(x.sessions)),
    h('td', { class: 'num' }, nf(x.orders)),
    h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
    h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
    h('td', { class: 'num' }, x.bounceRate + '%'),
    h('td', { class: 'num' }, String(x.pages)),
    h('td', { class: 'num' }, dur(x.dwell * 1000)),
    h('td', { class: 'num' }, String(x.friction))
  ]);
  view.appendChild(card('Нові проти тих, хто повернувся', 'повторним уже не треба знайомитись із сайтом — якщо вони купують не краще, справа не в довірі',
    table(['Хто', { label: 'Сесій', num: 1 }, { label: 'Частка', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 },
      { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Сторінок', num: 1 }, { label: 'Час', num: 1 }, { label: 'Фрикшн', num: 1 }],
    [kindRow(n, 'Перший візит'), kindRow(r, 'Повернулись')])));

  if (d.visitBuckets.length) {
    const buckets = d.visitBuckets.map((b) => ({ ...b, label: b.bucket === '1' ? '1 візит' : b.bucket === '2' ? '2 візити' : b.bucket + ' візитів' }));
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Скільки разів люди приходили', 'рахуються всі візити людини за весь час, не лише в цьому періоді',
      h('div', {}, [
        barChart(buckets, { labelKey: 'label', valueKey: 'visitors', note: (x) => `${nf(x.buyers || 0)} з них купили` }),
        table(['Візитів', { label: 'Людей', num: 1 }, { label: 'З них купили', num: 1 }, { label: 'Частка покупців', num: 1 }],
          buckets.map((b) => h('tr', {}, [
            h('td', {}, b.label),
            h('td', { class: 'num' }, nf(b.visitors)),
            h('td', { class: 'num' }, nf(b.buyers || 0)),
            h('td', { class: 'num' }, b.visitors ? Math.round(((b.buyers || 0) / b.visitors) * 1000) / 10 + '%' : '—')
          ])))
      ]))));
  }

  const geoRow = (x, name) => h('tr', {}, [
    h('td', {}, name),
    h('td', { class: 'num' }, nf(x.sessions)),
    h('td', { class: 'num' }, nf(x.orders)),
    h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
    h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
    h('td', { class: 'num' }, x.bounceRate + '%'),
    h('td', { class: 'num' }, x.friction > 25 ? h('span', { class: 'pill warning' }, String(x.friction)) : String(x.friction))
  ]);
  const GEO_COLS = ['Місце', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 },
    { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Фрикшн', num: 1 }];

  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Країни', 'визначається на боці сервера, VPN і проксі можуть збивати',
    h('div', {}, [
      barChart(d.countries.slice(0, 8), { labelKey: 'country', valueKey: 'sessions', note: (x) => `конверсія ${x.cr}%` }),
      table(GEO_COLS, d.countries.map((x) => geoRow(x, x.country)))
    ]))));

  if (d.cities.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Міста', 'корисно, коли конверсія падає там, куди погано їде доставка',
      table(GEO_COLS, d.cities.map((x) => geoRow(x, `${x.city}${x.country ? ', ' + x.country : ''}`))))));
  } else {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Міста', null,
      h('div', { class: 'empty' }, 'Місто визначає хостинг, на якому працює Conv Lens. На Vercel воно є одразу; на своєму сервері потрібен заголовок від CDN.'))));
  }

  view.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, [
    card('Браузери і системи', 'дивіться на фрикшн: він видає зламану верстку в конкретному браузері',
      table(['Браузер', { label: 'Сесій', num: 1 }, { label: 'Конверсія', num: 1 }, { label: 'Фрикшн', num: 1 }],
        d.browsers.map((x) => h('tr', {}, [
          h('td', {}, `${x.browser} · ${x.os}`),
          h('td', { class: 'num' }, nf(x.sessions)),
          h('td', { class: 'num' }, x.cr ? x.cr + '%' : '—'),
          h('td', { class: 'num' }, x.friction > 25 ? h('span', { class: 'pill warning' }, String(x.friction)) : String(x.friction))
        ])))),
    card('Мова браузера', 'підказує, чи потрібна версія сайту іншою мовою',
      table(['Мова', { label: 'Сесій', num: 1 }, { label: 'Конверсія', num: 1 }],
        d.languages.map((x) => h('tr', {}, [
          h('td', { class: 'mono' }, x.lang),
          h('td', { class: 'num' }, nf(x.sessions)),
          h('td', { class: 'num' }, x.cr ? x.cr + '%' : '—')
        ]))))
  ]));
}

// Where people go from page to page, where they drop out, and where they go in circles.
async function renderJourney() {
  const d = await api('journey');
  view.innerHTML = '';

  if (!d.transitions.length && !d.exits.length) {
    view.appendChild(h('div', { class: 'empty' }, 'Переходів між сторінками ще не було: у всіх сесіях лише одна сторінка.'));
    return;
  }

  const onePage = (d.steps.find((s) => s.pages === 1) || { sessions: 0 }).sessions;
  const allSteps = d.steps.reduce((a, s) => a + s.sessions, 0);
  const deepest = d.steps.length ? d.steps[d.steps.length - 1].pages : 0;
  view.appendChild(h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, [
    tile('Переглядів однієї сторінки', allSteps ? Math.round((onePage / allSteps) * 100) + '%' : '—', `${nf(onePage)} сесій не пішли далі`),
    tile('Найглибша сесія', deepest ? deepest + ' сторінок' : '—', 'скільки сторінок встигли подивитись'),
    tile('Різних переходів', nf(d.transitions.length), 'між якими сторінками ходять'),
    tile('Петель', nf(d.loops.length), d.loops.length ? 'місця, де люди вертаються назад' : 'люди не ходять колами')
  ]));

  view.appendChild(card('Куди йдуть зі сторінки', 'найчастіші переходи; якщо потрібного переходу тут немає — його не знаходять',
    table(['Зі сторінки', 'На сторінку', { label: 'Разів', num: 1 }, { label: 'Сесій', num: 1 }],
      d.transitions.map((t) => h('tr', {}, [
        h('td', { class: 'mono trunc' }, t.path),
        h('td', { class: 'mono trunc' }, t.next),
        h('td', { class: 'num' }, nf(t.n)),
        h('td', { class: 'num' }, nf(t.sessions))
      ])))));

  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Де сесія обривається', 'частка переглядів сторінки, після яких людина пішла з сайту',
    table(['Сторінка', { label: 'Переглядів', num: 1 }, { label: 'Виходів', num: 1 }, { label: 'Частка виходів', num: 1 }],
      d.exits.map((e) => h('tr', {}, [
        h('td', { class: 'mono trunc' }, e.path),
        h('td', { class: 'num' }, nf(e.total)),
        h('td', { class: 'num' }, nf(e.exits)),
        h('td', { class: 'num' }, e.exitRate > 70 ? h('span', { class: 'pill critical' }, e.exitRate + '%') : e.exitRate + '%')
      ]))))));

  if (d.loops.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Ходять колами', 'пішли зі сторінки і одразу повернулись на неї — зазвичай не знайшли того, по що йшли',
      table(['Зі сторінки', 'Заглянули в', { label: 'Сесій', num: 1 }, { label: 'Разів', num: 1 }],
        d.loops.map((l) => h('tr', {}, [
          h('td', { class: 'mono trunc' }, l.a),
          h('td', { class: 'mono trunc' }, l.b),
          h('td', { class: 'num' }, nf(l.sessions)),
          h('td', { class: 'num' }, nf(l.n))
        ]))))));
  }

  view.appendChild(h('div', { class: 'grid cols-2', style: 'margin-top:14px' }, [
    card('З якої сторінки починають', null,
      table(['Сторінка', { label: 'Сесій', num: 1 }],
        d.entries.map((e) => h('tr', {}, [h('td', { class: 'mono trunc' }, e.path), h('td', { class: 'num' }, nf(e.n))])))),
    card('Скільки сторінок за сесію', null,
      d.steps.length
        ? barChart(d.steps.map((s) => ({ label: s.pages + (s.pages === 1 ? ' сторінка' : ' сторінок'), sessions: s.sessions })),
            { labelKey: 'label', valueKey: 'sessions' })
        : h('div', { class: 'empty' }, 'Немає даних'))
  ]));
}

const MEDIUM_LABEL = {
  ai: 'AI-асистент', organic: 'пошук', cpc: 'реклама в пошуку', paid_social: 'реклама в соцмережах',
  social: 'соцмережа', messenger: 'месенджер', email: 'розсилка', aggregator: 'агрегатор',
  referral: 'перехід із сайту', none: 'прямий захід'
};
const mediumLabel = (m) => MEDIUM_LABEL[m] || m || '—';

// Where visitors come from: channels, exact sources, campaigns, referring sites and
// landing pages — each with what matters, which is conversion, not just volume.
async function renderSources() {
  const d = await api('traffic');
  const cur = d.currency || state.currency || '';
  view.innerHTML = '';

  if (!d.channels.length) {
    view.appendChild(h('div', { class: 'empty' }, 'За цей період ще немає візитів.'));
    return;
  }

  const total = d.channels.reduce((a, c) => a + c.sessions, 0);
  const biggest = d.channels[0];
  const earners = d.channels.filter((c) => c.orders > 0).sort((a, b) => b.revenue - a.revenue);
  const best = [...d.channels].filter((c) => c.sessions >= 5).sort((a, b) => b.cr - a.cr)[0];
  const worst = [...d.channels].filter((c) => c.sessions >= 10).sort((a, b) => b.bounceRate - a.bounceRate)[0];

  view.appendChild(h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, [
    tile('Найбільший канал', biggest.name, `${nf(biggest.sessions)} сесій · ${Math.round((biggest.sessions / total) * 100)}% трафіку`),
    tile('Найбільше грошей', earners.length ? earners[0].name : '—', earners.length ? money(earners[0].revenue, cur) : 'замовлень ще немає'),
    tile('Найкраща конверсія', best ? best.name : '—', best ? `${best.cr}% · ${nf(best.sessions)} сесій` : 'замало даних'),
    tile('Найбільше відмов', worst ? worst.name : '—', worst ? `${worst.bounceRate}% пішли одразу` : 'замало даних')
  ]));

  const chRow = (x) => h('tr', {}, [
    h('td', {}, x.name || x.source || '—'),
    h('td', { class: 'num' }, nf(x.sessions)),
    h('td', { class: 'num' }, `${Math.round((x.sessions / total) * 100)}%`),
    h('td', { class: 'num' }, nf(x.orders)),
    h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
    h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
    h('td', { class: 'num' }, x.bounceRate + '%'),
    h('td', { class: 'num' }, dur(x.dwell * 1000)),
    h('td', { class: 'num' }, x.friction > 25 ? h('span', { class: 'pill warning' }, String(x.friction)) : String(x.friction))
  ]);
  const COLS = ['Канал', { label: 'Сесій', num: 1 }, { label: 'Частка', num: 1 }, { label: 'Замовлень', num: 1 },
    { label: 'Конверсія', num: 1 }, { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 },
    { label: 'Час', num: 1 }, { label: 'Фрикшн', num: 1 }];

  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Канали', 'згруповано як у звичайній аналітиці: пошук, реклама, соцмережі, прямі заходи',
    h('div', {}, [
      barChart(d.channels.slice(0, 8), { labelKey: 'name', valueKey: 'sessions', note: (x) => `конверсія ${x.cr}%` }),
      table(COLS, d.channels.map(chRow))
    ]))));

  const ai = d.ai || { sources: [], total: { sessions: 0 } };
  const aiCard = h('div', { style: 'margin-top:14px' }, card('Трафік зі штучного інтелекту',
    'ChatGPT, Perplexity, Gemini, Claude, Copilot та інші асистенти — окремо від звичайного пошуку',
    h('div', {}, [
      ai.total.sessions
        ? h('div', {}, [
            h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, [
              tile('Сесій з AI', nf(ai.total.sessions), `${Math.round((ai.total.sessions / total) * 1000) / 10}% усього трафіку`),
              tile('Замовлень', nf(ai.total.orders), ai.total.orders ? `конверсія ${ai.total.cr}%` : 'поки жодного'),
              tile('Дохід', ai.total.revenue ? money(ai.total.revenue, cur) : '—', 'з візитів через асистентів'),
              tile('Відмови', ai.total.bounceRate + '%', 'пішли майже одразу')
            ]),
            table(['Асистент', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 },
              { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Фрикшн', num: 1 }],
              ai.sources.map((x) => h('tr', {}, [
                h('td', {}, x.source),
                h('td', { class: 'num' }, nf(x.sessions)),
                h('td', { class: 'num' }, nf(x.orders)),
                h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
                h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
                h('td', { class: 'num' }, x.bounceRate + '%'),
                h('td', { class: 'num' }, String(x.friction))
              ]))),
            (ai.landing || []).length
              ? h('div', { style: 'margin-top:22px' }, [
                  h('h3', { style: 'margin:0 0 4px;font-size:15px' }, 'На які сторінки вони ведуть'),
                  h('p', { class: 'fld-h', style: 'margin:0 0 10px' },
                    'Сторінка, з якої почалась сесія — тобто та, яку асистент показав у відповіді. '
                    + 'Якщо серед них немає тих, що ви просуваєте, асистенти цитують не те.'),
                  table(['Сторінка', 'Хто привів', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 },
                    { label: 'Конверсія', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Фрикшн', num: 1 }],
                    ai.landing.map((x) => h('tr', {}, [
                      h('td', { class: 'mono trunc' }, x.path),
                      h('td', {}, x.from.map((f) => `${f.source} (${f.sessions})`).join(', ')),
                      h('td', { class: 'num' }, nf(x.sessions)),
                      h('td', { class: 'num' }, nf(x.orders)),
                      h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
                      h('td', { class: 'num' }, x.bounceRate + '%'),
                      h('td', { class: 'num' }, x.friction > 25 ? h('span', { class: 'pill warning' }, String(x.friction)) : String(x.friction))
                    ])))
                ])
              : null
          ])
        : h('div', { class: 'empty' }, 'Переходів з AI-асистентів за цей період не зафіксовано.'),
      h('p', { class: 'fld-h', style: 'margin-top:12px' },
        'Це нижня межа, а не точна цифра: частина асистентів не передає, звідки прийшов користувач, '
        + 'а в мобільних застосунках посилання часто відкривається без цих даних — такі візити потрапляють у «Прямі заходи». '
        + 'Щоб бачити більше, додавайте до посилань, які ви самі даєте асистентам, мітку utm_source.')
    ])));
  view.appendChild(aiCard);

  const srcRow = (x) => h('tr', {}, [
    h('td', {}, x.source || '—'),
    h('td', {}, mediumLabel(x.medium)),
    h('td', { class: 'num' }, nf(x.sessions)),
    h('td', { class: 'num' }, nf(x.orders)),
    h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
    h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
    h('td', { class: 'num' }, x.bounceRate + '%'),
    h('td', { class: 'num' }, String(x.friction))
  ]);
  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Конкретні джерела', 'звідки саме прийшли: сайт-донор і тип переходу',
    table(['Джерело', 'Тип', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 },
      { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Фрикшн', num: 1 }],
    d.sources.map(srcRow)))));

  if (d.campaigns.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Рекламні кампанії', 'з міток utm_campaign, utm_source і utm_medium у посиланнях',
      table(['Кампанія', 'Джерело', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 }, { label: 'Дохід', num: 1 }, { label: 'Відмови', num: 1 }],
      d.campaigns.map((x) => h('tr', {}, [
        h('td', {}, x.campaign),
        h('td', { class: 'mono' }, `${x.source} / ${x.medium}`),
        h('td', { class: 'num' }, nf(x.sessions)),
        h('td', { class: 'num' }, nf(x.orders)),
        h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
        h('td', { class: 'num' }, x.revenue ? money(x.revenue, cur) : '—'),
        h('td', { class: 'num' }, x.bounceRate + '%')
      ]))))));
  }

  if (d.referrers.length) {
    view.appendChild(h('div', { style: 'margin-top:14px' }, card('Сайти, які на вас посилаються', 'повна адреса сторінки, з якої прийшли',
      table(['Сторінка-донор', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 }],
      d.referrers.map((x) => h('tr', {}, [
        h('td', { class: 'mono trunc' }, x.referrer),
        h('td', { class: 'num' }, nf(x.sessions)),
        h('td', { class: 'num' }, nf(x.orders)),
        h('td', { class: 'num' }, x.cr ? x.cr + '%' : '—')
      ]))))));
  }

  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Сторінки входу', 'на яку сторінку люди потрапляють першою і що з того виходить',
    table(['Сторінка', { label: 'Сесій', num: 1 }, { label: 'Замовлень', num: 1 }, { label: 'Конверсія', num: 1 }, { label: 'Відмови', num: 1 }, { label: 'Фрикшн', num: 1 }],
    d.landing.map((x) => h('tr', {}, [
      h('td', { class: 'mono trunc' }, x.path),
      h('td', { class: 'num' }, nf(x.sessions)),
      h('td', { class: 'num' }, nf(x.orders)),
      h('td', { class: 'num' }, x.cr ? h('b', {}, x.cr + '%') : '—'),
      h('td', { class: 'num' }, x.bounceRate + '%'),
      h('td', { class: 'num' }, x.friction > 25 ? h('span', { class: 'pill warning' }, String(x.friction)) : String(x.friction))
    ]))))));
}

// Events the site sends itself: cl('event', 'name', {...}) plus everything autoTrack catches.
async function renderEvents() {
  const d = await api('events');
  const ev = d.events || [];
  view.innerHTML = '';
  if (!ev.length) {
    view.appendChild(h('div', { class: 'empty' }, 'Своїх подій ще немає. Кроки фунела працюють і без них, а окрему подію можна надіслати рядком cl(\'event\', \'назва\').'));
    return;
  }
  const top = ev.slice(0, 20).map((x) => ({ label: x.event + (x.label ? ' · ' + x.label : ''), sessions: x.sessions, n: x.n }));
  view.appendChild(card('Найчастіші події', 'скільком сесіям траплялась кожна подія',
    barChart(top, { labelKey: 'label', valueKey: 'sessions', note: (it) => `${nf(it.n)} разів` })));
  view.appendChild(h('div', { style: 'margin-top:14px' }, card('Усі події', 'назва події та її мітка', table(
    ['Подія', 'Деталь', { label: 'Сесій', num: 1 }, { label: 'Разів', num: 1 }],
    ev.map((x) => h('tr', {}, [
      h('td', { class: 'mono' }, x.event),
      h('td', {}, x.label || '—'),
      h('td', { class: 'num' }, nf(x.sessions)),
      h('td', { class: 'num' }, nf(x.n))
    ]))))));
}

async function renderSettingsTab() {
  await renderSettings(view, {
    api, apiPost, presets: state.presets,
    onChange: () => { refreshSites(); },
    onAdded: (site) => { state.site = site.id; refreshSites().then(() => switchTab('settings')); }
  });
}

async function renderTab() {
  loading();
  hideTip();
  try { await TABS[state.tab](); } catch (e) { fail(e); }
}
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  renderTab();
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) switchTab(b.dataset.tab);
});
document.getElementById('fRange').addEventListener('change', (e) => { state.days = +e.target.value; renderTab(); });
document.getElementById('fDevice').addEventListener('change', (e) => { state.device = e.target.value; renderTab(); });
document.getElementById('fSource').addEventListener('change', (e) => { state.source = e.target.value; renderTab(); });
document.getElementById('btnReload').addEventListener('click', renderTab);
document.getElementById('btnCompare').addEventListener('click', (e) => {
  state.compare = !state.compare;
  e.target.setAttribute('aria-pressed', String(state.compare));
  e.target.classList.toggle('on', state.compare);
  if (state.tab === 'overview') renderTab();
  else switchTab('overview');
});
document.getElementById('fSite').addEventListener('change', (e) => {
  state.site = e.target.value;
  state.cache = {};
  renderTab();
});
document.getElementById('btnTheme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('cl_theme', next); } catch {}
});
try {
  const t = localStorage.getItem('cl_theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
} catch {}

const currentSite = () => state.sites.find((x) => x.id === state.site) || null;

// Two ways to replay a session. The snapshot player rebuilds the page from the layout the
// tracker recorded and always works. The live player opens the real page in an iframe and
// drives it over postMessage — the only way to replay a canvas or 3D scene, which no DOM
// snapshot can capture. It is opt-in per site because it needs the page to publish a replay API.
function liveReplaySite() {
  const cur = currentSite();
  return cur && cur.origin && cur.replayMode === 'live' ? cur.origin : '';
}

// The click map reads the framed page's DOM to measure it, which no bridge can do across
// domains, so it stays same-origin only.
function sameOriginSite() {
  const cur = currentSite();
  if (!cur || !cur.origin) return false;
  try { return new URL(cur.origin).origin === location.origin; } catch { return false; }
}

function siteSelect() {
  const sel = document.getElementById('fSite');
  if (!sel) return;
  sel.innerHTML = '';
  state.sites.forEach((x) => sel.appendChild(h('option', { value: x.id }, x.name || x.origin || x.id)));
  sel.value = state.site;
  sel.style.display = state.sites.length > 1 ? '' : 'none';
}

async function refreshSites() {
  const res = await fetch('/api/bootstrap', { headers: KEY ? { Authorization: `Bearer ${KEY}` } : {} });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401 || d.needsKey) throw new AuthError('bad key');
  state.sites = d.sites || [];
  state.presets = d.presets || [];
  if (!state.site || !state.sites.some((x) => x.id === state.site)) state.site = state.sites[0]?.id || '';
  siteSelect();
  const label = document.getElementById('siteLabel');
  const cur = state.sites.find((x) => x.id === state.site);
  if (label && cur) label.textContent = (cur.origin || cur.name || '').replace(/^https?:\/\//, '');
  return d;
}

let booted = false;
async function boot() {
  // Before anything is set up the instance is open and the wizard runs with no key at all.
  try {
    const probe = await fetch('/api/bootstrap');
    const pd = await probe.json().catch(() => ({}));
    if (pd.needsSetup) {
      document.body.classList.add('setup-mode');
      return renderSetup(view, {
        presets: pd.presets || [],
        onDone: (token) => {
          KEY = token; saveKey(token);
          document.body.classList.remove('setup-mode');
          booted = false;
          boot();
        }
      });
    }
  } catch { /* fall through to the normal login */ }

  if (!KEY) return showLogin(false);

  try {
    const d = await refreshSites();
    if (!state.sites.length) {
      view.innerHTML = '';
      view.appendChild(h('div', { class: 'empty' }, 'Жодного сайту ще немає — відкрийте «Налаштування», щоб додати перший.'));
      switchTab('settings');
      return;
    }
    if (d.storage === 'tmp' || d.storage === 'none') {
      const n = h('div', { class: 'card', style: 'margin:0 0 14px;padding:12px 16px;border-left:4px solid #d43031' },
        'Дані пишуться у тимчасове сховище і можуть зникнути. Підключіть постійну базу (Turso або файл на диску).');
      document.querySelector('.wrap').insertBefore(n, document.getElementById('tabs'));
    }
  } catch (e) {
    return fail(e);
  }

  renderTab();
  if (booted) return;
  booted = true;
  api('sources').then((d) => {
    const sel = document.getElementById('fSource');
    sel.innerHTML = '<option value="">Усі канали</option>';
    [...new Set(d.sources.map((x) => x.source))].forEach((x) => sel.appendChild(h('option', { value: x }, x)));
  }).catch(() => { booted = false; });
}

document.getElementById('btnLogout').addEventListener('click', logout);
boot();
