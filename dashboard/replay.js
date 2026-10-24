import { h, nf, dur, showTip, hideTip } from './charts.js';

const EV_META = {
  pageview: { label: 'Перехід на сторінку', sev: 'info' },
  click: { label: 'Клік', sev: '' },
  rage_click: { label: 'RAGE-кліки', sev: 'critical' },
  dead_click: { label: 'Мертвий клік', sev: 'warning' },
  js_error: { label: 'JS-помилка', sev: 'critical' },
  net_error: { label: 'Помилка запиту', sev: 'critical' },
  validation_error: { label: 'Помилка валідації', sev: 'warning' },
  slow_interaction: { label: 'Інтерфейс підвис', sev: 'warning' },
  field_focus: { label: 'Почав заповнювати', sev: '' },
  field_blur: { label: 'Залишив поле', sev: '' },
  form_submit: { label: 'Відправив форму', sev: 'good' },
  exit_intent: { label: 'Курсор пішов до закриття', sev: 'warning' },
  zoom: { label: 'Зум сторінки', sev: 'warning' },
  hscroll: { label: 'Горизонтальний скрол', sev: 'warning' },
  back_nav: { label: 'Кнопка «назад»', sev: 'warning' },
  copy: { label: 'Скопіював текст', sev: '' },
  survey_answer: { label: 'Відповів в опитуванні', sev: 'good' },
  survey_shown: { label: 'Показали опитування', sev: '' },
  custom: { label: 'Подія', sev: 'good' },
  goal: { label: 'ЦІЛЬ', sev: 'good' },
  page_leave: { label: 'Пішов зі сторінки', sev: '' },
  perf: { label: 'Метрика швидкості', sev: '' },
  element_seen: { label: 'Побачив CTA', sev: '' },
  element_pos: { label: 'Позиція CTA', sev: '' },
  scroll: { label: 'Скрол', sev: '' },
  mouse: { label: 'Рух мишки', sev: '' },
  session_start: { label: 'Початок сесії', sev: 'info' },
  identify: { label: 'Ідентифікація', sev: '' }
};

const HIDDEN = new Set(['mouse', 'scroll', 'element_pos', 'perf']);

export function buildPage(snapshot, { interactive = false } = {}) {
  const page = h('div', { class: 'page' });
  if (!snapshot || !snapshot.els) return page;
  for (const e of snapshot.els) {
    const d = document.createElement('div');
    const kind = e.k === 'heading' || e.k === 'link' ? 'text' : e.k;
    d.className = 'el ' + kind + (e.t ? ' text' : '');
    const st = d.style;
    st.left = e.x + 'px'; st.top = e.y + 'px'; st.width = e.w + 'px'; st.height = e.h + 'px';
    if (e.bg) st.background = e.bg;
    if (e.c) st.color = e.c;
    if (e.fs) st.fontSize = Math.max(9, e.fs) + 'px';
    if (e.fw) st.fontWeight = e.fw;
    if (e.k === 'img' && e.src) { st.backgroundImage = `url(${e.src})`; st.backgroundSize = 'cover'; st.backgroundPosition = 'center'; }
    if (e.t) d.textContent = e.t;
    if (interactive && e.sel) { d.title = e.sel; d.dataset.sel = e.sel; }
    page.appendChild(d);
  }
  return page;
}

function compressTimeline(stamps, maxGap = 2200, keep = 420) {
  const sorted = [...new Set(stamps)].sort((a, b) => a - b);
  const map = [];
  let virt = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i] - sorted[i - 1];
      virt += gap > maxGap ? keep : gap;
    }
    map.push({ real: sorted[i], virt });
  }
  return {
    total: virt || 1,
    toReal(v) {
      for (let i = 1; i < map.length; i++) {
        if (v <= map[i].virt) {
          const a = map[i - 1], b = map[i];
          const k = (v - a.virt) / Math.max(1, b.virt - a.virt);
          return a.real + k * (b.real - a.real);
        }
      }
      return map.length ? map[map.length - 1].real : 0;
    },
    toVirt(r) {
      for (let i = 1; i < map.length; i++) {
        if (r <= map[i].real) {
          const a = map[i - 1], b = map[i];
          const k = (r - a.real) / Math.max(1, b.real - a.real);
          return a.virt + k * (b.virt - a.virt);
        }
      }
      return virt;
    }
  };
}

