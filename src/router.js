// One router for every runtime. The node server and the serverless function both
// hand it a plain request object and send back what it returns, so there is a single
// place where behaviour lives.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, purgeOld, storageKind } from './db.js';
import { ingestBatch } from './ingest.js';
import { buildInsights } from './insights.js';
import * as agg from './aggregate.js';
import { PRESET_LIST } from './presets.js';
import { inspectSite } from './detect.js';
import { publicConfig } from './config.js';
import {
  listSites, getSite, createSite, updateSite, rotateKey, deleteSite, resolveSite,
  siteConfig, adminToken, tokenIsFromEnv, needsSetup, setSetting, newKey,
  countOrphans, adoptOrphans
} from './store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

let trackerCache = null;
async function trackerSource() {
  if (!trackerCache) trackerCache = await readFile(join(ROOT, 'tracker', 'conv-lens.js'), 'utf8');
  return trackerCache;
}

const json = (status, data, headers = {}) => ({ status, headers: { ...JSON_H, ...headers }, body: JSON.stringify(data) });
const text = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers }, body });

// The collector answers any origin on purpose. A site key sits in the page source, so it is
// public by nature and origin-locking would not protect it — while a domain typed slightly
// differently (http vs https, staging, www) would silently kill tracking with a CORS error,
// which is the one failure a non-technical owner cannot diagnose. The dashboard API below is
// what is actually protected, by the key.
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

let lastPurge = 0;
async function maybePurge(db, cfg) {
  if (Date.now() - lastPurge < 6 * 3600 * 1000) return;
  lastPurge = Date.now();
  try { await purgeOld(db, Number(cfg.retentionDays) || 30, cfg.siteId); } catch {}
}

