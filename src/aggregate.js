import { unpackSnapshot } from './db.js';

// Every query is scoped to one site through buildFilter, so the dashboard of one site
// can never read another's sessions.

export function buildFilter(q = {}) {
  const where = ['s.is_bot = 0'];
  const args = [];
  if (q.siteId) { where.push('s.site_id = ?'); args.push(q.siteId); }
  const to = q.to ? Number(q.to) : Date.now();
  const from = q.from ? Number(q.from) : to - 14 * 86400000;
  where.push('s.started_at BETWEEN ? AND ?');
  args.push(from, to);
  if (q.device) { where.push('s.device = ?'); args.push(q.device); }
  if (q.source) { where.push('s.source = ?'); args.push(q.source); }
  if (q.medium) { where.push('s.medium = ?'); args.push(q.medium); }
  if (q.browser) { where.push('s.browser = ?'); args.push(q.browser); }
  if (q.country) { where.push('s.country = ?'); args.push(q.country); }
  if (q.minStep) { where.push('s.max_step >= ?'); args.push(Number(q.minStep)); }
  return { sql: where.join(' AND '), args, from, to, siteId: q.siteId || '' };
}

const num = (v) => (Number.isFinite(v) ? v : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export async function overview(db, cfg, f) {
  const base = (await db.prepare(`SELECT
      COUNT(*) sessions, COUNT(DISTINCT s.visitor_id) visitors, COUNT(DISTINCT NULLIF(s.ip, '')) ips,
      SUM(s.converted) orders, SUM(s.revenue) revenue,
      AVG(s.duration) avg_duration, AVG(s.pageviews) avg_pageviews,
      AVG(s.friction) avg_friction, AVG(s.max_depth) avg_depth,
      SUM(CASE WHEN s.rage > 0 THEN 1 ELSE 0 END) with_rage,
      SUM(CASE WHEN s.dead > 0 THEN 1 ELSE 0 END) with_dead,
      SUM(CASE WHEN s.js_errors > 0 THEN 1 ELSE 0 END) with_js,
      SUM(CASE WHEN s.net_errors > 0 THEN 1 ELSE 0 END) with_net,
      SUM(CASE WHEN s.duration < 5000 AND s.pageviews <= 1 THEN 1 ELSE 0 END) bounced,
      SUM(CASE WHEN s.max_step >= 3 THEN 1 ELSE 0 END) reached_cart_intent
    FROM sessions s WHERE ${f.sql}`).get(...f.args));

  const daily = (await db.prepare(`SELECT
      strftime('%Y-%m-%d', s.started_at / 1000, 'unixepoch') day,
      COUNT(*) sessions, SUM(s.converted) orders, SUM(s.revenue) revenue, AVG(s.friction) friction
    FROM sessions s WHERE ${f.sql} GROUP BY day ORDER BY day`).all(...f.args));

  const aov = base.orders > 0 ? base.revenue / base.orders : num(cfg.avgOrderValue);
  return {
    sessions: base.sessions || 0,
    visitors: base.visitors || 0,
    ips: base.ips || 0,
    orders: base.orders || 0,
    revenue: Math.round(base.revenue || 0),
    cr: pct(base.orders, base.sessions),
    aov: Math.round(aov),
    avgDuration: Math.round((base.avg_duration || 0) / 1000),
    avgPageviews: Math.round((base.avg_pageviews || 0) * 10) / 10,
    avgFriction: Math.round(base.avg_friction || 0),
    avgDepth: Math.round(base.avg_depth || 0),
    bounceRate: pct(base.bounced, base.sessions),
    withRage: base.with_rage || 0,
    withDead: base.with_dead || 0,
    withJsError: base.with_js || 0,
    withNetError: base.with_net || 0,
    reachedCartIntent: base.reached_cart_intent || 0,
    daily: daily.map((d) => ({ ...d, cr: pct(d.orders, d.sessions), friction: Math.round(d.friction || 0) })),
    currency: cfg.currency || ''
  };
}

export async function funnel(db, cfg, f) {
  const steps = cfg.funnel || [];
  const rows = (await db.prepare(`SELECT s.max_step, COUNT(*) n FROM sessions s WHERE ${f.sql} GROUP BY s.max_step`).all(...f.args));
  const byStep = new Map(rows.map((r) => [r.max_step, r.n]));
  const total = rows.reduce((a, r) => a + r.n, 0);

  const hitStmt = db.prepare(`SELECT COUNT(DISTINCT e.session_id) n FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND (json_extract(e.data, '$.step') = ? OR (e.type IN ('custom','goal') AND e.name = ?))`);

  let remaining = total;
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const reached = remaining;
    const droppedHere = byStep.get(i) || 0;
    const isLast = i === steps.length - 1;
    const ev = (steps[i].match || {}).event || steps[i].id;
    const hit = i === 0 ? total : ((await hitStmt.get(...f.args, steps[i].id, ev)).n || 0);
    out.push({
      id: steps[i].id, name: steps[i].name, index: i,
      reached, hit, dropped: isLast ? 0 : droppedHere,
      shareOfTotal: pct(reached, total),
      hitShare: pct(hit, total),
      dropRate: isLast ? 0 : pct(droppedHere, reached),
      conversionToNext: isLast ? 100 : pct(reached - droppedHere, reached)
    });
    remaining = reached - droppedHere;
  }
  const worst = out.reduce((a, b) => (b.dropped > (a?.dropped || 0) ? b : a), null);
  return { total, steps: out, worstStep: worst ? worst.id : null };
}

