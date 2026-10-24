import { parseUa, parseSource, hashIp, packSnapshot } from './db.js';

// Turns one batch from the tracker into rows. Every row carries cfg.siteId, so one database
// holds any number of sites without them ever seeing each other's data.

const FRICTION_WEIGHTS = {
  rage: 20, dead: 9, js_errors: 15, net_errors: 17, validation_errors: 6,
  slow_inter: 5, zooms: 4, hscroll: 7, backtracks: 5, thrash: 8, exit_intents: 3
};

function stepMatch(step, { path, eventName }) {
  const m = step.match || {};
  if (m.any) return true;
  if (m.event && eventName && m.event === eventName) return true;
  if (m.path && path && new RegExp(m.path, 'i').test(path)) return true;
  return false;
}

export function resolveStep(funnel, path, eventName) {
  let best = -1, id = null;
  funnel.forEach((s, i) => {
    if (stepMatch(s, { path, eventName }) && i > best) { best = i; id = s.id; }
  });
  return { index: best, id };
}

export async function ingestBatch(db, cfg, env, meta) {
  const items = Array.isArray(env.items) ? env.items : [];
  if (!env.sid || !items.length) return { ok: false, reason: 'empty' };

  const ua = env.ua || meta.ua || '';
  const { browser, os, isBot } = parseUa(ua);
  const now = Date.now();
  const existing = await db.prepare('SELECT id, started_at, is_bot FROM sessions WHERE id = ?').get(env.sid);
  const writes = [];

  if (!existing) {
    const src = parseSource(env.ref || '', (env.href || '').split('?')[1] ? '?' + env.href.split('?')[1] : '');
    writes.push({ sql: `INSERT OR IGNORE INTO sessions
      (id, site_id, visitor_id, started_at, last_at, entry_path, exit_path, referrer, source, medium, campaign,
       device, browser, os, vw, vh, touch, country, lang, ip_hash, is_bot, currency, ip, city, region)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [
      env.sid, cfg.siteId || '', env.vid || '', env.startedAt || now, now,
      (env.path || '').slice(0, 300), (env.path || '').slice(0, 300), (env.ref || '').slice(0, 300),
      src.source, src.medium, src.campaign, env.dev || 'desktop', browser, os,
      env.vw || 0, env.vh || 0, env.touch ? 1 : 0,
      meta.country || '', (env.lang || '').slice(0, 12), hashIp(meta.ip || ''), isBot,
      cfg.currency || '',
      (meta.ip || '').slice(0, 64), (meta.city || '').slice(0, 80), (meta.region || '').slice(0, 20)
    ] });
  }

  const EV_SQL = 'INSERT INTO events (session_id, site_id, ts, seq, type, path, sel, label, name, num, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
  const SNAP_SQL = 'INSERT INTO snapshots (session_id, site_id, ts, path, device, w, h, vw, vh, data) VALUES (?,?,?,?,?,?,?,?,?,?)';
  const site = cfg.siteId || '';

  let snapshots = 0;
  for (const it of items) {
    const d = it.d || {};
    if (it.t === 'snapshot') {
      if (snapshots >= 6 || !Array.isArray(d.els)) continue;
      snapshots++;
      writes.push({ sql: SNAP_SQL, args: [env.sid, site, it.ts || now, (it.p || '').slice(0, 300), env.dev || 'desktop',
        d.w || 0, d.h || 0, env.vw || 0, env.vh || 0, packSnapshot({ els: d.els, w: d.w, h: d.h })] });
      continue;
    }
    const name = d.name || d.metric || d.answer || d.key || d.msg || null;
    const num = d.value != null ? Number(d.value)
      : d.ms != null ? Number(d.ms)
      : d.depth != null ? Number(d.depth)
      : d.n != null ? Number(d.n) : null;
    writes.push({ sql: EV_SQL, args: [
      env.sid, site, it.ts || now, it.s || 0, it.t, (it.p || '').slice(0, 300),
      (d.sel || '').slice(0, 200) || null, (d.label || '').slice(0, 120) || null,
      name ? String(name).slice(0, 180) : null,
      Number.isFinite(num) ? num : null, JSON.stringify(d).slice(0, 4000)
    ] });
  }

  await db.batch(writes);
  await recomputeSession(db, cfg, env.sid);
  return { ok: true, events: items.length, snapshots };
}

export async function recomputeSession(db, cfg, sid) {
  const funnel = cfg.funnel || [];
  const rows = await db.prepare('SELECT ts, type, path, sel, label, name, num, data FROM events WHERE session_id = ? ORDER BY ts, seq').all(sid);
  if (!rows.length) return;

  const c = {
    rage: 0, dead: 0, js_errors: 0, net_errors: 0, validation_errors: 0, slow_inter: 0,
    zooms: 0, hscroll: 0, backtracks: 0, exit_intents: 0, thrash: 0, pageviews: 0
  };
  let maxStep = 0, maxStepId = funnel[0]?.id || null, converted = 0, revenue = 0;
  let maxDepth = 0, ctaSeen = 0, ctaClicked = 0, lastField = '', abandonPath = '';
  let lcp = null, cls = null, inp = null, ttfb = null, identity = null, hasReplay = 0;
  const first = rows[0].ts, last = rows[rows.length - 1].ts;
  const paths = new Set();

  for (const r of rows) {
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch {}
    switch (r.type) {
      case 'pageview': {
        c.pageviews++;
        paths.add(r.path);
        const st = resolveStep(funnel, r.path, null);
        if (st.index > maxStep) { maxStep = st.index; maxStepId = st.id; }
        break;
      }
      case 'rage_click': c.rage++; break;
      case 'dead_click': c.dead++; break;
      case 'js_error': c.js_errors++; break;
      case 'net_error': c.net_errors++; break;
      case 'validation_error': c.validation_errors++; break;
      case 'slow_interaction': c.slow_inter++; break;
      case 'zoom': c.zooms++; break;
      case 'hscroll': c.hscroll++; break;
      case 'back_nav': c.backtracks++; break;
      case 'exit_intent': c.exit_intents++; break;
      case 'element_seen': if (d.kind === 'cta') ctaSeen = 1; break;
      case 'mouse': hasReplay = 1; break;
      case 'click': if (d.inter && /cart|checkout|buy|order|купит|купив|корзин|кошик|замов/i.test(d.label || '')) ctaClicked = 1; break;
      case 'scroll': if (d.depth > maxDepth) maxDepth = d.depth; break;
      case 'page_leave':
        if (d.depth > maxDepth) maxDepth = d.depth;
        if (d.dirChanges > 7) c.thrash++;
        if (d.lastField) { lastField = String(d.lastField).slice(0, 60); abandonPath = r.path; }
        break;
      case 'identify': identity = String(d.id || '').slice(0, 64); break;
      case 'perf':
        if (d.metric === 'lcp') lcp = d.value;
        if (d.metric === 'cls') cls = d.value;
        if (d.metric === 'inp') inp = d.value;
        if (d.metric === 'ttfb') ttfb = d.value;
        break;
      case 'custom':
      case 'goal': {
        const st = resolveStep(funnel, r.path, d.name);
        if (st.index > maxStep) { maxStep = st.index; maxStepId = st.id; }
        if (d.name === 'purchase' || r.type === 'goal' && d.name === 'purchase') {
          converted = 1;
          revenue = Number((d.props && d.props.value) || d.value || 0) || 0;
        }
        break;
      }
    }
  }

  let friction = 0;
  for (const k in FRICTION_WEIGHTS) friction += Math.min(c[k] || 0, 5) * FRICTION_WEIGHTS[k];
  if (lcp && lcp > 4000) friction += 8;
  if (inp && inp > 500) friction += 6;
  if (cls && cls > 0.25) friction += 6;
  friction = Math.min(100, Math.round(friction));

  const exitPath = [...rows].reverse().find((r) => r.path)?.path || '';
  await db.prepare(`UPDATE sessions SET
      last_at = ?, duration = ?, pageviews = ?, event_count = ?, exit_path = ?,
      max_step = ?, max_step_id = ?, converted = ?, revenue = ?,
      rage = ?, dead = ?, js_errors = ?, net_errors = ?, validation_errors = ?, slow_inter = ?,
      zooms = ?, hscroll = ?, backtracks = ?, exit_intents = ?, thrash = ?,
      lcp = ?, cls = ?, inp = ?, ttfb = ?, max_depth = ?, cta_seen = ?, cta_clicked = ?,
      last_field = ?, abandon_path = ?, friction = ?, identity = COALESCE(?, identity), has_replay = ?
    WHERE id = ?`).run(
    last, Math.max(0, last - first), c.pageviews, rows.length, exitPath.slice(0, 300),
    maxStep, maxStepId, converted, revenue,
    c.rage, c.dead, c.js_errors, c.net_errors, c.validation_errors, c.slow_inter,
    c.zooms, c.hscroll, c.backtracks, c.exit_intents, c.thrash,
    lcp, cls, inp, ttfb, maxDepth, ctaSeen, ctaClicked,
    lastField, abandonPath.slice(0, 300), friction, identity, hasReplay, sid
  );
}
