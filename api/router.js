// Vercel adapter. All it does is translate the platform's request/response into the
// plain objects src/router.js works with, so there is no second copy of the logic.
import { handle } from '../src/router.js';

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 900000) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  const q = { ...req.query };
  delete q.route;

  // Every /api/* and /cl/* path is rewritten here by vercel.json, which passes the original
  // path in __p. Relying on the platform's own dynamic-segment parameter did not work:
  // a catch-all matched one segment only, so /api/site/adopt came back 404.
  // The rewrite passes the original path in __p and, because it is a named capture, Vercel
  // repeats it under the capture's own name. Both are dropped: a leaked "path" once became a
  // page filter and silently emptied the session list.
  const fromRewrite = q.__p;
  delete q.__p;
  delete q.__clpath;
  let route = Array.isArray(fromRewrite) ? fromRewrite.join('/') : String(fromRewrite || '');
  if (!route) {
    const url = new URL(req.url || '/', 'http://localhost');
    route = url.pathname.replace(/^\/+(api|cl)\/+/, '').replace(/^\/+|\/+$/g, '');
  }
  route = route.replace(/^\/+|\/+$/g, '');

  let body = null;
  if (req.method === 'POST' || req.method === 'PUT') {
    try { body = await rawBody(req); } catch { res.status(413).end(); return; }
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const publicOrigin = process.env.CONV_LENS_PUBLIC_URL || `${proto}://${req.headers.host}`;
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();

  const out = await handle({ method: req.method, route, query: q, body, headers: req.headers, ip }, { publicOrigin });

  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).send(out.body ?? '');
}