export function renderReplay(host, detail, onClose) {
  const { session, events, snapshots } = detail;
  host.innerHTML = '';

  const pageviews = events.filter((e) => e.type === 'pageview' || e.type === 'session_start');
  const pathStarts = [];
  pageviews.forEach((p) => pathStarts.push({ ts: p.ts, path: p.path }));
  if (!pathStarts.length) pathStarts.push({ ts: events[0]?.ts || session.started_at, path: session.entry_path });

  const snapFor = (path) => snapshots.find((s) => s.path === path) || snapshots[0] || null;
  const segments = [];
  pathStarts.sort((a, b) => a.ts - b.ts).forEach((p) => {
    const last = segments[segments.length - 1];
    if (last && (last.path === p.path || p.ts - last.start < 60)) { last.path = p.path; return; }
    segments.push({ start: p.ts, path: p.path });
  });
  segments.forEach((sg, i) => { sg.end = segments[i + 1] ? segments[i + 1].start : Infinity; });
  const segIndex = (ts) => {
    let idx = 0;
    for (let i = 0; i < segments.length; i++) if (segments[i].start <= ts) idx = i;
    return idx;
  };
  const baseFor = (ts) => segments[segIndex(ts)];

  const cursor = [];
  events.filter((e) => e.type === 'mouse').forEach((e) => {
    const base = baseFor(e.ts).ts;
    (e.data.pts || []).forEach(([x, y, t]) => cursor.push({ ts: base + (t || 0), x, y }));
  });
  cursor.sort((a, b) => a.ts - b.ts);

  const scrolls = events.filter((e) => e.type === 'scroll').map((e) => ({ ts: e.ts, y: e.data.y || 0 }));
  const clicks = events.filter((e) => ['click', 'rage_click', 'dead_click'].includes(e.type))
    .map((e) => ({ ts: e.ts, x: e.data.x || 0, y: e.data.y || 0, type: e.type, label: e.data.label || e.sel }));
  const visible = events.filter((e) => !HIDDEN.has(e.type));
  const inSeg = (list, sg) => list.filter((x) => x.ts >= sg.start - 400 && x.ts < sg.end);
  const scrollSeg = segments.map((sg) => inSeg(scrolls, sg));
  const cursorSeg = segments.map((sg) => inSeg(cursor, sg));

  const tl = compressTimeline([session.started_at, ...events.map((e) => e.ts), session.last_at]);
  let playing = false, speed = 1, virt = 0, raf = null, lastFrame = 0;

  const vw = session.vw || 1280, vh = session.vh || 800;
  const viewport = h('div', { class: 'viewport' });
  viewport.style.width = vw + 'px';
  viewport.style.height = vh + 'px';
  const stage = h('div', { class: 'stage' }, viewport);
  const cursorEl = h('div', { class: 'cursor' });

  let currentPath = null, pageEl = null;
  function ensurePage(path) {
    if (path === currentPath) return;
    currentPath = path;
    viewport.innerHTML = '';
    pageEl = buildPage(snapFor(path));
    viewport.appendChild(pageEl);
    viewport.appendChild(cursorEl);
  }

  function fit() {
    const avail = stage.clientWidth - 32, availH = 520;
    const k = Math.min(avail / vw, availH / vh, 1);
    viewport.style.transform = `scale(${k})`;
    viewport.style.transformOrigin = 'center center';
  }

  const evList = h('div', { class: 'ev-list' });
  const evNodes = new Map();
  visible.forEach((e, i) => {
    const meta = EV_META[e.type] || { label: e.type, sev: '' };
    const detailText = e.type === 'custom' || e.type === 'goal' ? (e.data.name || '')
      : e.type === 'js_error' || e.type === 'net_error' ? (e.data.msg || e.data.url || e.name || '')
      : e.type === 'validation_error' ? (e.data.label || e.name || '') + ' — ' + (e.data.msg || '')
      : e.type === 'field_blur' ? (e.data.label || e.name || '') + ` · ${Math.round((e.data.ms || 0) / 100) / 10} с, правок ${e.data.back || 0}`
      : e.type === 'survey_answer' ? (e.name || '') + (e.data.text ? ` — «${e.data.text}»` : '')
      : (e.data.label || e.sel || e.path || '');
    const node = h('div', { class: 'ev' + (meta.sev ? ' sev-' + meta.sev : ''), onclick: () => seek(tl.toVirt(e.ts)) }, [
      h('span', { class: 't' }, fmtOffset(e.ts - session.started_at)),
      h('span', { class: 'd' }, [h('b', {}, meta.label), detailText ? ' ' + String(detailText).slice(0, 80) : ''])
    ]);
    evNodes.set(i, { node, ts: e.ts });
    evList.appendChild(node);
  });

  const scrubFill = h('div', { class: 'fill' });
  const scrub = h('div', { class: 'scrub' }, [h('div', { class: 'track' }), scrubFill]);
  visible.forEach((e) => {
    const meta = EV_META[e.type] || {};
    if (!meta.sev || meta.sev === 'info') return;
    const mk = h('div', { class: 'mk ' + meta.sev });
    mk.style.left = (tl.toVirt(e.ts) / tl.total) * 100 + '%';
    mk.title = meta.label;
    scrub.appendChild(mk);
  });
  scrub.addEventListener('click', (ev) => {
    const r = scrub.getBoundingClientRect();
    seek(((ev.clientX - r.left) / r.width) * tl.total);
  });

  const btnPlay = h('button', { class: 'primary', onclick: toggle }, '▶');
  const btnSpeed = h('button', { onclick: () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; btnSpeed.textContent = speed + '×'; } }, '1×');
  const timeLabel = h('span', { class: 'mono' }, '0:00');
  const controls = h('div', { class: 'controls' }, [
    btnPlay, btnSpeed, scrub, timeLabel,
    onClose ? h('button', { class: 'ghost', onclick: onClose }, '✕ закрити') : null
  ]);

  const meta = h('div', { class: 'meta' }, [
    h('div', {}, [h('b', {}, session.converted ? 'Купив' : 'Не купив'), ` · ${session.device} · ${session.browser}`]),
    h('div', {}, `Канал: ${session.source} / ${session.medium}`),
    h('div', {}, `Тривалість: ${dur(session.duration)} · сторінок ${session.pageviews}`),
    h('div', {}, `Фрикшн: ${session.friction}/100 · глибина скролу ${session.max_depth}%`),
    h('div', {}, `Дійшов до: ${session.max_step_id || '—'}`),
    session.last_field ? h('div', {}, `Останнє поле: ${session.last_field}`) : null,
    h('div', { class: 'mono' }, session.id)
  ]);

  host.appendChild(h('div', { class: 'replay-wrap' }, [
    h('div', {}, [stage, controls]),
    h('div', { class: 'replay-side' }, [meta, evList])
  ]));
  fit();
  addEventListener('resize', fit);

  function fmtOffset(ms) {
    const t = Math.max(0, Math.round(ms / 1000));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }
  function interp(arr, real, key) {
    if (!arr.length) return 0;
    if (real <= arr[0].ts) return arr[0][key];
    for (let i = 1; i < arr.length; i++) {
      if (real <= arr[i].ts) {
        const a = arr[i - 1], b = arr[i];
        const k = (real - a.ts) / Math.max(1, b.ts - a.ts);
        return a[key] + k * (b[key] - a[key]);
      }
    }
    return arr[arr.length - 1][key];
  }

  let shownClicks = new Set();
  function frame(real) {
    const si = segIndex(real);
    ensurePage(segments[si].path);
    const sc = scrollSeg[si];
    const scrollY = sc.length ? interp(sc, real, 'y') : 0;
    if (pageEl) pageEl.style.transform = `translateY(${-scrollY}px)`;
    const cu = cursorSeg[si];
    if (cu.length) {
      cursorEl.style.display = '';
      const cx = interp(cu, real, 'x'), cy = interp(cu, real, 'y');
      cursorEl.style.transform = `translate(${cx}px, ${cy - scrollY}px)`;
    } else {
      cursorEl.style.display = 'none';
    }
    clicks.forEach((c, i) => {
      if (shownClicks.has(i)) return;
      if (real >= c.ts && real - c.ts < 450) {
        shownClicks.add(i);
        const ring = h('div', { class: 'click-ring' + (c.type === 'rage_click' ? ' rage' : c.type === 'dead_click' ? ' dead' : '') });
        ring.style.left = c.x + 'px';
        ring.style.top = (c.y - scrollY) + 'px';
        viewport.appendChild(ring);
        setTimeout(() => ring.remove(), 760);
      }
    });
    let activeIdx = -1;
    evNodes.forEach((v, i) => { if (v.ts <= real) activeIdx = i; });
    evNodes.forEach((v, i) => v.node.classList.toggle('active', i === activeIdx));
    if (activeIdx >= 0 && playing) {
      const n = evNodes.get(activeIdx).node;
      const r = n.getBoundingClientRect(), pr = evList.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) n.scrollIntoView({ block: 'nearest' });
    }
    scrubFill.style.width = (virt / tl.total) * 100 + '%';
    timeLabel.textContent = fmtOffset(real - session.started_at);
  }
  function seek(v) {
    virt = Math.max(0, Math.min(tl.total, v));
    shownClicks = new Set(clicks.map((c, i) => (tl.toReal(virt) >= c.ts ? i : -1)).filter((i) => i >= 0));
    frame(tl.toReal(virt));
  }
  function loop(now) {
    if (!playing) return;
    const dt = lastFrame ? now - lastFrame : 16;
    lastFrame = now;
    virt += dt * speed;
    if (virt >= tl.total) { virt = tl.total; playing = false; btnPlay.textContent = '▶'; }
    frame(tl.toReal(virt));
    if (playing) raf = requestAnimationFrame(loop);
  }
  function toggle() {
    playing = !playing;
    btnPlay.textContent = playing ? '❚❚' : '▶';
    lastFrame = 0;
    if (playing) { if (virt >= tl.total) virt = 0; raf = requestAnimationFrame(loop); }
    else cancelAnimationFrame(raf);
  }
  seek(0);
  return { destroy() { playing = false; cancelAnimationFrame(raf); removeEventListener('resize', fit); } };
}

