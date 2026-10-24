// Storage for Conv Lens. Two backends, one async interface, one SQL dialect:
//   * node:sqlite  — a local file, no npm install at all (default when you run it yourself)
//   * @libsql/client — Turso or any libSQL server (default on Vercel and other serverless hosts)
// Everything above this file is async, so the dashboard queries are identical on both.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCHEMA, MIGRATIONS } from './schema.js';
import { classifyHost, normalizeMedium } from './sources.js';

const clean = (args) => args.map((v) => (v === undefined ? null : v));

function wrapLibsql(c) {
  const toObjects = (rs) => rs.rows.map((row) => {
    const o = {};
    rs.columns.forEach((col, i) => { o[col] = row[i]; });
    return o;
  });
  return {
    kind: 'libsql',
    prepare(sql) {
      return {
        all: async (...a) => toObjects(await c.execute({ sql, args: clean(a) })),
        get: async (...a) => toObjects(await c.execute({ sql, args: clean(a) }))[0],
        run: async (...a) => c.execute({ sql, args: clean(a) })
      };
    },
    batch: (stmts) => (stmts.length ? c.batch(stmts.map((s) => ({ sql: s.sql, args: clean(s.args) })), 'write') : Promise.resolve([])),
    exec: (sql) => c.executeMultiple(sql)
  };
}

function wrapNodeSqlite(db) {
  return {
    kind: 'sqlite',
    prepare(sql) {
      let st = null;
      const stmt = () => (st ||= db.prepare(sql));
      return {
        all: async (...a) => stmt().all(...clean(a)),
        get: async (...a) => stmt().get(...clean(a)),
        run: async (...a) => stmt().run(...clean(a))
      };
    },
    // node:sqlite is synchronous, so a transaction is the honest equivalent of libSQL's batch.
    batch: async (stmts) => {
      if (!stmts.length) return [];
      db.exec('BEGIN');
      try {
        for (const s of stmts) db.prepare(s.sql).run(...clean(s.args || []));
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        throw e;
      }
      return [];
    },
    exec: async (sql) => db.exec(sql)
  };
}

// Finds a libSQL database in the environment. Works with whatever prefix the host's integration uses
// (TURSO_DATABASE_URL, STORAGE_URL, MYDB_DATABASE_URL, ...): the URL is the variable whose value
// starts with libsql://, and the token is the variable with the same prefix ending in _AUTH_TOKEN or _TOKEN.
export function findDbEnv(env = process.env) {
  for (const k of ['CONV_LENS_DB_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL']) {
    if (env[k]) {
      return { url: env[k], authToken: env.CONV_LENS_DB_TOKEN || env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN };
    }
  }
  const urlKey = Object.keys(env).find((k) => /^libsql:\/\//.test(env[k] || ''));
  if (!urlKey) return null;
  const prefix = urlKey.replace(/_(DATABASE_)?URL$/, '');
  const tokenKey = [`${prefix}_AUTH_TOKEN`, `${prefix}_DATABASE_AUTH_TOKEN`, `${prefix}_TOKEN`].find((k) => env[k])
    || Object.keys(env).find((k) => k.startsWith(prefix) && /_TOKEN$/.test(k));
  return { url: env[urlKey], authToken: tokenKey ? env[tokenKey] : undefined };
}

let handle = null, ready = null, kind = 'none';

async function connect(opts) {
  const remote = opts.url && /^(libsql|http|https|wss?):/.test(opts.url) ? opts : findDbEnv();
  if (remote && remote.url) {
    const { createClient } = await import('@libsql/client');
    const c = createClient({ url: remote.url, authToken: remote.authToken });
    kind = 'libsql';
    return wrapLibsql(c);
  }

  const file = resolve((opts.url || opts.file || './data/conv-lens.db').replace(/^file:/, ''));
  mkdirSync(dirname(file), { recursive: true });
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout = 8000');
    try { db.exec('PRAGMA journal_mode = WAL'); } catch {}
    db.exec('PRAGMA synchronous = NORMAL');
    kind = 'sqlite';
    return wrapNodeSqlite(db);
  } catch {
    // Older Node without node:sqlite: libSQL reads the same file format.
    const { createClient } = await import('@libsql/client');
    kind = 'libsql-file';
    return wrapLibsql(createClient({ url: 'file:' + file }));
  }
}

