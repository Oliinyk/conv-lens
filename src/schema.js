// One SQLite schema for every backend. `sites` makes a single deployment serve many websites:
// every row in sessions/events/snapshots carries the site it belongs to.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites(
  id TEXT PRIMARY KEY, name TEXT, origin TEXT, site_key TEXT UNIQUE,
  created_at INTEGER, config TEXT
);
CREATE TABLE IF NOT EXISTS settings(
  k TEXT PRIMARY KEY, v TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, site_id TEXT, visitor_id TEXT, started_at INTEGER, last_at INTEGER, duration INTEGER DEFAULT 0,
  entry_path TEXT, exit_path TEXT, referrer TEXT, source TEXT, medium TEXT, campaign TEXT,
  device TEXT, browser TEXT, os TEXT, vw INTEGER, vh INTEGER, touch INTEGER DEFAULT 0,
  country TEXT, city TEXT, region TEXT, lang TEXT, ip TEXT, ip_hash TEXT, is_bot INTEGER DEFAULT 0,
  pageviews INTEGER DEFAULT 0, event_count INTEGER DEFAULT 0,
  max_step INTEGER DEFAULT 0, max_step_id TEXT, converted INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0, currency TEXT,
  rage INTEGER DEFAULT 0, dead INTEGER DEFAULT 0, js_errors INTEGER DEFAULT 0,
  net_errors INTEGER DEFAULT 0, validation_errors INTEGER DEFAULT 0, slow_inter INTEGER DEFAULT 0,
  zooms INTEGER DEFAULT 0, hscroll INTEGER DEFAULT 0, backtracks INTEGER DEFAULT 0,
  exit_intents INTEGER DEFAULT 0, thrash INTEGER DEFAULT 0,
  lcp REAL, cls REAL, inp REAL, ttfb REAL,
  max_depth INTEGER DEFAULT 0, cta_seen INTEGER DEFAULT 0, cta_clicked INTEGER DEFAULT 0,
  last_field TEXT, abandon_path TEXT, friction REAL DEFAULT 0, identity TEXT, has_replay INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, site_id TEXT, ts INTEGER, seq INTEGER,
  type TEXT, path TEXT, sel TEXT, label TEXT, name TEXT, num REAL, data TEXT
);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, site_id TEXT, ts INTEGER, path TEXT,
  device TEXT, w INTEGER, h INTEGER, vw INTEGER, vh INTEGER, data BLOB
);
CREATE INDEX IF NOT EXISTS ix_ev_sess ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS ix_ev_type ON events(site_id, type, ts);
CREATE INDEX IF NOT EXISTS ix_ev_path ON events(site_id, path, type);
CREATE INDEX IF NOT EXISTS ix_sess_start ON sessions(site_id, started_at);
CREATE INDEX IF NOT EXISTS ix_sess_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS ix_sess_ip ON sessions(ip);
CREATE INDEX IF NOT EXISTS ix_snap_path ON snapshots(site_id, path, device);
`;

// Columns that older Conv Lens databases (the single-site version) do not have yet.
// Each is applied on its own and a "duplicate column" error is the expected no-op.
export const MIGRATIONS = [
  'ALTER TABLE sessions ADD COLUMN site_id TEXT',
  'ALTER TABLE sessions ADD COLUMN ip TEXT',
  'ALTER TABLE sessions ADD COLUMN city TEXT',
  'ALTER TABLE sessions ADD COLUMN region TEXT',
  'ALTER TABLE events ADD COLUMN site_id TEXT',
  'ALTER TABLE snapshots ADD COLUMN site_id TEXT'
];
