// Config for one site. Nothing here lives in a file the owner has to edit:
// defaults + the chosen preset + whatever was changed in the dashboard, merged in that order.
import { presetConfig } from './presets.js';

export const DEFAULTS = {
  name: '',
  origin: '',
  preset: 'shop',
  currency: 'UAH',
  avgOrderValue: 1000,
  respectDnt: true,
  requireConsent: false,
  sampleRate: 1,
  retentionDays: 30,
  mousePathSampleMs: 120,
  snapshotMaxElements: 450,
  replayMode: 'snapshot',
  pathMode: 'noise',
  funnel: [],
  ctaSelectors: [],
  ctaText: '',
  autoTrack: [],
  apiErrorPaths: [],
  survey: { enabled: false, minSeconds: 25, paths: '', question: 'Що завадило оформити замовлення?', options: [], allowText: true }
};

// Keys the tracker is allowed to see. Everything else (retention, tokens, origins) stays server-side.
export const PUBLIC_KEYS = [
  'funnel', 'ctaSelectors', 'ctaText', 'autoTrack', 'survey', 'sampleRate',
  'respectDnt', 'requireConsent', 'mousePathSampleMs', 'snapshotMaxElements', 'currency', 'apiErrorPaths'
];

export function resolveConfig(site = {}) {
  let overrides = {};
  if (site.config) {
    try { overrides = typeof site.config === 'string' ? JSON.parse(site.config) : site.config; } catch {}
  }
  const preset = presetConfig(overrides.preset || DEFAULTS.preset);
  const cfg = { ...DEFAULTS, ...preset, ...overrides };
  cfg.survey = { ...DEFAULTS.survey, ...(overrides.survey || {}) };
  cfg.name = site.name || cfg.name;
  cfg.origin = site.origin || cfg.origin;
  cfg.siteUrl = cfg.origin;
  cfg.siteId = site.id;
  cfg.siteKey = site.site_key;
  return cfg;
}

export function publicConfig(cfg, endpoint) {
  const pub = {};
  for (const k of PUBLIC_KEYS) if (cfg[k] !== undefined) pub[k] = cfg[k];
  if (!pub.survey || !pub.survey.enabled) delete pub.survey;
  pub.site = cfg.siteKey;
  pub.endpoint = endpoint;
  return pub;
}
