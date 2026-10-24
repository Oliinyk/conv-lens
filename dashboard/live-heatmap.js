// Click map drawn over the real page (/?replay=1 in an iframe, full height, house fully built).
// Each click is re-anchored to the element it hit: same selector, same relative position inside it,
// so clicks from different screen widths and from the sticky 3D viewer land where they belong.
import { h, nf } from './charts.js';

const CSS = `
.hm-wrap { position:relative; overflow:auto; max-height:78vh; background:var(--surface-3); border-radius:12px; }
.hm-box { position:relative; margin:16px auto; transform-origin:0 0; box-shadow:0 1px 2px rgba(0,0,0,.12), 0 18px 50px -12px rgba(0,0,0,.35); border-radius:8px; overflow:hidden; background:#fff; }
.hm-box iframe { display:block; border:0; pointer-events:none; }
.hm-box canvas { position:absolute; left:0; top:0; pointer-events:none; }
.hm-loading { padding:80px 0; text-align:center; color:var(--text-2); font-size:13px; }
.hm-legend { display:flex; gap:16px; flex-wrap:wrap; align-items:center; font-size:12.5px; color:var(--text-2); padding:10px 4px 0; }
.hm-legend i { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; vertical-align:-1px; }
`;
const RAMP = [[0, [42, 120, 214]], [0.35, [27, 175, 122]], [0.6, [250, 178, 25]], [0.8, [235, 104, 52]], [1, [208, 59, 59]]];
function rampColor(t) {
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export function renderLiveHeatmap(host, data, { mode = 'all', single = false } = {}) {
  if (!document.getElementById('hm-css')) { const s = document.createElement('style'); s.id = 'hm-css'; s.textContent = CSS; document.head.appendChild(s); }
  host.innerHTML = '';
  const all = data.clicks || [];
  if (!all.length) { host.appendChild(h('div', { class: 'empty' }, single ? 'У цій сесії не було кліків' : 'Кліків за цей період ще немає')); return; }

  // Render at the most common visitor width, so the layout matches what most people saw.
  const widths = new Map();
  all.forEach((c) => { const w = Math.round((c.vw || 1440) / 10) * 10; widths.set(w, (widths.get(w) || 0) + 1); });
  const W = [...widths.entries()].sort((a, b) => b[1] - a[1])[0][0] || 1440;

  const clicks = all.filter((c) => c.type === 'click' && (mode === 'all' || (mode === 'lost' && !c.converted)));
  const rage = all.filter((c) => c.type === 'rage_click');
  const dead = all.filter((c) => c.type === 'dead_click');
  const shown = mode === 'rage' ? [] : mode === 'dead' ? [] : clicks;

  const wrap = h('div', { class: 'hm-wrap' });
  const loading = h('div', { class: 'hm-loading' }, 'Завантажуємо сторінку…');
  const iframe = h('iframe', { title: 'Сторінка для карти кліків', scrolling: 'no', tabindex: '-1' });
  iframe.style.width = W + 'px'; iframe.style.height = '900px';
  const canvas = h('canvas');
  const box = h('div', { class: 'hm-box' }, [iframe, canvas]);
  box.style.width = W + 'px';
  box.style.visibility = 'hidden';
  wrap.append(loading, box);
  host.appendChild(wrap);
  host.appendChild(h('div', { class: 'hm-legend' }, [
    h('span', {}, [h('i', { style: 'background:linear-gradient(90deg,#2a78d6,#1baf7a,#fab219,#d03b3b);width:42px;border-radius:5px' }), 'щільність кліків']),
    h('span', {}, [h('i', { style: 'border:2px solid #d03b3b' }), 'rage-кліки']),
    h('span', {}, [h('i', { style: 'border:2px solid #fab219' }), 'кліки без реакції']),
    h('span', { style: 'margin-left:auto' }, `Ширина сторінки ${W}px · ${nf(clicks.length)} кліків`)
  ]));

  let k = 1, H = 900;
  function fit() {
    k = Math.min(1, (wrap.clientWidth - 32) / W);
    box.style.transform = `scale(${k})`;
    box.style.marginLeft = Math.max(16, (wrap.clientWidth - W * k) / 2) + 'px';
    box.style.marginBottom = (16 - H * (1 - k)) + 'px';
  }
  const ro = new ResizeObserver(fit); ro.observe(wrap);

  iframe.src = '/?replay=1&heatmap=1';
  const timer = setInterval(() => {
    let w, doc;
    try { w = iframe.contentWindow; doc = iframe.contentDocument; } catch { return; }
    if (!w || !w.__replay || !w.__replay.ready || !doc) return;
    clearInterval(timer);
    if (w.__replay.forceBuilt) w.__replay.forceBuilt();
    setTimeout(() => draw(w, doc), 400);
  }, 150);

  function place(c, doc) {
    let el = null;
    if (c.sel) { try { el = doc.querySelector(c.sel.replace(/:has-text\([^)]*\)/g, '')); } catch { el = null; } }
    if (el && c.ew > 0 && c.eh > 0) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left + ((c.x - c.ex) / c.ew) * r.width, y: r.top + ((c.y - c.ey) / c.eh) * r.height };
      }
    }
    const sx = W / (c.vw || W);
    return { x: c.x * sx, y: c.y };
  }

  function draw(w, doc) {
    H = Math.min(12000, Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight));
    iframe.style.height = H + 'px';
    box.style.height = H + 'px';
    // Let the page lay out at full height before reading element positions.
    setTimeout(() => {
      canvas.width = W; canvas.height = H;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const o = off.getContext('2d');
      const R = single ? 22 : Math.max(22, Math.round(W / 50));
      const pts = shown.map((c) => place(c, doc));
      for (const p of pts) {
        const g = o.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        o.fillStyle = g; o.beginPath(); o.arc(p.x, p.y, R, 0, Math.PI * 2); o.fill();
      }
      const img = o.getImageData(0, 0, W, H), px = img.data;
      let max = 1; for (let i = 3; i < px.length; i += 4) if (px[i] > max) max = px[i];
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3]; if (!a) continue;
        const t = Math.min(1, a / max), c = rampColor(t);
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round(70 + 150 * t);
      }
      ctx.putImageData(img, 0, 0);
      // individual clicks as small dots so a single session stays readable
      if (single || pts.length < 300) {
        ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = 'rgba(11,11,11,.85)'; ctx.lineWidth = 1.5;
        pts.forEach((p, i) => {
          ctx.beginPath(); ctx.arc(p.x, p.y, single ? 6 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (single) { ctx.fillStyle = '#111'; ctx.font = '600 10px system-ui'; ctx.fillText(String(i + 1), p.x + 8, p.y - 6); ctx.fillStyle = 'rgba(255,255,255,.95)'; }
        });
      }
      ctx.lineWidth = 3;
      if (mode !== 'dead') rage.forEach((c) => { const p = place(c, doc); ctx.strokeStyle = '#d03b3b'; ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.stroke(); });
      if (mode !== 'rage') dead.forEach((c) => { const p = place(c, doc); ctx.strokeStyle = '#fab219'; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke(); });
      loading.remove();
      box.style.visibility = '';
      fit();
      // scroll the map to the area with the most clicks
      if (pts.length) {
        const ys = pts.map((p) => p.y).sort((a, b) => a - b);
        wrap.scrollTop = Math.max(0, ys[Math.floor(ys.length / 2)] * k - wrap.clientHeight / 2);
      }
    }, 350);
  }

  // table of elements
  const counts = new Map();
  all.forEach((c) => {
    if (!c.sel) return;
    const e = counts.get(c.sel) || { sel: c.sel, label: c.label, all: 0, rage: 0, dead: 0 };
    if (c.type === 'click') e.all++;
    if (c.type === 'rage_click') e.rage++;
    if (c.type === 'dead_click') e.dead++;
    if (!e.label && c.label) e.label = c.label;
    counts.set(c.sel, e);
  });
  const top = [...counts.values()].sort((a, b) => b.all - a.all).slice(0, 15);
  const pretty = (l) => (/^3D model/i.test(l || '') ? '3D-модель' : (l || '—').slice(0, 44));
  host.appendChild(h('div', { class: 'card', style: 'margin-top:14px' }, [
    h('div', { class: 'card-head' }, [h('h2', {}, single ? 'Куди клікав цей відвідувач' : 'Куди клікають на цій сторінці'), h('p', {}, `${nf(clicks.length)} кліків`)]),
    h('table', {}, [
      h('thead', {}, h('tr', {}, [h('th', {}, 'Елемент'), h('th', {}, 'Селектор'), h('th', { class: 'num' }, 'Кліків'), h('th', { class: 'num' }, 'Rage'), h('th', { class: 'num' }, 'Без реакції')])),
      h('tbody', {}, top.map((t) => h('tr', {}, [
        h('td', {}, pretty(t.label)),
        h('td', { class: 'mono trunc' }, t.sel),
        h('td', { class: 'num' }, nf(t.all)),
        h('td', { class: 'num' }, t.rage ? h('span', { class: 'pill critical' }, String(t.rage)) : '—'),
        h('td', { class: 'num' }, t.dead ? h('span', { class: 'pill warning' }, String(t.dead)) : '—')
      ])))
    ])
  ]));
  return { destroy() { clearInterval(timer); ro.disconnect(); iframe.src = 'about:blank'; } };
}