export async function exitPaths(db, f, limit = 12) {
  return (await db.prepare(`SELECT s.exit_path path, COUNT(*) n,
      SUM(s.converted) orders, AVG(s.friction) friction, AVG(s.duration)/1000 dwell
    FROM sessions s WHERE ${f.sql} AND s.converted = 0 AND s.exit_path != ''
    GROUP BY s.exit_path ORDER BY n DESC LIMIT ?`).all(...f.args, limit))
    .map((r) => ({ ...r, friction: Math.round(r.friction || 0), dwell: Math.round(r.dwell || 0) }));
}

export async function sources(db, f) {
  return (await db.prepare(`SELECT s.source, s.medium, COUNT(*) sessions, SUM(s.converted) orders,
      SUM(s.revenue) revenue, AVG(s.friction) friction, AVG(s.duration)/1000 dwell,
      SUM(CASE WHEN s.duration < 5000 AND s.pageviews <= 1 THEN 1 ELSE 0 END) bounced
    FROM sessions s WHERE ${f.sql} GROUP BY s.source, s.medium
    HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 25`).all(...f.args))
    .map((r) => ({
      ...r, cr: pct(r.orders, r.sessions), bounceRate: pct(r.bounced, r.sessions),
      friction: Math.round(r.friction || 0), dwell: Math.round(r.dwell || 0),
      revenue: Math.round(r.revenue || 0)
    }));
}

export async function deviceBreakdown(db, f) {
  return (await db.prepare(`SELECT s.device, COUNT(*) sessions, SUM(s.converted) orders,
      AVG(s.friction) friction, AVG(s.lcp) lcp, AVG(s.inp) inp, AVG(s.cls) cls,
      SUM(CASE WHEN s.hscroll > 0 THEN 1 ELSE 0 END) hscroll,
      SUM(CASE WHEN s.zooms > 0 THEN 1 ELSE 0 END) zooms,
      SUM(CASE WHEN s.cta_seen = 0 AND s.max_step >= 2 THEN 1 ELSE 0 END) cta_unseen
    FROM sessions s WHERE ${f.sql} GROUP BY s.device ORDER BY sessions DESC`).all(...f.args))
    .map((r) => ({
      ...r, cr: pct(r.orders, r.sessions), friction: Math.round(r.friction || 0),
      lcp: Math.round(r.lcp || 0), inp: Math.round(r.inp || 0),
      cls: Math.round((r.cls || 0) * 1000) / 1000
    }));
}

export async function elementFriction(db, f, limit = 25) {
  return (await db.prepare(`SELECT e.sel, MAX(e.label) label, e.path,
      SUM(CASE WHEN e.type = 'rage_click' THEN 1 ELSE 0 END) rage,
      SUM(CASE WHEN e.type = 'dead_click' THEN 1 ELSE 0 END) dead,
      SUM(CASE WHEN e.type = 'click' THEN 1 ELSE 0 END) clicks,
      COUNT(DISTINCT e.session_id) sessions,
      COUNT(DISTINCT CASE WHEN s.converted = 0 THEN e.session_id END) lost_sessions
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type IN ('click','rage_click','dead_click') AND e.sel IS NOT NULL
    GROUP BY e.sel, e.path HAVING rage + dead > 0
    ORDER BY (rage * 3 + dead) DESC LIMIT ?`).all(...f.args, limit));
}