const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export function renderHeatmap(host, data, mode = 'all') {
  host.innerHTML = '';
  const snap = data.snapshot;
  if (!snap) { host.appendChild(h('div', { class: 'empty' }, 'Для цієї сторінки ще немає знімка верстки')); return; }
  const W = snap.w || 1280, H = Math.min(snap.h || 2000, 6000);
  const inner = h('div', { class: 'heat-inner' });
  inner.style.width = W + 'px';
  inner.style.height = H + 'px';
  const page = buildPage(snap, { interactive: true });
  page.style.position = 'absolute';
  page.style.inset = '0';
  inner.appendChild(page);

  const canvas = h('canvas', { class: 'heat-canvas' });
  canvas.width = W; canvas.height = H;
  inner.appendChild(canvas);
  const stage = h('div', { class: 'heat-stage' }, inner);
  host.appendChild(stage);

  const k = Math.min((stage.clientWidth - 24) / W, 1);
  inner.style.transform = `scale(${k})`;
  stage.style.height = Math.min(H * k + 20, 640) + 'px';

  const pts = data.clicks.filter((c) => {
    if (mode === 'rage') return c.type === 'rage_click';
    if (mode === 'dead') return c.type === 'dead_click';
    if (mode === 'lost') return !c.converted;
    return true;
  }).filter((c) => c.y != null && c.y <= H);

  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const radius = Math.max(26, Math.round(W / 28));
  for (const c of pts) {
    const g = octx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g;
    octx.beginPath();
    octx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    octx.fill();
  }
  const img = octx.getImageData(0, 0, W, H);
  const px = img.data;
  const rgb = RAMP.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (!a) continue;
    const t = Math.min(1, a / 200);
    const idx = Math.min(rgb.length - 1, Math.floor(t * rgb.length));
    px[i] = rgb[idx][0]; px[i + 1] = rgb[idx][1]; px[i + 2] = rgb[idx][2];
    px[i + 3] = Math.min(190, 45 + a * 1.35);
  }
  const ctx = canvas.getContext('2d');
  ctx.putImageData(img, 0, 0);

  ctx.lineWidth = 2;
  data.clicks.filter((c) => c.type === 'rage_click').forEach((c) => {
    ctx.strokeStyle = '#d03b3b';
    ctx.beginPath(); ctx.arc(c.x, c.y, 16, 0, Math.PI * 2); ctx.stroke();
  });
  data.clicks.filter((c) => c.type === 'dead_click').forEach((c) => {
    ctx.strokeStyle = '#fab219';
    ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI * 2); ctx.stroke();
  });

  const counts = new Map();
  data.clicks.forEach((c) => {
    if (!c.sel) return;
    const e = counts.get(c.sel) || { sel: c.sel, label: c.label, all: 0, rage: 0, dead: 0 };
    e.all++;
    if (c.type === 'rage_click') e.rage++;
    if (c.type === 'dead_click') e.dead++;
    counts.set(c.sel, e);
  });
  const top = [...counts.values()].sort((a, b) => b.all - a.all).slice(0, 12);
  if (top.length) {
    host.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, [
      h('div', { class: 'card-head' }, [h('h2', {}, 'Куди клікають на цій сторінці'), h('p', {}, `${nf(pts.length)} кліків у вибірці`)]),
      h('table', {}, [
        h('thead', {}, h('tr', {}, [h('th', {}, 'Елемент'), h('th', {}, 'Селектор'), h('th', { class: 'num' }, 'Кліків'), h('th', { class: 'num' }, 'Rage'), h('th', { class: 'num' }, 'Мертвих')])),
        h('tbody', {}, top.map((t) => h('tr', {}, [
          h('td', {}, (t.label || '—').slice(0, 40)),
          h('td', { class: 'mono trunc' }, t.sel),
          h('td', { class: 'num' }, nf(t.all)),
          h('td', { class: 'num' }, t.rage ? h('span', { class: 'pill critical' }, String(t.rage)) : '—'),
          h('td', { class: 'num' }, t.dead ? h('span', { class: 'pill warning' }, String(t.dead)) : '—')
        ])))
      ])
    ]));
  }
}
