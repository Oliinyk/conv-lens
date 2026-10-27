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
  countOrphans, adoptOrphans, getSiteByViewKey, rotateViewKey, ensureViewKey, cleanPaths,
  listAccess, createAccess, deleteAccess, loginWithPassword, getAccessByToken
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
    const who = await access(db, q, headers);
    if (!who) return json(200, { needsSetup: false, needsKey: true, sites: [], presets: [] });
    const visible = who.admin ? sites : sites.filter((x) => x.id === who.siteId);
    return json(200, {
      needsSetup: false, role: who.admin ? 'owner' : 'viewer', label: who.label || '',
      sites: visible.map(({ view_key, ...rest }) => rest),
      presets: who.admin ? PRESET_LIST : [],
      storage: who.admin ? storageKind() : undefined,
      tokenFromEnv: who.admin ? tokenIsFromEnv() : undefined,
      publicOrigin: opts.publicOrigin || ''
    });
  }

  // Looks at the site from the server: which platform, and is the tag really on the page.
  // Open during setup because the wizard needs it before a key exists.
  if (route === 'detect') {
    const whoDetect = setupOpen ? { admin: true } : await access(db, q, headers);
    if (!whoDetect || !whoDetect.admin) return json(401, { error: 'Потрібен ключ доступу' });
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

  // Exchanges a password for a session token. The password is never stored by the browser
  // and never sent again.
  if (route === 'login') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    let b = {};
    try { b = JSON.parse(req.body || '{}'); } catch {}
    const pass = String(b.password || '').trim();
    if (!pass) return json(400, { error: 'Введіть пароль' });

    const token = await adminToken(db);
    if (token && pass === token) return json(200, { token, role: 'owner', label: 'власник' });

    const acc = await loginWithPassword(db, pass);
    if (acc) return json(200, { token: acc.token, role: acc.site_id ? 'viewer' : 'owner', label: acc.label });

    // A view-key link pasted into the password box is a reasonable mistake to accept.
    const site = await getSiteByViewKey(db, pass.replace(/^.*key=/, ''));
    if (site) return json(200, { token: site.view_key, role: 'viewer', label: site.name });

    return json(401, { error: 'Пароль не підійшов' });
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

  // ---------- everything below needs a key ----------
  const who = await access(db, q, headers);
  if (!who) return json(401, { error: 'Невірний ключ доступу', needsKey: true });
  if (!who.admin && ADMIN_ONLY.has(route)) {
    return json(403, { error: 'Цей ключ дає лише перегляд одного сайту' });
  }

  if (route === 'presets') return json(200, { presets: PRESET_LIST });

  // Who may open this dashboard. Each entry is one person with their own password.
  if (route === 'access') {
    if (method === 'POST') {
      let b = {};
      try { b = JSON.parse(req.body || '{}'); } catch {}
      if (!String(b.label || '').trim()) return json(400, { error: 'Вкажіть, кому цей доступ' });
      if (b.siteId && !(await getSite(db, b.siteId))) return json(400, { error: 'Такого сайту немає' });
      const made = await createAccess(db, { label: b.label, siteId: b.siteId || '', password: b.password });
      return json(200, { access: { id: made.id, label: made.label, site_id: made.site_id }, password: made.password });
    }
    const all = await listAccess(db);
    const sites = await listSites(db);
    const nameOf = (id) => (sites.find((x) => x.id === id) || {}).name || id;
    return json(200, {
      access: all.map((a) => ({ ...a, scope: a.site_id ? nameOf(a.site_id) : 'усі сайти' })),
      sites: sites.map((x) => ({ id: x.id, name: x.name }))
    });
  }

  if (route === 'access/delete') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    let b = {};
    try { b = JSON.parse(req.body || '{}'); } catch {}
    const id = q.id || b.id;
    if (!id) return json(400, { error: 'id required' });
    await deleteAccess(db, String(id));
    return json(200, { ok: true });
  }

  // A list of every site with the numbers that matter, so the owner can see them side by side
  // and jump straight into one.
  if (route === 'sites/overview') {
    const all = await listSites(db);
    const out = [];
    for (const row of all) {
      const sf = agg.buildFilter({ ...q, siteId: row.id });
      const cfgRow = siteConfig(row);
      const ov = await agg.overview(db, cfgRow, sf);
      const seen = await db.prepare('SELECT MAX(last_at) last FROM sessions WHERE site_id = ?').get(row.id);
      out.push({
        id: row.id, name: row.name, origin: row.origin,
        sessions: ov.sessions, visitors: ov.visitors, orders: ov.orders,
        revenue: ov.revenue, cr: ov.cr, friction: ov.avgFriction, bounceRate: ov.bounceRate,
        currency: cfgRow.currency, lastEventAt: (seen && seen.last) || 0
      });
    }
    return json(200, { sites: out });
  }

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

  // Routes from here on act on one site. A view key pins it: whatever ?site= says is ignored,
  // so the key cannot be pointed at someone else's data.
  const site = who.admin
    ? await resolveSite(db, q.site || q.s)
    : await getSite(db, who.siteId);
  if (!site) return json(400, { error: 'Виберіть сайт', needsSite: true });
  const cfg = siteConfig(site);

  if (route === 'site') {
    if (method === 'GET') {
      const seen = await db.prepare('SELECT COUNT(*) n, MAX(last_at) last FROM sessions WHERE site_id = ?').get(site.id);
      const orphans = await countOrphans(db);
      const withView = await ensureViewKey(db, site);
      return json(200, {
        orphans,
        viewUrl: viewUrlFor(withView, opts.publicOrigin || ''),
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

  if (route === 'site/clean-paths') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    return json(200, await cleanPaths(db, site.id, cfg.pathMode || 'noise'));
  }

  if (route === 'site/view-key') {
    if (method !== 'POST') return json(405, { error: 'POST only' });
    const rotated = await rotateViewKey(db, site.id);
    return json(200, { viewKey: rotated.view_key, viewUrl: viewUrlFor(rotated, opts.publicOrigin || '') });
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
      case 'users': return json(200, { ...(await agg.users(db, f)), funnel: cfg.funnel });
      case 'storage': return json(200, await agg.storage(db, site.id));
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

// Who is asking. Either the owner, who sees every site and can change things, or someone
// holding a site's view key, who sees that one site read-only. Anything else is nobody.
async function access(db, q, headers) {
  const given = q.key || String(headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = await adminToken(db);
  if (!token) return { admin: true, siteId: '' };
  if (given && given === token) return { admin: true, siteId: '', label: 'власник' };
  if (given) {
    // A session token issued in exchange for someone's password.
    const acc = await getAccessByToken(db, given);
    if (acc) return { admin: !acc.site_id, siteId: acc.site_id || '', label: acc.label, accessId: acc.id };
    const site = await getSiteByViewKey(db, given);
    if (site) return { admin: false, siteId: site.id, label: 'посилання' };
  }
  return null;
}

// Routes that change something, or that reach across sites, are the owner's alone.
const ADMIN_ONLY = new Set([
  'sites', 'sites/overview', 'site', 'site/key', 'site/view-key', 'site/delete', 'site/adopt', 'site/clean-paths',
  'access', 'access/delete', 'detect', 'delete', 'purge', 'snippet'
]);

function decodeHeader(v) { try { return decodeURIComponent(String(v || '')); } catch { return String(v || ''); } }

export function snippetFor(cfg, publicOrigin) {
  const base = (publicOrigin || '').replace(/\/$/, '') || 'https://ВАШ-CONV-LENS';
  return `<script src="${base}/cl/t.js?s=${cfg.siteKey}" defer></script>`;
}

// One string to paste where a plugin asks for a connection, instead of an address and a key
// in two separate fields that are easy to mix up between sites.
export function viewUrlFor(site, publicOrigin) {
  const base = (publicOrigin || '').replace(/\/$/, '') || 'https://ВАШ-CONV-LENS';
  return site.view_key ? `${base}/dashboard/?key=${site.view_key}` : '';
}

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