export function openDb(opts = {}) {
  if (!handle) {
    handle = true;
    ready = connect(opts).then(async (db) => {
      await db.exec(SCHEMA);
      for (const sql of MIGRATIONS) { try { await db.prepare(sql).run(); } catch {} }
      return db;
    });
  }
  return ready;
}

// Lets the CLI and tests open a second database in the same process.
export function resetDb() { handle = null; ready = null; kind = 'none'; }
export const storageKind = () => kind;

const BOT = /bot|crawler|spider|crawling|headless|phantom|puppeteer|playwright|lighthouse|gtmetrix|pingdom|ahrefs|semrush|screaming|yandex\.com\/bots|facebookexternalhit|preview|monitor/i;

export function parseUa(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'other';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'other';
  return { browser, os, isBot: BOT.test(ua) ? 1 : 0 };
}

export function parseSource(referrer = '', search = '') {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const utmSource = q.get('utm_source');
  const utmMedium = normalizeMedium(q.get('utm_medium'));
  const campaign = (q.get('utm_campaign') || q.get('utm_term') || '').slice(0, 60);
  const cut = (v) => String(v || '').slice(0, 40);

  if (q.get('gclid')) return { source: 'google', medium: 'cpc', campaign };
  if (q.get('fbclid')) return { source: 'facebook', medium: 'paid_social', campaign };

  // A tag the site owner put on the link wins, but what the source actually is still
  // decides the medium when the tag did not say — "utm_source=chatgpt.com" with no
  // utm_medium used to land in "unknown".
  if (utmSource) {
    const known = classifyHost(utmSource);
    const paid = utmMedium === 'cpc' || utmMedium === 'paid_social';
    const medium = paid ? utmMedium : (known || utmMedium || 'referral');
    return { source: cut(utmSource), medium, campaign };
  }

  if (!referrer) return { source: 'direct', medium: 'none', campaign };
  let host = '';
  try { host = new URL(referrer).hostname.replace(/^www\./, ''); } catch { host = 'unknown'; }
  return { source: cut(host), medium: classifyHost(host) || 'referral', campaign };
}

// Daily-rotating salt derived from a secret, so every instance hashes the same way
// and yesterday's hashes cannot be matched against today's.
export function hashIp(ip = '') {
  const day = new Date().toISOString().slice(0, 10);
  const secret = process.env.CONV_LENS_SALT || 'conv-lens';
  const salt = createHash('sha256').update(secret + day).digest('hex').slice(0, 16);
  return createHash('sha256').update(salt + ip).digest('hex').slice(0, 16);
}

export function packSnapshot(obj) { return gzipSync(Buffer.from(JSON.stringify(obj))); }
export function unpackSnapshot(buf) {
  try { return JSON.parse(gunzipSync(Buffer.from(buf)).toString()); } catch { return null; }
}

export async function purgeOld(db, days, siteId = '') {
  const cutoff = Date.now() - days * 86400000;
  const where = siteId ? 'last_at < ? AND site_id = ?' : 'last_at < ?';
  const args = siteId ? [cutoff, siteId] : [cutoff];
  const ids = (await db.prepare(`SELECT id FROM sessions WHERE ${where}`).all(...args)).map((r) => r.id);
  if (!ids.length) return 0;
  const chunk = 400;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const marks = part.map(() => '?').join(',');
    await db.batch([
      { sql: `DELETE FROM events WHERE session_id IN (${marks})`, args: part },
      { sql: `DELETE FROM snapshots WHERE session_id IN (${marks})`, args: part },
      { sql: `DELETE FROM sessions WHERE id IN (${marks})`, args: part }
    ]);
  }
  return ids.length;
}
