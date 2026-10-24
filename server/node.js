// Conv Lens on plain node:http — what `conv-lens serve` runs.
// Serves the dashboard, the tracker and the collector, and can proxy a live site
// for a dry run before the snippet is installed anywhere.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { handle } from '../src/router.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DASH = join(ROOT, 'dashboard');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2'
};

function readBody(req, limit = 900000) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
  .split(',')[0].trim();

export function createApp(opts = {}) {
  const dbOpts = { url: opts.dataFile || process.env.CONV_LENS_DB_URL || './data/conv-lens.db' };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const publicOrigin = opts.publicOrigin || `${proto}://${req.headers.host}`;

    const send = (out) => {
      res.writeHead(out.status, out.headers || {});
      res.end(out.body ?? '');
    };

    if (p.startsWith('/cl/') || p.startsWith('/api/')) {
      const route = p.startsWith('/cl/') ? p.slice(4) : p.slice(5);
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        try { body = await readBody(req); } catch { return send({ status: 413, headers: {}, body: '' }); }
      }
      const out = await handle({
        method: req.method, route, body,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers, ip: clientIp(req)
      }, { db: dbOpts, publicOrigin });
      return send(out);
    }

    // Dry run: proxy a real site through Conv Lens with the tracker injected, so the
    // funnel can be checked before anything is installed on the site itself.
    if (opts.previewOrigin && (p === '/live' || p.startsWith('/live/'))) {
      const rest = p === '/live' ? '/' : p.slice(5) || '/';
      const target = opts.previewOrigin.replace(/\/$/, '') + rest + (url.search || '');
      const passBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      let body = null;
      if (passBody) { try { body = await readBody(req, 2000000); } catch { body = null; } }
      let upstream;
      try {
        upstream = await fetch(target, {
          method: req.method,
          headers: {
            'user-agent': req.headers['user-agent'] || '',
            accept: req.headers.accept || '*/*',
            'accept-language': req.headers['accept-language'] || 'uk,en;q=0.8',
            ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
            ...(req.headers.cookie ? { cookie: req.headers.cookie } : {})
          },
          body: passBody ? body : undefined,
          redirect: 'follow'
        });
      } catch (e) {
        return send({ status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Не вдалось отримати сторінку: ' + e.message });
      }
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      if (ct.includes('text/html')) {
        let html = await upstream.text();
        const key = opts.previewSiteKey ? `?s=${opts.previewSiteKey}` : '';
        const inject = `<script>window.convLensConfig=Object.assign({endpoint:'/cl/collect',previewMode:true},window.convLensConfig||{});</script><script src="/cl/t.js${key}"></script>`;
        html = html.includes('</head>') ? html.replace('</head>', inject + '</head>') : inject + html;
        return send({ status: upstream.status, headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' }, body: html });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return send({ status: upstream.status, headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' }, body: buf });
    }

    // Dashboard. Access is checked by the API, not here: the page itself only asks for the key.
    const file = p === '/' ? join(DASH, 'index.html') : resolve(join(DASH, p));
    if (!file.startsWith(resolve(DASH)) || !existsSync(file)) {
      return send({ status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'not found' });
    }
    const body = await readFile(file);
    return send({ status: 200, headers: { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, body });
  });

  return { server };
}