export async function formAnalytics(db, f, limit = 30) {
  const fields = (await db.prepare(`SELECT e.name AS field, MAX(e.label) label, e.path,
      COUNT(DISTINCT e.session_id) sessions,
      AVG(json_extract(e.data, '$.ms')) avg_ms,
      SUM(json_extract(e.data, '$.back')) backspaces,
      SUM(json_extract(e.data, '$.keys')) keys,
      SUM(CASE WHEN json_extract(e.data, '$.filled') = 0 THEN 1 ELSE 0 END) left_empty,
      COUNT(*) interactions
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'field_blur' AND e.name IS NOT NULL
    GROUP BY e.name, e.path ORDER BY sessions DESC LIMIT ?`).all(...f.args, limit));

  const errors = (await db.prepare(`SELECT e.name AS field, COUNT(*) errors, COUNT(DISTINCT e.session_id) sessions,
      MAX(json_extract(e.data, '$.msg')) sample
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'validation_error' GROUP BY e.name ORDER BY errors DESC`).all(...f.args));

  const abandons = (await db.prepare(`SELECT s.last_field field, COUNT(*) n
    FROM sessions s WHERE ${f.sql} AND s.converted = 0 AND s.last_field != ''
    GROUP BY s.last_field ORDER BY n DESC LIMIT 15`).all(...f.args));

  const errMap = new Map(errors.map((e) => [e.field, e]));
  const abMap = new Map(abandons.map((a) => [a.field, a.n]));
  return fields.map((r) => ({
    field: r.field, label: r.label, path: r.path, sessions: r.sessions,
    avgSeconds: Math.round((r.avg_ms || 0) / 100) / 10,
    correctionRate: r.keys > 0 ? Math.round((r.backspaces / r.keys) * 100) : 0,
    leftEmptyRate: pct(r.left_empty, r.interactions),
    errors: errMap.get(r.field)?.errors || 0,
    errorSample: errMap.get(r.field)?.sample || '',
    abandonedHere: abMap.get(r.field) || 0
  })).sort((a, b) => (b.abandonedHere * 4 + b.errors + b.correctionRate / 10) - (a.abandonedHere * 4 + a.errors + a.correctionRate / 10));
}

export async function errorList(db, f, limit = 20) {
  const js = (await db.prepare(`SELECT e.name msg, json_extract(e.data, '$.src') src,
      COUNT(*) n, COUNT(DISTINCT e.session_id) sessions,
      COUNT(DISTINCT CASE WHEN s.converted = 0 THEN e.session_id END) lost,
      GROUP_CONCAT(DISTINCT s.browser) browsers, GROUP_CONCAT(DISTINCT e.path) paths
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'js_error' GROUP BY e.name ORDER BY sessions DESC LIMIT ?`).all(...f.args, limit));
  const net = (await db.prepare(`SELECT json_extract(e.data, '$.url') url, json_extract(e.data, '$.status') status,
      COUNT(*) n, COUNT(DISTINCT e.session_id) sessions,
      COUNT(DISTINCT CASE WHEN s.converted = 0 THEN e.session_id END) lost
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'net_error' GROUP BY url, status ORDER BY sessions DESC LIMIT ?`).all(...f.args, limit));
  return { js, net };
}

export async function speed(db, f) {
  const buckets = (await db.prepare(`SELECT
      CASE WHEN s.lcp IS NULL THEN 'unknown'
           WHEN s.lcp <= 2500 THEN 'good'
           WHEN s.lcp <= 4000 THEN 'needs-improvement'
           ELSE 'poor' END bucket,
      COUNT(*) sessions, SUM(s.converted) orders, AVG(s.lcp) lcp, AVG(s.max_depth) depth
    FROM sessions s WHERE ${f.sql} GROUP BY bucket`).all(...f.args))
    .map((r) => ({ ...r, cr: pct(r.orders, r.sessions), lcp: Math.round(r.lcp || 0), depth: Math.round(r.depth || 0) }));
  const byPath = (await db.prepare(`SELECT s.entry_path path, COUNT(*) sessions,
      AVG(s.lcp) lcp, AVG(s.inp) inp, AVG(s.cls) cls, SUM(s.converted) orders
    FROM sessions s WHERE ${f.sql} GROUP BY s.entry_path HAVING sessions >= 3
    ORDER BY lcp DESC LIMIT 15`).all(...f.args))
    .map((r) => ({
      ...r, cr: pct(r.orders, r.sessions), lcp: Math.round(r.lcp || 0),
      inp: Math.round(r.inp || 0), cls: Math.round((r.cls || 0) * 1000) / 1000
    }));
  return { buckets, byPath };
}

