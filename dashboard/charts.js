const NS = 'http://www.w3.org/2000/svg';
const tip = () => document.getElementById('tip');

export function s(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  // Numbers are as valid a child as strings here; anything that is not a node becomes text,
  // so one forgotten String() cannot take a whole tab down.
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c == null || c === false || c === '') return;
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return n;
}
export function h(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  // Numbers are as valid a child as strings here; anything that is not a node becomes text,
  // so one forgotten String() cannot take a whole tab down.
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c == null || c === false || c === '') return;
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return n;
}

export const nf = (n) => new Intl.NumberFormat('uk-UA').format(Math.round(n || 0));
export const money = (n, cur) => nf(n) + (cur ? ' ' + cur : '');
export const dur = (ms) => {
  const t = Math.round((ms || 0) / 1000);
  return t < 60 ? t + ' с' : Math.floor(t / 60) + ' хв ' + (t % 60) + ' с';
};

export function showTip(ev, html) {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = '1';
  const pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  const r = t.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}
export function hideTip() { tip().style.opacity = '0'; }

function roundRight(x, y, w, hh, r) {
  const rr = Math.min(r, w, hh / 2);
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + hh - rr} Q${x + w},${y + hh} ${x + w - rr},${y + hh} H${x} Z`;
}

export function funnelChart(steps, total) {
  const rowH = 46, left = 160, right = 96, W = 820;
  const H = steps.length * rowH + 16;
  const barW = W - left - right;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  const max = Math.max(total, 1);

  steps.forEach((st, i) => {
    const y = i * rowH + 10;
    const w = Math.max(2, (st.reached / max) * barW);
    const lostW = Math.max(0, (st.dropped / max) * barW);
    const keptW = Math.max(2, w - lostW);
    const color = `var(--ord-${Math.min(7, i + 1)})`;

    svg.appendChild(s('text', { x: left - 12, y: y + 22, 'text-anchor': 'end' }, st.name));
    const kept = s('path', { d: roundRight(left, y + 6, keptW, 26, 4), fill: color, class: 'mark' });
    svg.appendChild(kept);
    if (lostW > 3) {
      const lost = s('path', { d: roundRight(left + keptW + 2, y + 6, Math.max(2, lostW - 2), 26, 4), fill: 'var(--surface-3)', stroke: 'var(--border)', class: 'mark' });
      lost.addEventListener('mousemove', (e) => showTip(e, `<b>${nf(st.dropped)}</b> сесій зупинились на «${st.name}»<br>${st.dropRate}% тих, хто дійшов`));
      lost.addEventListener('mouseleave', hideTip);
      svg.appendChild(lost);
    }
    kept.addEventListener('mousemove', (e) => showTip(e,
      `<b>${st.name}</b><br>Дійшли: <b>${nf(st.reached)}</b> (${st.shareOfTotal}%)<br>Фактично на кроці: <b>${nf(st.hit)}</b><br>Пішли далі: <b>${st.conversionToNext}%</b>`));
    kept.addEventListener('mouseleave', hideTip);

    svg.appendChild(s('text', { x: W - right + 8, y: y + 24, class: 'value-label' }, nf(st.reached)));
    svg.appendChild(s('text', { x: W - right + 8, y: y + 38, 'font-size': '10.5' }, st.shareOfTotal + '%'));
    if (st.dropped > 0 && i > 0) {
      svg.appendChild(s('text', { x: left + keptW + 10, y: y + 24, 'font-size': '11' }, `−${nf(st.dropped)} (${st.dropRate}%)`));
    }
  });
  return svg;
}

export function lineChart(data, { xKey, yKey, label, fmt = nf, height = 170, color = 'var(--series-1)' }) {
  const W = 820, H = height, m = { t: 14, r: 16, b: 26, l: 46 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  if (!data.length) return svg;
  const xs = (i) => m.l + (i / Math.max(1, data.length - 1)) * (W - m.l - m.r);
  const maxY = Math.max(...data.map((d) => +d[yKey] || 0), 1) * 1.15;
  const ys = (v) => H - m.b - ((+v || 0) / maxY) * (H - m.t - m.b);

  [0, 0.5, 1].forEach((p) => {
    const y = ys(maxY * p);
    svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid-line' }));
    svg.appendChild(s('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': '10.5' }, fmt(maxY * p)));
  });

  const d = data.map((pt, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(pt[yKey]).toFixed(1)}`).join(' ');
  svg.appendChild(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  data.forEach((pt, i) => {
    if (data.length < 40 || i % Math.ceil(data.length / 40) === 0) {
      const c = s('circle', { cx: xs(i), cy: ys(pt[yKey]), r: 9, fill: 'transparent', class: 'mark' });
      c.addEventListener('mousemove', (e) => showTip(e, `<b>${pt[xKey]}</b><br>${label}: <b>${fmt(pt[yKey])}</b>`));
      c.addEventListener('mouseleave', hideTip);
      svg.appendChild(c);
      svg.appendChild(s('circle', { cx: xs(i), cy: ys(pt[yKey]), r: 2.6, fill: color }));
    }
  });

  const ticks = Math.min(6, data.length);
  for (let i = 0; i < ticks; i++) {
    const idx = Math.round((i / Math.max(1, ticks - 1)) * (data.length - 1));
    svg.appendChild(s('text', { x: xs(idx), y: H - 8, 'text-anchor': 'middle', 'font-size': '10.5' }, String(data[idx][xKey]).slice(5)));
  }
  return svg;
}

