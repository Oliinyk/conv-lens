// Sites and instance settings. One deployment of Conv Lens serves any number of sites;
// each one is a row here with its own public key and its own config.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolveConfig } from './config.js';
import { normalizePath } from './paths.js';

export const newKey = (bytes = 12) => randomBytes(bytes).toString('hex');

export function slugify(name, fallback = 'site') {
  const s = String(name || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return s || fallback;
}

// A readable id even when the name is written in Cyrillic: fall back to the domain.
function siteId(name, origin) {
  const fromName = slugify(name, '');
  if (fromName) return fromName;
  let host = '';
  try { host = new URL(origin).hostname.replace(/^www\./, ''); } catch { host = String(origin || ''); }
  return slugify(host, 'site');
}

export async function getSetting(db, k, def = null) {
  const row = await db.prepare('SELECT v FROM settings WHERE k = ?').get(k);
  if (!row) return def;
  try { return JSON.parse(row.v); } catch { return row.v; }
}

export async function setSetting(db, k, v) {
  await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run(k, JSON.stringify(v));
  return v;
}

export async function listSites(db) {
  return db.prepare('SELECT id, name, origin, site_key, view_key, created_at, config FROM sites ORDER BY created_at').all();
}

// A key that opens the dashboard for one site and nothing else: handed to a client who
// should see their own numbers without seeing anyone else's.
export async function getSiteByViewKey(db, key) {
  if (!key) return null;
  return (await db.prepare('SELECT * FROM sites WHERE view_key = ?').get(key)) || null;
}

export async function rotateViewKey(db, id) {
  const site = await getSite(db, id);
  if (!site) return null;
  const key = newKey(16);
  await db.prepare('UPDATE sites SET view_key = ? WHERE id = ?').run(key, site.id);
  return { ...site, view_key: key };
}

// Sites created before per-site access existed have no view key yet.
export async function ensureViewKey(db, site) {
  if (!site || site.view_key) return site;
  const key = newKey(16);
  await db.prepare('UPDATE sites SET view_key = ? WHERE id = ?').run(key, site.id);
  return { ...site, view_key: key };
}

export async function getSite(db, idOrKey) {
  if (!idOrKey) return null;
  return (await db.prepare('SELECT * FROM sites WHERE id = ? OR site_key = ?').get(idOrKey, idOrKey)) || null;
}

// The site a tracker batch belongs to. An instance with exactly one site accepts batches that
// carry no key at all, so an older snippet or a hand-written tag keeps working.
export async function resolveSite(db, key) {
  // A key that was given but does not match is an error, never "probably the other site":
  // otherwise a stale snippet would quietly write into someone else's data.
  if (key) return getSite(db, key);
  const all = await listSites(db);
  return all.length === 1 ? all[0] : null;
}

export async function createSite(db, { name, origin, preset = 'shop', config = {} } = {}) {
  const base = siteId(name, origin);
  let id = base, n = 1;
  while (await db.prepare('SELECT id FROM sites WHERE id = ?').get(id)) id = `${base}-${++n}`;
  const site = {
    id,
    name: String(name || origin || id).slice(0, 80),
    origin: String(origin || '').replace(/\/$/, '').slice(0, 200),
    site_key: newKey(),
    view_key: newKey(16),
    created_at: Date.now(),
    config: JSON.stringify({ preset, ...config })
  };
  await db.prepare('INSERT INTO sites (id, name, origin, site_key, view_key, created_at, config) VALUES (?,?,?,?,?,?,?)')
    .run(site.id, site.name, site.origin, site.site_key, site.view_key, site.created_at, site.config);
  return site;
}

export async function updateSite(db, id, patch = {}) {
  const site = await getSite(db, id);
  if (!site) return null;
  let cfg = {};
  try { cfg = JSON.parse(site.config || '{}'); } catch {}
  const next = { ...cfg, ...(patch.config || {}) };
  const name = patch.name === undefined ? site.name : String(patch.name).slice(0, 80);
  const origin = patch.origin === undefined ? site.origin : String(patch.origin).replace(/\/$/, '').slice(0, 200);
  await db.prepare('UPDATE sites SET name = ?, origin = ?, config = ? WHERE id = ?')
    .run(name, origin, JSON.stringify(next), site.id);
  return getSite(db, site.id);
}

export async function rotateKey(db, id) {
  const site = await getSite(db, id);
  if (!site) return null;
  const key = newKey();
  await db.prepare('UPDATE sites SET site_key = ? WHERE id = ?').run(key, site.id);
  return { ...site, site_key: key };
}

export async function deleteSite(db, id) {
  const site = await getSite(db, id);
  if (!site) return 0;
  await db.batch([
    { sql: 'DELETE FROM events WHERE site_id = ?', args: [site.id] },
    { sql: 'DELETE FROM snapshots WHERE site_id = ?', args: [site.id] },
    { sql: 'DELETE FROM sessions WHERE site_id = ?', args: [site.id] },
    { sql: 'DELETE FROM sites WHERE id = ?', args: [site.id] }
  ]);
  return 1;
}

export const siteConfig = (site) => resolveConfig(site);

// Access to the dashboard. CONV_LENS_TOKEN wins when the host sets it as an env var
// (that is how a serverless deploy is locked down); otherwise the token lives in the database
// and is created by the setup wizard on first run.
export async function adminToken(db) {
  return process.env.CONV_LENS_TOKEN || (await getSetting(db, 'admin_token', '')) || '';
}

export const tokenIsFromEnv = () => !!process.env.CONV_LENS_TOKEN;

// Setup is open only while the instance has no token and no sites yet. After the first
// site is created the dashboard is closed and needs the key.
export async function needsSetup(db) {
  if (await adminToken(db)) return false;
  // Someone with a password counts as "set up" too. Without this, replacing the owner key
  // with a password would leave the instance open to anyone who knows the address.
  const acc = await db.prepare('SELECT COUNT(*) n FROM access').get();
  if (acc && acc.n > 0) return false;
  return (await listSites(db)).length === 0;
}

// Rows written before Conv Lens became multi-site carry no site_id and are invisible to
// every query. Rather than sending someone into a SQL console, the dashboard can adopt them
// into a site. Done in batches so one call cannot outrun a serverless timeout.
export async function countOrphans(db) {
  const q = async (t) => {
    const r = await db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE site_id IS NULL OR site_id = ''`).get();
    return (r && r.n) || 0;
  };
  return { sessions: await q('sessions'), events: await q('events'), snapshots: await q('snapshots') };
}

export async function adoptOrphans(db, siteId, batch = 400) {
  if (!siteId) return { moved: 0, remaining: 0 };
  const ids = (await db.prepare(
    `SELECT id FROM sessions WHERE site_id IS NULL OR site_id = '' LIMIT ${Number(batch) || 400}`
  ).all()).map((r) => r.id);

  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    await db.batch([
      { sql: `UPDATE events SET site_id = ? WHERE session_id IN (${marks})`, args: [siteId, ...ids] },
      { sql: `UPDATE snapshots SET site_id = ? WHERE session_id IN (${marks})`, args: [siteId, ...ids] },
      { sql: `UPDATE sessions SET site_id = ? WHERE id IN (${marks})`, args: [siteId, ...ids] }
    ]);
  }

  // Events and snapshots whose session was already stamped, or whose session is gone.
  await db.prepare("UPDATE events SET site_id = ? WHERE site_id IS NULL OR site_id = ''").run(siteId);
  await db.prepare("UPDATE snapshots SET site_id = ? WHERE site_id IS NULL OR site_id = ''").run(siteId);

  const left = await db.prepare("SELECT COUNT(*) n FROM sessions WHERE site_id IS NULL OR site_id = ''").get();
  return { moved: ids.length, remaining: (left && left.n) || 0 };
}

// Paths already written keep whatever form they arrived in. Rewriting them is cheap because
// the work is per distinct path, not per row.
export async function cleanPaths(db, siteId, mode = 'noise') {
  if (!siteId) return { pages: 0, merged: 0 };
  const seen = new Set();
  const add = (rows) => rows.forEach((r) => r.p && seen.add(r.p));
  add(await db.prepare('SELECT DISTINCT path p FROM events WHERE site_id = ?').all(siteId));
  add(await db.prepare('SELECT DISTINCT entry_path p FROM sessions WHERE site_id = ?').all(siteId));
  add(await db.prepare('SELECT DISTINCT exit_path p FROM sessions WHERE site_id = ?').all(siteId));
  add(await db.prepare('SELECT DISTINCT path p FROM snapshots WHERE site_id = ?').all(siteId));

  const writes = [];
  let merged = 0;
  for (const p of seen) {
    const clean = normalizePath(p, mode);
    if (clean === p) continue;
    merged++;
    writes.push({ sql: 'UPDATE events SET path = ? WHERE site_id = ? AND path = ?', args: [clean, siteId, p] });
    writes.push({ sql: 'UPDATE snapshots SET path = ? WHERE site_id = ? AND path = ?', args: [clean, siteId, p] });
    writes.push({ sql: 'UPDATE sessions SET entry_path = ? WHERE site_id = ? AND entry_path = ?', args: [clean, siteId, p] });
    writes.push({ sql: 'UPDATE sessions SET exit_path = ? WHERE site_id = ? AND exit_path = ?', args: [clean, siteId, p] });
  }
  for (let i = 0; i < writes.length; i += 80) await db.batch(writes.slice(i, i + 80));
  return { pages: seen.size, merged };
}

// ---------------------------------------------------------------- named access
// People, not links. Each entry is one person with their own password, scoped either to
// everything or to a single site, and revocable on its own.

const hashSecret = (password, salt = randomBytes(16).toString('hex')) =>
  `${salt}:${scryptSync(String(password), salt, 32).toString('hex')}`;

function secretMatches(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, want] = stored.split(':');
  const got = scryptSync(String(password), salt, 32).toString('hex');
  // Fixed-length hex on both sides, so a length mismatch cannot happen here.
  return got.length === want.length && timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
}

export async function listAccess(db) {
  const rows = await db.prepare('SELECT id, label, site_id, created_at, last_at FROM access ORDER BY created_at').all();
  return rows;
}

export async function createAccess(db, { label, siteId = '', password } = {}) {
  const pass = String(password || '').trim() || newKey(9);
  const row = {
    id: newKey(8),
    label: String(label || '').slice(0, 60) || 'Без назви',
    site_id: String(siteId || ''),
    secret: hashSecret(pass),
    token: newKey(24),
    created_at: Date.now(),
    last_at: 0
  };
  await db.prepare('INSERT INTO access (id, label, site_id, secret, token, created_at, last_at) VALUES (?,?,?,?,?,?,?)')
    .run(row.id, row.label, row.site_id, row.secret, row.token, row.created_at, row.last_at);
  return { ...row, password: pass };
}

export async function deleteAccess(db, id) {
  if (!id) return 0;
  await db.prepare('DELETE FROM access WHERE id = ?').run(String(id));
  return 1;
}

// A password is exchanged for a token once; the password itself is never stored by the
// browser and never travels on later requests.
export async function loginWithPassword(db, password) {
  if (!password) return null;
  const rows = await db.prepare('SELECT id, label, site_id, secret, token FROM access').all();
  for (const row of rows) {
    if (secretMatches(password, row.secret)) {
      await db.prepare('UPDATE access SET last_at = ? WHERE id = ?').run(Date.now(), row.id);
      return row;
    }
  }
  return null;
}

export async function getAccessByToken(db, token) {
  if (!token) return null;
  return (await db.prepare('SELECT id, label, site_id, token FROM access WHERE token = ?').get(token)) || null;
}

// Replaces the owner's 32-character key with a password of their choosing. The password lands
// in the same hashed table as everyone else's; the old key is only dropped once the new entry
// exists, so there is no moment where nobody can get in.
export async function setOwnerPassword(db, password) {
  const pass = String(password || '').trim();
  if (pass.length < 8) return { ok: false, error: 'Пароль має бути не коротшим за 8 символів' };
  if (tokenIsFromEnv()) {
    return { ok: false, error: 'Пароль задано змінною CONV_LENS_TOKEN у хостингу — міняйте його там' };
  }
  const existing = (await listAccess(db)).filter((a) => !a.site_id && a.label === OWNER_LABEL);
  const made = await createAccess(db, { label: OWNER_LABEL, siteId: '', password: pass });
  for (const old of existing) await deleteAccess(db, old.id);
  await db.prepare("DELETE FROM settings WHERE k = 'admin_token'").run();
  return { ok: true, token: made.token };
}

export const OWNER_LABEL = 'Власник';
