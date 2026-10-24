// Session player for the 9584-S cutaway page.
// Instead of drawing a wireframe of the layout, it opens the real page (/?replay=1) in an iframe at the
// visitor's viewport size and drives it: scroll position, the 3D scene state (camera, explode, selected layer,
// filter, hover), plus a cursor and click ripples on top. Same origin, so the player talks to window.__replay.
import { h, dur } from './charts.js';

const CSS = `
.lr { display:grid; grid-template-columns:minmax(0,1fr) 320px; min-height:560px; }
.lr-main { display:flex; flex-direction:column; min-width:0; background:var(--surface-3); }
.lr-stage { position:relative; flex:1; min-height:380px; overflow:hidden; }
.lr-screen { position:absolute; top:16px; left:0; transform-origin:0 0; border-radius:10px; overflow:hidden;
  box-shadow:0 1px 2px rgba(0,0,0,.12), 0 18px 50px -12px rgba(0,0,0,.35); background:#fff; }
.lr-screen iframe { display:block; border:0; pointer-events:none; background:#fff; }
.lr-overlay { position:absolute; inset:0; pointer-events:none; }
.lr-cursor { position:absolute; left:0; top:0; width:22px; height:22px; margin:-2px 0 0 -3px; z-index:5;
  filter:drop-shadow(0 2px 3px rgba(0,0,0,.35)); will-change:transform; }
.lr-ring { position:absolute; width:34px; height:34px; margin:-17px 0 0 -17px; border-radius:50%;
  border:3px solid var(--series-1); background:color-mix(in srgb, var(--series-1) 18%, transparent);
  animation:lrRing .75s ease-out forwards; z-index:4; }
.lr-ring.rage { border-color:var(--critical); background:color-mix(in srgb, var(--critical) 18%, transparent); }
.lr-ring.dead { border-color:var(--warning); background:color-mix(in srgb, var(--warning) 18%, transparent); }
@keyframes lrRing { from { transform:scale(.4); opacity:1 } to { transform:scale(1.6); opacity:0 } }
.lr-loading { position:absolute; inset:0; display:grid; place-items:center; color:var(--text-2); font-size:13px;
  background:var(--surface-3); z-index:6; transition:opacity .3s; }
.lr-badge { position:absolute; top:24px; right:24px; z-index:6; background:rgba(11,11,11,.72); color:#fff;
  font-size:12px; padding:5px 10px; border-radius:999px; font-variant-numeric:tabular-nums; }
.lr-controls { display:flex; align-items:center; gap:10px; padding:10px 14px; border-top:1px solid var(--border);
  background:var(--surface-2); flex-wrap:wrap; }
.lr-controls button { min-width:0; }
.lr-play { width:40px; height:36px; border-radius:10px; font-size:14px; }
.lr-speed { display:flex; border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.lr-speed button { border:0; border-radius:0; padding:7px 10px; background:transparent; color:var(--text-2); font-size:12.5px; cursor:pointer; }
.lr-speed button[aria-pressed="true"] { background:var(--series-1); color:#fff; }
.lr-skip { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-2); white-space:nowrap; }
.lr-time { font-variant-numeric:tabular-nums; font-size:12.5px; color:var(--text-2); white-space:nowrap; }
.lr-bar { position:relative; flex:1 1 220px; min-width:160px; height:30px; cursor:pointer; touch-action:none; }
.lr-bar .tr { position:absolute; left:0; right:0; top:13px; height:4px; border-radius:3px; background:var(--surface-3); }
.lr-bar .fi { position:absolute; left:0; top:13px; height:4px; border-radius:3px; background:var(--series-1); width:0; }
.lr-bar .kn { position:absolute; top:8px; width:14px; height:14px; margin-left:-7px; border-radius:50%; background:var(--series-1);
  box-shadow:0 0 0 3px var(--surface-2); left:0; }
.lr-bar .mk { position:absolute; top:9px; width:3px; height:12px; margin-left:-1px; border-radius:2px; opacity:.85; }
.lr-bar .mk.good { background:var(--good); } .lr-bar .mk.warning { background:var(--warning); }
.lr-bar .mk.critical { background:var(--critical); } .lr-bar .mk.click { background:var(--series-1); opacity:.35; height:8px; top:11px; }
.lr-side { display:flex; flex-direction:column; border-left:1px solid var(--border); min-height:0; max-height:760px; background:var(--surface-2); }
.lr-meta { padding:14px 16px; border-bottom:1px solid var(--border); display:grid; gap:6px; font-size:12.5px; color:var(--text-2); }
.lr-meta b { color:var(--text); font-size:14px; }
.lr-meta .mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px; }
.lr-list { overflow-y:auto; flex:1; min-height:0; position:relative; }
@media (max-width:980px) { .lr { grid-template-columns:1fr; } .lr-side { border-left:0; border-top:1px solid var(--border); max-height:360px; } }
`;