// `req`: { method, route, query, body, headers, ip }
// `route` is the name after /cl/ or /api/ ("collect", "overview", "site/update", ...).
export async function handle(req, opts = {}) {
  const db = await openDb(opts.db || {});
  const method = (req.method || 'GET').toUpperCase();
  const route = String(req.route || '').replace(/^\/+|\/+$/g, '');
  const q = req.query || {};
  const headers = req.headers || {};

  if (method === 'OPTIONS') return { status: 204, headers: corsHeaders(headers.origin), body: '' };

  // ---------- tracker ----------
  if (route === 't' || route === 't.js') {
    const site = await resolveSite(db, q.s || q.site);
    if (!site) {
      return { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
        body: '/* conv-lens: невідомий ключ сайту. Додайте сайт у дашборді та візьміть новий код. */' };
    }
    const cfg = siteConfig(site);
    const endpoint = (opts.publicOrigin || '') + '/cl/collect';
    const pub = publicConfig(cfg, endpoint);
    const code = await trackerSource();
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        ...corsHeaders(headers.origin)
      },
      body: `window.convLensConfig=Object.assign(${JSON.stringify(pub)},window.convLensConfig||{});\n${code}`
    };
  }

  // ---------- collector ----------
  if (route === 'collect') {
    let env;
    try { env = JSON.parse(req.body || '{}'); } catch { return { status: 400, headers: {}, body: '' }; }
    const site = await resolveSite(db, env.site || q.s);
    if (!site) return { status: 204, headers: corsHeaders(headers.origin), body: '' };
    const cfg = siteConfig(site);
    const cors = corsHeaders(headers.origin);
    if (method !== 'POST') return { status: 405, headers: cors, body: '' };
    try {
      await ingestBatch(db, cfg, env, {
        ip: req.ip || '',
        ua: headers['user-agent'] || '',
        country: headers['x-vercel-ip-country'] || headers['cf-ipcountry'] || '',
        city: decodeHeader(headers['x-vercel-ip-city']),
        region: headers['x-vercel-ip-country-region'] || ''
      });
    } catch (e) {
      return { status: 400, headers: cors, body: '' };
    }
    maybePurge(db, cfg);
    return { status: 204, headers: cors, body: '' };
  }

  // ---------- first run ----------
  const setupOpen = await needsSetup(db);

  if (route === 'bootstrap') {
    const sites = (await listSites(db)).map((s) => {
      const c = siteConfig(s);
      return { id: s.id, name: s.name, origin: s.origin, site_key: s.site_key, replayMode: c.replayMode };
    });
    if (setupOpen) return json(200, { needsSetup: true, sites: [], presets: PRESET_LIST });
    // Answered without a key as well: "setup is done, ask for the key" is not a secret,
    // and it lets the dashboard decide what to draw without a failed request on every load.
    if (!(await authorized(db, q, headers))) return json(200, { needsSetup: false, needsKey: true, sites: [], presets: [] });
    return json(200, {
      needsSetup: false, sites, presets: PRESET_LIST,
      storage: storageKind(), tokenFromEnv: tokenIsFromEnv(),
      publicOrigin: opts.publicOrigin || ''
    });
  }

  // Looks at the site from the server: which platform, and is the tag really on the page.
  // Open during setup because the wizard needs it before a key exists.
  if (route === 'detect') {
    if (!setupOpen && !(await authorized(db, q, headers))) return json(401, { error: 'Потрібен ключ доступу' });
    const url = String(q.url || '').trim();
    if (!url) return json(400, { ok: false, error: 'Вкажіть адресу сайту' });
    let key = '';
    if (q.site) {
      const s = await getSite(db, q.site);
      if (s) key = s.site_key;
    }
    try {
      return json(200, await inspectSite(/^https?:\/\//i.test(url) ? url : 'https://' + url, key));
    } catch (e) {
      return json(200, { ok: false, error: String((e && e.message) || e) });
    }
  }

  if (route === 'setup') {
    if (!setupOpen) return json(403, { error: 'Налаштування вже завершено' });
    if (method !== 'POST') return json(405, { error: 'POST only' });
    let b = {};
    try { b = JSON.parse(req.body || '{}'); } catch {}
    if (!b.origin && !b.name) return json(400, { error: 'Вкажіть адресу сайту' });
    const token = String(b.token || '').trim() || newKey(16);
    await setSetting(db, 'admin_token', token);
    await setSetting(db, 'installed_at', Date.now());
    const site = await createSite(db, { name: b.name || b.origin, origin: b.origin, preset: b.preset || 'shop' });
    return json(200, { ok: true, token, site: { id: site.id, name: site.name, origin: site.origin, site_key: site.site_key } });
  }

  // ---------- everything below needs the key ----------
  if (!(await authorized(db, q, headers))) {
    return json(401, { error: 'Невірний ключ доступу', needsKey: true });
  }

  if (route === 'presets') return json(200, { presets: PRESET_LIST });

  if (route === 'sites') {
    if (method === 'POST') {
      let b = {};
      try { b = JSON.parse(req.body || '{}'); } catch {}
      if (!b.origin && !b.name) return json(400, { error: 'Вкажіть адресу сайту' });
      const site = await createSite(db, { name: b.name || b.origin, origin: b.origin, preset: b.preset || 'shop' });
      return json(200, { site });
    }
    return json(200, { sites: await listSites(db) });
  }

  // Routes from here on act on one site.
  const site = await resolveSite(db, q.site || q.s);
  if (!site) return json(400, { error: 'Виберіть сайт', needsSite: true });
  const cfg = siteConfig(site);

  if (route === 'site') {
    if (method === 'GET') {
      const seen = await db.prepare('SELECT COUNT(*) n, MAX(last_at) last FROM sessions WHERE site_id = ?').get(site.id);
      const orphans = await countOrphans(db);
      return json(200, {
        orphans,
        site, config: cfg,
        snippet: snippetFor(cfg, opts.publicOrigin || ''),
        connect: connectCode(cfg, opts.publicOrigin || ''),
        install: { sessions: seen?.n || 0, lastEventAt: seen?.last || 0 }
      });
    }
    if (method === 'POST') {
      let b = {};
      try { b = JSON.parse(req.body || '{}'); } catch {}
      const updated = await updateSite(db, site.id, { name: b.name, origin: b.origin, config: b.config });
      return json(200, { site: updated, config: siteConfig(updated) });
    }
  }

  // Adopts data recorded before this instance knew about sites.
  if (route === 'site/adopt') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    return json(200, await adoptOrphans(db, site.id));
  }

  if (route === 'site/key') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    const rotated = await rotateKey(db, site.id);
    const rc = siteConfig(rotated);
    return json(200, { site: rotated, snippet: snippetFor(rc, opts.publicOrigin || ''), connect: connectCode(rc, opts.publicOrigin || '') });
  }

  if (route === 'site/delete') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    await deleteSite(db, site.id);
    return json(200, { ok: true });
  }

  if (route === 'snippet') return json(200, { snippet: snippetFor(cfg, opts.publicOrigin || '') });

  // ---------- data ----------
  const f = agg.buildFilter({ ...q, siteId: site.id });
  try {
    switch (route) {
      case 'overview': {
        const out = {
          overview: await agg.overview(db, cfg, f), funnel: await agg.funnel(db, cfg, f),
          devices: await agg.deviceBreakdown(db, f), exits: await agg.exitPaths(db, f),
          range: { from: f.from, to: f.to },
          config: { currency: cfg.currency, siteUrl: cfg.siteUrl, funnel: cfg.funnel, name: cfg.name, storage: storageKind() }
        };
        // The same window, shifted back by its own length: "last 30 days vs the 30 before".
        if (q.compare) {
          const span = f.to - f.from;
          const prev = agg.buildFilter({ ...q, siteId: site.id, from: f.from - span, to: f.from });
          out.previous = {
            overview: await agg.overview(db, cfg, prev),
            funnel: await agg.funnel(db, cfg, prev),
            range: { from: prev.from, to: prev.to }
          };
        }
        return json(200, out);
      }
      case 'audience': return json(200, { ...(await agg.audience(db, f)), currency: cfg.currency });
      case 'journey': return json(200, await agg.journeys(db, f));
      case 'insights': return json(200, await buildInsights(db, cfg, f));
      case 'funnel': return json(200, await agg.funnel(db, cfg, f));
      case 'sessions': return json(200, { sessions: await agg.sessionList(db, f, q), funnel: cfg.funnel });
      case 'session': {
        const d = await agg.sessionDetail(db, q.id, site.id);
        return d ? json(200, d) : json(404, { error: 'not found' });
      }
      case 'elements': return json(200, { elements: await agg.elementFriction(db, f), cta: await agg.ctaVisibility(db, f) });
      case 'forms': return json(200, { fields: await agg.formAnalytics(db, f) });
      case 'errors': return json(200, await agg.errorList(db, f));
      case 'speed': return json(200, await agg.speed(db, f));
      case 'segments': return json(200, await agg.segments(db, f));
      case 'sources': return json(200, { sources: await agg.sources(db, f) });
      case 'traffic': return json(200, { ...(await agg.trafficSources(db, f)), currency: cfg.currency });
      case 'survey': return json(200, await agg.surveyAnswers(db, f));
      case 'paths': return json(200, { paths: await agg.pathList(db, f) });
      case 'heatmap': return json(200, await agg.heatmap(db, f, q.path || '/', q.device || '', q.sid || ''));
      case 'events': return json(200, await customEvents(db, f));
      case 'storage': return json(200, await agg.storage(db, site.id));
      case '_diag': {
        const out = {};
        const probe = async (name, sql, args) => {
          try { out[name] = (await db.prepare(sql).all(...args)).length; }
          catch (e) { out[name] = 'ERR: ' + String((e && e.message) || e).slice(0, 180); }
        };
        await probe('plain', `SELECT s.id FROM sessions s WHERE ${f.sql} LIMIT 5`, f.args);
        await probe('withLimitParam', `SELECT s.id FROM sessions s WHERE ${f.sql} LIMIT ?`, [...f.args, 5]);
        await probe('withOrder', `SELECT s.id FROM sessions s WHERE ${f.sql} ORDER BY s.started_at DESC LIMIT ?`, [...f.args, 5]);
        await probe('allColumns', `SELECT s.id, s.started_at, s.duration, s.device, s.browser, s.source, s.medium, s.country,
            s.entry_path, s.exit_path, s.pageviews, s.max_step, s.max_step_id, s.converted, s.revenue,
            s.friction, s.rage, s.dead, s.js_errors, s.net_errors, s.validation_errors,
            s.max_depth, s.cta_seen, s.last_field, s.lcp, s.inp, s.has_replay, s.identity,
            s.visitor_id, s.ip, s.city, s.region
          FROM sessions s WHERE ${f.sql} LIMIT ?`, [...f.args, 5]);
        await probe('withSubqueries', `SELECT s.id,
            (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id AND v.started_at <= s.started_at) visit_no,
            (SELECT COUNT(*) FROM sessions v WHERE v.visitor_id = s.visitor_id) visits,
            (SELECT COUNT(DISTINCT v.visitor_id) FROM sessions v WHERE v.ip = s.ip AND s.ip != '') ip_people
          FROM sessions s WHERE ${f.sql} LIMIT ?`, [...f.args, 5]);
        try { out.real = (await agg.sessionList(db, f, q)).length; }
        catch (e) { out.real = 'ERR: ' + String((e && e.message) || e).slice(0, 180); }
        out.filter = { sql: f.sql, args: f.args };
        out.optsSeen = { sort: q.sort, only: q.only, limit: q.limit, path: q.path, keys: Object.keys(q) };
        out.sqlBuilt = agg.__lastSessionSql || null;
        return json(200, out);
      }
      case 'delete': {
        if (method !== 'POST') return json(405, { error: 'POST only' });
        let id = q.id;
        if (!id) { try { id = JSON.parse(req.body || '{}').id; } catch {} }
        if (!id) return json(400, { error: 'id required' });
        const n = await agg.deleteSession(db, String(id), site.id);
        return json(200, { ok: !!n, id });
      }
      case 'purge': {
        if (method !== 'POST') return json(405, { error: 'POST only' });
        const days = Number(q.days) || Number(cfg.retentionDays) || 30;
        return json(200, { removed: await purgeOld(db, days, site.id), days });
      }
      default: return json(404, { error: 'unknown endpoint' });
    }
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}