export function compareBars(features, { labelA = 'Не купили', labelB = 'Купили' } = {}) {
  const rowH = 42, left = 250, W = 820, H = features.length * rowH + 14;
  const barW = W - left - 110;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  const max = Math.max(...features.flatMap((f) => [f.nonConverters, f.converters]), 1);

  features.forEach((f, i) => {
    const y = i * rowH + 8;
    svg.appendChild(s('text', { x: left - 12, y: y + 20, 'text-anchor': 'end' }, f.label.length > 34 ? f.label.slice(0, 33) + '…' : f.label));
    const wA = Math.max(1.5, (f.nonConverters / max) * barW);
    const wB = Math.max(1.5, (f.converters / max) * barW);
    const a = s('path', { d: roundRight(left, y + 2, wA, 13, 4), fill: 'var(--series-2)', class: 'mark' });
    const b = s('path', { d: roundRight(left, y + 17, wB, 13, 4), fill: 'var(--series-1)', class: 'mark' });
    [[a, labelA, f.nonConverters], [b, labelB, f.converters]].forEach(([node, lbl, val]) => {
      node.addEventListener('mousemove', (e) => showTip(e, `<b>${f.label}</b><br>${lbl}: <b>${val}%</b> сесій`));
      node.addEventListener('mouseleave', hideTip);
      svg.appendChild(node);
    });
    svg.appendChild(s('text', { x: left + Math.max(wA, wB) + 10, y: y + 20, class: 'value-label' }, `${f.nonConverters}% / ${f.converters}%`));
  });
  return svg;
}

export function barChart(items, { labelKey, valueKey, fmt = nf, color = 'var(--series-1)', note }) {
  const rowH = 34, left = 190, W = 820, H = items.length * rowH + 14;
  const barW = W - left - 110;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  const max = Math.max(...items.map((x) => +x[valueKey] || 0), 1);
  items.forEach((it, i) => {
    const y = i * rowH + 8;
    svg.appendChild(s('text', { x: left - 12, y: y + 18, 'text-anchor': 'end' }, String(it[labelKey]).slice(0, 30)));
    const w = Math.max(2, ((+it[valueKey] || 0) / max) * barW);
    const bar = s('path', { d: roundRight(left, y + 4, w, 18, 4), fill: color, class: 'mark' });
    bar.addEventListener('mousemove', (e) => showTip(e, `<b>${it[labelKey]}</b><br>${fmt(it[valueKey])}${note ? '<br>' + note(it) : ''}`));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    svg.appendChild(s('text', { x: left + w + 10, y: y + 18, class: 'value-label' }, fmt(it[valueKey])));
  });
  return svg;
}

export function depthCurve(depth, height = 160) {
  const W = 820, H = height, m = { t: 12, r: 14, b: 24, l: 44 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  const buckets = new Array(11).fill(0);
  depth.forEach((d) => { const b = Math.min(10, Math.max(0, Math.round((d.d || 0) / 10))); buckets[b] += d.n; });
  const totalTop = buckets.reduce((a, b) => a + b, 0) || 1;
  let acc = totalTop;
  const pts = buckets.map((v, i) => { const share = (acc / totalTop) * 100; acc -= v; return { x: i * 10, share }; });
  const xs = (v) => m.l + (v / 100) * (W - m.l - m.r);
  const ys = (v) => H - m.b - (v / 100) * (H - m.t - m.b);
  [0, 50, 100].forEach((p) => {
    svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: ys(p), y2: ys(p), class: 'grid-line' }));
    svg.appendChild(s('text', { x: m.l - 8, y: ys(p) + 4, 'text-anchor': 'end', 'font-size': '10.5' }, p + '%'));
  });
  svg.appendChild(s('path', {
    d: pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x)},${ys(p.share)}`).join(' ') + `L${xs(100)},${ys(0)} L${xs(0)},${ys(0)} Z`,
    fill: 'color-mix(in srgb, var(--series-1) 14%, transparent)'
  }));
  svg.appendChild(s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x)},${ys(p.share)}`).join(' '), fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2 }));
  pts.forEach((p) => {
    const c = s('circle', { cx: xs(p.x), cy: ys(p.share), r: 9, fill: 'transparent', class: 'mark' });
    c.addEventListener('mousemove', (e) => showTip(e, `До ${p.x}% сторінки долистали <b>${Math.round(p.share)}%</b> сесій`));
    c.addEventListener('mouseleave', hideTip);
    svg.appendChild(c);
  });
  [0, 25, 50, 75, 100].forEach((p) => svg.appendChild(s('text', { x: xs(p), y: H - 7, 'text-anchor': 'middle', 'font-size': '10.5' }, p + '%')));
  return svg;
}