const CURSOR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2.5l15.5 9.2-6.9 1.5 3.9 7.3-3 1.6-3.9-7.3-5 4.8z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const LABELS = {
  pageview: ['Відкрив сторінку', 'info'], click: ['Клік', ''], rage_click: ['Rage-кліки', 'critical'], dead_click: ['Клік без реакції', 'warning'],
  js_error: ['JS-помилка', 'critical'], net_error: ['Помилка запиту', 'critical'], exit_intent: ['Курсор пішов до закриття', 'warning'],
  zoom: ['Зум сторінки', 'warning'], hscroll: ['Горизонтальний скрол', 'warning'], back_nav: ['Кнопка «назад»', 'warning'],
  copy: ['Скопіював текст', ''], page_leave: ['Пішов зі сторінки', 'info'], element_seen: ['Побачив кнопку', ''],
  session_start: ['Початок сесії', 'info'], slow_interaction: ['Інтерфейс підвис', 'warning'], goal: ['Ціль', 'good']
};
const CUSTOM = {
  explode: (p) => 'Розібрав будинок' + via(p), assemble: (p) => 'Зібрав будинок' + via(p),
  layer_open: (p) => 'Відкрив шар: ' + (p.name || p.layer), layer_hover: (p) => 'Затримав курсор: ' + (p.name || p.layer),
  filter: (p) => 'Фільтр: ' + (p.cat || ''), peel: (p) => 'Повзунок: ' + (p.value ?? '') + '%',
  lead_intent: (p) => 'Клік на CTA: ' + (p.label || ''), reset_view: () => 'Скинув вид'
};
const VIA = { house_click: 'кліком по будинку', dock_button: 'кнопкою', hero_button: 'кнопкою вгорі', peel: 'повзунком', model: 'кліком по шару', list: 'зі списку', pin: 'по мітці', system_card: 'з карток систем' };
function via(p) { return p && VIA[p.via] ? ' ' + VIA[p.via] : ''; }
const fmt = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const clickLabel = (l) => (/^3D model/i.test(l || '') ? '3D-модель' : (l || '').slice(0, 70));

function injectCss() {
  if (document.getElementById('lr-css')) return;
  const s = document.createElement('style'); s.id = 'lr-css'; s.textContent = CSS; document.head.appendChild(s);
}

// Piecewise time map: idle gaps longer than IDLE shrink to IDLE_KEEP when "skip idle" is on.
function buildTimeline(start, end, stamps, skip) {
  const IDLE = 2500, IDLE_KEEP = 700;
  const pts = [...new Set([start, ...stamps.filter((t) => t > start && t < end), end])].sort((a, b) => a - b);
  const map = [{ r: pts[0], v: 0 }];
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i] - pts[i - 1];
    map.push({ r: pts[i], v: map[i - 1].v + (skip && gap > IDLE ? IDLE_KEEP : gap) });
  }
  const total = map[map.length - 1].v || 1;
  const find = (arr, key, x) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m][key] <= x) lo = m; else hi = m - 1; } return lo; };
  return {
    total,
    toVirt(r) { if (r <= map[0].r) return 0; const i = find(map, 'r', r); const a = map[i], b = map[i + 1]; if (!b) return total; return a.v + (b.v - a.v) * ((r - a.r) / Math.max(1, b.r - a.r)); },
    toReal(v) { if (v <= 0) return map[0].r; const i = find(map, 'v', v); const a = map[i], b = map[i + 1]; if (!b) return map[map.length - 1].r; return a.r + (b.r - a.r) * ((v - a.v) / Math.max(1, b.v - a.v)); }
  };
}