async function authorized(db, q, headers) {
  const token = await adminToken(db);
  if (!token) return true;
  const given = q.key || String(headers.authorization || '').replace(/^Bearer\s+/i, '');
  return given === token;
}

function decodeHeader(v) { try { return decodeURIComponent(String(v || '')); } catch { return String(v || ''); } }

export function snippetFor(cfg, publicOrigin) {
  const base = (publicOrigin || '').replace(/\/$/, '') || 'https://ВАШ-CONV-LENS';
  return `<script src="${base}/cl/t.js?s=${cfg.siteKey}" defer></script>`;
}

// One string to paste where a plugin asks for a connection, instead of an address and a key
// in two separate fields that are easy to mix up between sites.
export function connectCode(cfg, publicOrigin) {
  const base = (publicOrigin || '').replace(/\/$/, '');
  if (!base) return '';
  return 'cl_' + Buffer.from(`${base}|${cfg.siteKey}`, 'utf8').toString('base64url');
}

// Custom and goal events the site sends itself, grouped by name and label.
async function customEvents(db, f) {
  const rows = await db.prepare(`SELECT e.name event,
      COALESCE(json_extract(e.data, '$.props.label'), json_extract(e.data, '$.props.cat'), json_extract(e.data, '$.props.via')) label,
      COUNT(*) n, COUNT(DISTINCT e.session_id) sessions
    FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE ${f.sql} AND e.type IN ('custom','goal') AND e.name NOT LIKE '\\_%' ESCAPE '\\'
    GROUP BY e.name, label ORDER BY sessions DESC, n DESC LIMIT 300`).all(...f.args);
  return { events: rows };
}