const SEGMENT_FEATURES = [
  { key: 'rage', label: 'Були rage-кліки', sql: 's.rage > 0' },
  { key: 'dead', label: 'Клікали в «мертві» елементи', sql: 's.dead > 0' },
  { key: 'js', label: 'Ловили JS-помилку', sql: 's.js_errors > 0' },
  { key: 'net', label: 'Ловили помилку запиту', sql: 's.net_errors > 0' },
  { key: 'valid', label: 'Помилки валідації форми', sql: 's.validation_errors > 0' },
  { key: 'slow', label: 'Повільна реакція інтерфейсу', sql: 's.slow_inter > 0' },
  { key: 'hscroll', label: 'Горизонтальний скрол', sql: 's.hscroll > 0' },
  { key: 'zoom', label: 'Зум сторінки (дрібний текст)', sql: 's.zooms > 0' },
  { key: 'thrash', label: 'Метались скролом туди-сюди', sql: 's.thrash > 0' },
  { key: 'back', label: 'Тиснули «назад»', sql: 's.backtracks > 0' },
  { key: 'cta_unseen', label: 'Так і не побачили кнопку CTA', sql: 's.cta_seen = 0' },
  { key: 'shallow', label: 'Скрол менше 40% сторінки', sql: 's.max_depth < 40' },
  { key: 'slow_lcp', label: 'LCP гірше 4 с', sql: 's.lcp > 4000' },
  { key: 'exit_intent', label: 'Вели курсор до закриття вкладки', sql: 's.exit_intents > 0' },
  { key: 'short', label: 'Пішли за 10 секунд', sql: 's.duration < 10000' }
];

export async function segments(db, f) {
  const totals = (await db.prepare(`SELECT SUM(s.converted) conv, SUM(1 - s.converted) rest FROM sessions s WHERE ${f.sql}`).get(...f.args));
  const conv = totals.conv || 0, rest = totals.rest || 0;
  const out = [];
  for (const feat of SEGMENT_FEATURES) {
    const r = (await db.prepare(`SELECT
        SUM(CASE WHEN s.converted = 1 AND ${feat.sql} THEN 1 ELSE 0 END) c,
        SUM(CASE WHEN s.converted = 0 AND ${feat.sql} THEN 1 ELSE 0 END) n
      FROM sessions s WHERE ${f.sql}`).get(...f.args));
    const convRate = pct(r.c || 0, conv), restRate = pct(r.n || 0, rest);
    out.push({
      key: feat.key, label: feat.label, converters: convRate, nonConverters: restRate,
      delta: Math.round((restRate - convRate) * 10) / 10,
      affected: r.n || 0
    });
  }
  out.sort((a, b) => b.delta - a.delta);
  return { convSessions: conv, restSessions: rest, features: out };
}

export async function sessionList(db, f, opts = {}) {
  const order = {
    friction: 's.friction DESC, s.max_step DESC',
    recent: 's.started_at DESC',
    deep: 's.max_step DESC, s.friction DESC',
    duration: 's.duration DESC'
  }[opts.sort || 'recent'];
  const extra = [];
  const args = [...f.args];
  if (opts.only === 'lost') extra.push('s.converted = 0');
  if (opts.only === 'converted') extra.push('s.converted = 1');
  if (opts.only === 'struggled') extra.push('s.friction >= 20 AND s.converted = 0');
  if (opts.path) { extra.push('(s.entry_path LIKE ? OR s.exit_path LIKE ?)'); args.push(`%${opts.path}%`, `%${opts.path}%`); }
  const sql = `SELECT s.id, s.started_at, s.duration, s.device, s.browser, s.source, s.medium, s.country,
      s.entry_path, s.exit_path, s.pageviews, s.max_step, s.max_step_id, s.converted, s.revenue,
      s.friction, s.rage, s.dead, s.js_errors, s.net_errors, s.validation_errors,
      s.max_depth, s.cta_seen, s.last_field, s.lcp, s.inp, s.has_replay, s.identity,
      s.visitor_id, s.ip, s.city, s.region,
      (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id AND v.started_at <= s.started_at) visit_no,
      (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id) visits,
      (SELECT COUNT(DISTINCT v.visitor_id) FROM sessions v WHERE v.ip = s.ip AND s.ip != '') ip_people
    FROM sessions s WHERE ${f.sql} ${extra.length ? 'AND ' + extra.join(' AND ') : ''}
    ORDER BY ${order} LIMIT ?`;
  return (await db.prepare(sql).all(...args, Number(opts.limit) || 60));
}