// Value at time t from a sorted [{ts, ...}] list: linear between close points, held across long gaps.
function sample(list, t, keys, maxGap = 1200) {
  if (!list.length || t < list[0].ts) return null;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].ts <= t) lo = m; else hi = m - 1; }
  const a = list[lo], b = list[lo + 1];
  if (!b || b.ts - a.ts > maxGap) return a;
  const k = (t - a.ts) / Math.max(1, b.ts - a.ts), out = { ...a };
  for (const key of keys) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

export function renderLiveReplay(host, detail, { onClose, visitorTag, onHeatmap } = {}) {
  injectCss();
  const { session, events } = detail;
  const custom = (e) => e.type === 'custom' || e.type === 'goal';
  const props = (e) => (e.data && e.data.props) || {};

  // ---- data ----
  const pageStarts = events.filter((e) => e.type === 'pageview').map((e) => e.ts).sort((a, b) => a - b);
  const pageBase = (ts) => { let b = session.started_at; for (const p of pageStarts) if (p <= ts) b = p; return b; };
  const env = props(events.find((e) => custom(e) && e.name === '_env') || {});
  const vw = env.vw || session.vw || 1280, vh = env.vh || session.vh || 800;

  const mouse = [];
  for (const e of events) if (e.type === 'mouse') {
    const base = pageBase(e.ts - 50);
    for (const [x, y, t] of (e.data.pts || [])) mouse.push({ ts: base + (t || 0), x, y });
  }
  mouse.sort((a, b) => a.ts - b.ts);
  const scrolls = events.filter((e) => e.type === 'scroll').map((e) => ({ ts: e.ts, y: e.data.y || 0 }));
  const clicks = events.filter((e) => ['click', 'rage_click', 'dead_click'].includes(e.type))
    .map((e) => ({ ts: e.ts, x: e.data.x || 0, y: e.data.y || 0, type: e.type }));
  const scene = [];
  for (const e of events) if (custom(e) && e.name === '_scene') {
    const pe = props(e), base = pe.v === 2 ? Number(pe.t0) || e.ts : 0;
    for (const f of (pe.f || [])) scene.push({ ts: base + f[0], cx: f[1], cy: f[2], cz: f[3], tx: f[4], ty: f[5], tz: f[6], E: f[7], sel: f[8], filter: f[9], hover: f[10], B: f[11] == null ? null : f[11] });
  }
  scene.sort((a, b) => a.ts - b.ts);
  const sceneB = scene.filter((x) => x.B != null);

  const visible = events.filter((e) => !['mouse', 'scroll', 'element_pos', 'perf', 'field_focus'].includes(e.type) && !(custom(e) && String(e.name || '').startsWith('_')));
  const activity = [...mouse.map((m) => m.ts), ...scrolls.map((s) => s.ts), ...clicks.map((c) => c.ts), ...visible.map((e) => e.ts)];
  scene.forEach((f, i) => { const p = scene[i - 1]; if (!p || p.E !== f.E || p.sel !== f.sel || p.hover !== f.hover || p.filter !== f.filter) activity.push(f.ts); });
  const start = Math.min(session.started_at, ...(events.length ? [events[0].ts] : []));
  const end = Math.max(session.last_at || 0, ...(events.length ? [events[events.length - 1].ts] : [start + 1000]));
  let skipIdle = true;
  let tl = buildTimeline(start, end, activity, skipIdle);

  // ---- DOM ----
  host.innerHTML = '';
  const iframe = h('iframe', { title: 'Відтворення сесії', scrolling: 'no', tabindex: '-1' });
  iframe.width = vw; iframe.height = vh;
  iframe.style.width = vw + 'px'; iframe.style.height = vh + 'px';
  const cursor = h('div', { class: 'lr-cursor' }); cursor.innerHTML = CURSOR_SVG;
  const overlay = h('div', { class: 'lr-overlay' }, cursor);
  const screen = h('div', { class: 'lr-screen' }, [iframe, overlay]);
  screen.style.width = vw + 'px'; screen.style.height = vh + 'px';
  const loading = h('div', { class: 'lr-loading' }, 'Завантажуємо сторінку…');
  const stageEl = h('div', { class: 'lr-stage' }, [screen, loading]);

  const fill = h('div', { class: 'fi' }), knob = h('div', { class: 'kn' });
  const bar = h('div', { class: 'lr-bar', title: 'Перемотати' }, [h('div', { class: 'tr' }), fill, knob]);
  const markers = h('div');
  bar.appendChild(markers);
  const btnPlay = h('button', { class: 'primary lr-play', 'aria-label': 'Відтворити' }, '▶');
  const speeds = [1, 2, 4, 8];
  const speedBox = h('div', { class: 'lr-speed', role: 'group', 'aria-label': 'Швидкість' },
    speeds.map((sp) => h('button', { type: 'button', 'aria-pressed': String(sp === 1), onclick: () => setSpeed(sp) }, sp + '×')));
  const skipBox = h('input', { type: 'checkbox', id: 'lrSkip' }); skipBox.checked = true;
  const skipLabel = h('label', { class: 'lr-skip', for: 'lrSkip' }, [skipBox, 'Пропускати паузи']);
  const timeEl = h('span', { class: 'lr-time' }, '0:00');
  const controls = h('div', { class: 'lr-controls' }, [btnPlay, speedBox, bar, timeEl, skipLabel,
    onHeatmap ? h('button', { class: 'ghost', title: 'Усі кліки цієї сесії на сторінці', onclick: () => { destroy(); onHeatmap(); } }, 'Карта кліків') : null,
    onClose ? h('button', { class: 'ghost', onclick: () => { destroy(); onClose(); } }, '✕ Закрити') : null]);

  const place = [session.city, session.region, session.country].filter(Boolean).join(', ');
  const meta = h('div', { class: 'lr-meta' }, [
    h('div', {}, [h('b', {}, 'Відвідувач ' + (visitorTag ? visitorTag(session.visitor_id) : (session.visitor_id || '').slice(0, 4).toUpperCase())),
      ' · ' + (session.visits > 1 ? `візит ${session.visit_no} з ${session.visits}` : 'перший візит')]),
    h('div', { class: 'mono' }, (session.ip || 'IP невідомий') + (session.ip_people > 1 ? ` · ${session.ip_people} відвідувачів з цього IP` : '')),
    place ? h('div', {}, place) : null,
    h('div', {}, `${session.device}, ${session.browser}, ${session.os} · екран ${vw}×${vh}`),
    h('div', {}, `Звідки: ${session.source}${session.medium && session.medium !== 'none' ? ' / ' + session.medium : ''}`),
    h('div', {}, `${new Date(session.started_at).toLocaleString('uk-UA')} · ${dur(session.duration)}`),
    h('div', {}, `Дійшов до: ${session.max_step_id || '—'} · фрикшн ${session.friction}/100`)
  ]);
  const list = h('div', { class: 'lr-list' });
  const rows = [];
  let prevRow = null;
  visible.forEach((e) => {
    const [label, sev] = custom(e) && CUSTOM[e.name] ? [CUSTOM[e.name](props(e)), 'good']
      : custom(e) ? ['Подія: ' + e.name, 'good']
      : LABELS[e.type] || [e.type, ''];
    const extra = ['click', 'rage_click', 'dead_click'].includes(e.type) ? ' ' + clickLabel(e.data.label || e.sel) : '';
    // Repeats of the same thing within 3 s collapse into one row with a counter.
    if (prevRow && prevRow.key === label + extra && e.ts - prevRow.last < 3000) {
      prevRow.n++; prevRow.last = e.ts; prevRow.count.textContent = ' ×' + prevRow.n; return;
    }
    const count = h('span', { style: 'opacity:.6' }, '');
    const node = h('div', { class: 'ev' + (sev ? ' sev-' + sev : ''), onclick: () => { seek(tl.toVirt(e.ts)); } }, [
      h('span', { class: 't' }, fmt(e.ts - start)),
      h('span', { class: 'd' }, [h('b', {}, label), extra, count])
    ]);
    list.appendChild(node);
    prevRow = { node, ts: e.ts, last: e.ts, key: label + extra, n: 1, count };
    rows.push(prevRow);
  });
  host.appendChild(h('div', { class: 'lr' }, [h('div', { class: 'lr-main' }, [stageEl, controls]), h('div', { class: 'lr-side' }, [meta, list])]));

  function drawMarkers() {
    markers.innerHTML = '';
    const add = (ts, cls) => { const m = h('div', { class: 'mk ' + cls }); m.style.left = (tl.toVirt(ts) / tl.total) * 100 + '%'; markers.appendChild(m); };
    clicks.forEach((c) => add(c.ts, c.type === 'rage_click' ? 'critical' : c.type === 'dead_click' ? 'warning' : 'click'));
    visible.filter((e) => custom(e)).forEach((e) => add(e.ts, 'good'));
    visible.filter((e) => ['js_error', 'net_error'].includes(e.type)).forEach((e) => add(e.ts, 'critical'));
  }
  drawMarkers();

  // ---- fit: scale the visitor's viewport into the stage and centre it ----
  function fit() {
    const W = stageEl.clientWidth;
    const maxH = Math.max(320, Math.min(680, innerHeight * 0.72));
    const k = Math.min((W - 32) / vw, (maxH - 32) / vh, 1);
    stageEl.style.height = Math.round(vh * k + 32) + 'px';
    screen.style.transform = `scale(${k})`;
    screen.style.left = Math.round((W - vw * k) / 2) + 'px';
  }
  const ro = new ResizeObserver(fit); ro.observe(stageEl); fit();

  // ---- page in the iframe ----
  let api = null;
  iframe.src = '/?replay=1';
  const waitApi = setInterval(() => {
    try {
      const w = iframe.contentWindow;
      if (w && w.__replay && w.__replay.ready) {
        clearInterval(waitApi);
        api = w.__replay;
        if (env.theme || env.dark !== undefined) api.theme(env.theme ? env.theme === 'dark' : !!env.dark);
        loading.style.opacity = 0; setTimeout(() => loading.remove(), 300);
        lastKey = ''; render(tl.toReal(virt));
      }
    } catch (e) { /* not ready */ }
  }, 150);

  // ---- playback ----
  let virt = 0, playing = false, speed = 1, raf = 0, lastNow = 0, lastKey = '', lastScroll = -1;
  let shown = new Set();
  function render(t) {
    const sc = sample(scrolls, t, ['y'], 900);
    const scrollY = sc ? Math.round(sc.y) : 0;
    const m = sample(mouse, t, ['x', 'y'], 900);
    const mx = m ? m.x : null, my = m ? m.y - scrollY : null;
    if (m) { cursor.style.display = ''; cursor.style.transform = `translate(${mx}px, ${my}px)`; } else cursor.style.display = 'none';

    if (api) {
      try {
        if (scrollY !== lastScroll) { iframe.contentWindow.scrollTo(0, scrollY); lastScroll = scrollY; }
        const f = sample(scene, t, ['cx', 'cy', 'cz', 'tx', 'ty', 'tz', 'E'], 1300);
        if (f && f.B != null) { const fb = sample(sceneB, t, ['B'], 700); if (fb) f.B = fb.B; }
        const key = f ? [f.cx, f.cy, f.cz, f.tx, f.ty, f.tz, f.E, f.sel, f.filter, f.hover, f.B, mx, my].join('|') : 'none|' + mx + '|' + my;
        if (key !== lastKey) {
          lastKey = key;
          api.apply(f ? { cam: [f.cx, f.cy, f.cz, f.tx, f.ty, f.tz, f.E, f.sel, f.filter, f.hover, f.B], mx, my } : { mx, my });
        }
      } catch (e) { /* iframe navigating */ }
    }

    clicks.forEach((c, i) => {
      if (shown.has(i) || t < c.ts || t - c.ts > 600) return;
      shown.add(i);
      const ring = h('div', { class: 'lr-ring' + (c.type === 'rage_click' ? ' rage' : c.type === 'dead_click' ? ' dead' : '') });
      ring.style.left = c.x + 'px'; ring.style.top = (c.y - scrollY) + 'px';
      overlay.appendChild(ring); setTimeout(() => ring.remove(), 800);
    });

    let active = -1;
    rows.forEach((r, i) => { if (r.ts <= t) active = i; });
    rows.forEach((r, i) => r.node.classList.toggle('active', i === active));
    if (active >= 0 && playing) {
      const n = rows[active].node;
      if (n.offsetTop < list.scrollTop || n.offsetTop + n.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = n.offsetTop - list.clientHeight / 2;
    }
    const pct = (virt / tl.total) * 100;
    fill.style.width = pct + '%'; knob.style.left = pct + '%';
    timeEl.textContent = `${fmt(t - start)} / ${fmt(end - start)}`;
  }
  function seek(v) {
    virt = Math.max(0, Math.min(tl.total, v));
    const t = tl.toReal(virt);
    shown = new Set(clicks.map((c, i) => (c.ts <= t ? i : -1)).filter((i) => i >= 0));
    render(t);
  }
  function loop(now) {
    if (!playing) return;
    const dt = lastNow ? Math.min(100, now - lastNow) : 16;
    lastNow = now;
    virt += dt * speed;
    if (virt >= tl.total) { virt = tl.total; setPlaying(false); }
    render(tl.toReal(virt));
    if (playing) raf = requestAnimationFrame(loop);
  }
  function setPlaying(on) {
    playing = on;
    btnPlay.textContent = on ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', on ? 'Пауза' : 'Відтворити');
    cancelAnimationFrame(raf);
    if (on) { if (virt >= tl.total) seek(0); lastNow = 0; raf = requestAnimationFrame(loop); }
  }
  function setSpeed(sp) {
    speed = sp;
    speedBox.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === sp + '×')));
  }
  btnPlay.addEventListener('click', () => setPlaying(!playing));
  skipBox.addEventListener('change', () => {
    const t = tl.toReal(virt);
    skipIdle = skipBox.checked;
    tl = buildTimeline(start, end, activity, skipIdle);
    drawMarkers(); seek(tl.toVirt(t));
  });
  let dragging = false;
  const seekAt = (ev) => { const r = bar.getBoundingClientRect(); seek(((ev.clientX - r.left) / r.width) * tl.total); };
  bar.addEventListener('pointerdown', (ev) => { dragging = true; bar.setPointerCapture(ev.pointerId); seekAt(ev); });
  bar.addEventListener('pointermove', (ev) => { if (dragging) seekAt(ev); });
  bar.addEventListener('pointerup', () => { dragging = false; });
  const onKey = (ev) => {
    if (ev.target.closest && ev.target.closest('input, select, textarea')) return;
    if (ev.code === 'Space') { ev.preventDefault(); setPlaying(!playing); }
    if (ev.code === 'ArrowRight') seek(virt + 5000 / 1);
    if (ev.code === 'ArrowLeft') seek(virt - 5000 / 1);
  };
  addEventListener('keydown', onKey);

  seek(0);
  function destroy() { setPlaying(false); clearInterval(waitApi); ro.disconnect(); removeEventListener('keydown', onKey); iframe.src = 'about:blank'; }
  return { destroy };
}
