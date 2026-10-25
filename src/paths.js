// What counts as "the same page". A site that appends ?v=8 to bust a cache has one page, not
// nine, and a report that says otherwise buries the real pages under noise.

// Cache busters, tracking tags and the dashboard's own markers. Structural parameters that
// genuinely select a page (OpenCart's route=, ?p=, ?id=) are deliberately not here.
const NOISE = new Set([
  'v', 'ver', 'version', 'rev', 't', 'ts', 'time', '_', 'cb', 'cache', 'cachebuster',
  'rand', 'random', 'nocache', 'replay', 'heatmap', 'cl',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid', 'si',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'ref_src', 'ref_url', 'at_medium', 'at_campaign'
]);

const isNoise = (k) => NOISE.has(k.toLowerCase()) || /^utm_/i.test(k);

export const PATH_MODES = [
  ['noise', 'прибирати технічні параметри (v, utm, fbclid…)'],
  ['all', 'прибирати всі параметри після ?'],
  ['keep', 'лишати адресу як є']
];

// `mode`: 'noise' (default), 'all', 'keep'.
export function normalizePath(raw, mode = 'noise') {
  const p = String(raw || '');
  if (!p) return p;
  const cut = p.indexOf('#');
  const noHash = cut >= 0 ? p.slice(0, cut) : p;
  const q = noHash.indexOf('?');
  if (q < 0) return noHash;
  if (mode === 'keep') return noHash;

  const base = noHash.slice(0, q);
  if (mode === 'all') return base || '/';

  const kept = [];
  for (const pair of noHash.slice(q + 1).split('&')) {
    if (!pair) continue;
    const key = pair.split('=')[0];
    if (!isNoise(decodeURIComponent(key))) kept.push(pair);
  }
  return kept.length ? `${base}?${kept.join('&')}` : (base || '/');
}