export async function sessionDetail(db, id, siteId = '') {
  const scope = siteId ? ' AND s.site_id = ?' : '';
  const sameSite = siteId ? ' AND v.site_id = s.site_id' : '';
  const session = (await db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id AND v.started_at <= s.started_at${sameSite}) visit_no,
      (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id${sameSite}) visits,
      (SELECT COUNT(DISTINCT v.visitor_id) FROM sessions v WHERE v.ip = s.ip AND s.ip != ''${sameSite}) ip_people
    FROM sessions s WHERE s.id = ?${scope}`).get(...(siteId ? [id, siteId] : [id])));
  if (!session) return null;
  const events = (await db.prepare(`SELECT ts, seq, type, path, sel, label, name, num, data
    FROM events WHERE session_id = ? ORDER BY ts, seq LIMIT 6000`).all(id))
    .map((e) => ({ ...e, data: safeJson(e.data) }));
  const snaps = (await db.prepare('SELECT id, ts, path, device, w, h, vw, vh, data FROM snapshots WHERE session_id = ? ORDER BY ts').all(id))
    .map((s) => ({ id: s.id, ts: s.ts, path: s.path, device: s.device, w: s.w, h: s.h, vw: s.vw, vh: s.vh, ...(unpackSnapshot(s.data) || { els: [] }) }));
  return { session, events, snapshots: snaps };
}

export async function heatmap(db, f, path, device, sid) {
  const args = [...f.args, path];
  let extra = '';
  if (device) { extra += ' AND s.device = ?'; args.push(device); }
  if (sid) { extra += ' AND e.session_id = ?'; args.push(sid); }
  // ex/ey/ew/eh = box of the clicked element at click time, so the dashboard can re-anchor
  // each click to the same element at any page width.
  const clicks = (await db.prepare(`SELECT json_extract(e.data, '$.x') x, json_extract(e.data, '$.y') y,
      json_extract(e.data, '$.ex') ex, json_extract(e.data, '$.ey') ey,
      json_extract(e.data, '$.ew') ew, json_extract(e.data, '$.eh') eh,
      e.type, e.sel, e.label, e.ts, e.session_id sid, s.converted, s.vw, s.device
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.path = ? ${extra}
      AND e.type IN ('click','rage_click','dead_click') ORDER BY e.ts LIMIT 8000`).all(...args));
  const depth = (await db.prepare(`SELECT json_extract(e.data, '$.depth') d, COUNT(*) n
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.path = ? ${extra} AND e.type = 'scroll'
    GROUP BY d ORDER BY d`).all(...args));
  // A layout snapshot for this page, so the click map can be drawn without loading the real
  // site in an iframe (which is impossible when Conv Lens runs on its own domain).
  const snapArgs = [...f.args, path];
  let snapExtra = '';
  if (device) { snapExtra += ' AND sn.device = ?'; snapArgs.push(device); }
  const snapRow = await db.prepare(`SELECT sn.w, sn.h, sn.data FROM snapshots sn JOIN sessions s ON s.id = sn.session_id
    WHERE ${f.sql} AND sn.path = ? ${snapExtra} ORDER BY sn.ts DESC LIMIT 1`).get(...snapArgs);
  const snapshot = snapRow ? { ...(unpackSnapshot(snapRow.data) || { els: [] }), w: snapRow.w, h: snapRow.h } : null;

  return { path, device: device || 'all', sid: sid || '', clicks, depth, snapshot };
}

export async function pathList(db, f, limit = 40) {
  return (await db.prepare(`SELECT e.path, COUNT(DISTINCT e.session_id) sessions,
      SUM(CASE WHEN e.type = 'rage_click' THEN 1 ELSE 0 END) rage,
      SUM(CASE WHEN e.type = 'dead_click' THEN 1 ELSE 0 END) dead
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type IN ('pageview','rage_click','dead_click')
    GROUP BY e.path ORDER BY sessions DESC LIMIT ?`).all(...f.args, limit));
}

export async function surveyAnswers(db, f) {
  const grouped = (await db.prepare(`SELECT e.name answer, COUNT(*) n,
      SUM(CASE WHEN s.converted = 1 THEN 1 ELSE 0 END) converted
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'survey_answer' GROUP BY e.name ORDER BY n DESC`).all(...f.args));
  const texts = (await db.prepare(`SELECT e.session_id, e.ts, e.name answer,
      json_extract(e.data, '$.text') text, json_extract(e.data, '$.step') step, s.device
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'survey_answer' AND json_extract(e.data, '$.text') != ''
    ORDER BY e.ts DESC LIMIT 60`).all(...f.args));
  const shown = (await db.prepare(`SELECT COUNT(*) n FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'survey_shown'`).get(...f.args));
  return { grouped, texts, shown: shown.n || 0, answered: grouped.reduce((a, g) => a + g.n, 0) };
}

export async function ctaVisibility(db, f) {
  return (await db.prepare(`SELECT json_extract(e.data, '$.sel') sel, MAX(json_extract(e.data, '$.label')) label,
      e.path, s.device, COUNT(DISTINCT e.session_id) sessions,
      AVG(json_extract(e.data, '$.y')) avg_y, AVG(json_extract(e.data, '$.fold')) fold
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type = 'element_pos'
    GROUP BY sel, e.path, s.device HAVING sessions >= 2 ORDER BY sessions DESC LIMIT 20`).all(...f.args))
    .map((r) => ({ ...r, avg_y: Math.round(r.avg_y || 0), fold: Math.round(r.fold || 0), belowFold: (r.avg_y || 0) > (r.fold || 0) }));
}

function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

export async function deleteSession(db, id, siteId = '') {
  if (!id) return 0;
  if (siteId) {
    const own = await db.prepare('SELECT id FROM sessions WHERE id = ? AND site_id = ?').get(id, siteId);
    if (!own) return 0;
  }
  await db.batch([
    { sql: 'DELETE FROM events WHERE session_id = ?', args: [id] },
    { sql: 'DELETE FROM snapshots WHERE session_id = ?', args: [id] },
    { sql: 'DELETE FROM sessions WHERE id = ?', args: [id] }
  ]);
  return 1;
}

// Storage usage: row counts and payload bytes per table, replay share, and the file size when the engine reports it.
export async function storage(db, siteId = '') {
  const w = siteId ? 'site_id = ?' : '1=1';
  const a = siteId ? [siteId] : [];
  const one = async (sql) => { try { return await db.prepare(sql).get(...a); } catch { return null; } };
  const plain = async (sql) => { try { return await db.prepare(sql).get(); } catch { return null; } };
  const ev = await one(`SELECT COUNT(*) n, SUM(LENGTH(COALESCE(data,'')) + LENGTH(COALESCE(sel,'')) + LENGTH(COALESCE(label,'')) + LENGTH(COALESCE(name,'')) + LENGTH(COALESCE(path,'')) + 40) bytes FROM events WHERE ${w}`);
  const scene = await one(`SELECT COUNT(*) n, SUM(LENGTH(COALESCE(data,''))) bytes FROM events WHERE ${w} AND name = '_scene'`);
  const moves = await one(`SELECT COUNT(*) n, SUM(LENGTH(COALESCE(data,'')) + 40) bytes FROM events WHERE ${w} AND type IN ('move','mousemove','scroll')`);
  const types = await db.prepare(`SELECT type, COUNT(*) n, SUM(LENGTH(COALESCE(data,'')) + 40) bytes FROM events WHERE ${w} GROUP BY type ORDER BY bytes DESC LIMIT 12`).all(...a);
  const sn = await one(`SELECT COUNT(*) n, SUM(LENGTH(data)) bytes FROM snapshots WHERE ${w}`);
  const ss = await one(`SELECT COUNT(*) n, SUM(duration) dur FROM sessions WHERE ${w}`);
  const pc = await plain('PRAGMA page_count'), ps = await plain('PRAGMA page_size');
  const pages = pc ? Number(Object.values(pc)[0]) : 0, psize = ps ? Number(Object.values(ps)[0]) : 0;
  return { events: ev, scene, moves, types, snapshots: sn, sessions: ss, fileBytes: pages && psize ? pages * psize : null };
}
