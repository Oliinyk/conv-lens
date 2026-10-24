// Sites and instance settings. One deployment of Conv Lens serves any number of sites;
// each one is a row here with its own public key and its own config.
import { randomBytes } from 'node:crypto';
import { resolveConfig } from './config.js';

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
  return db.prepare('SELECT id, name, origin, site_key, created_at, config FROM sites ORDER BY created_at').all();
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
    created_at: Date.now(),
    config: JSON.stringify({ preset, ...config })
  };
  await db.prepare('INSERT INTO sites (id, name, origin, site_key, created_at, config) VALUES (?,?,?,?,?,?)')
    .run(site.id, site.name, site.origin, site.site_key, site.created_at, site.config);
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
