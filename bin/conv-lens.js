#!/usr/bin/env node
// Conv Lens command line. `serve` is all most people ever need: the dashboard walks
// through adding a site and hands over the snippet to paste.
import { createApp } from '../server/node.js';
import { openDb, purgeOld, storageKind } from '../src/db.js';
import { listSites, createSite, getSite, siteConfig, adminToken, setSetting, newKey } from '../src/store.js';
import { snippetFor } from '../src/router.js';
import { seed } from '../src/seed.js';
import { buildInsights } from '../src/insights.js';
import { buildFilter, overview, funnel, formAnalytics, segments, sources, deviceBreakdown } from '../src/aggregate.js';
import { PRESET_LIST } from '../src/presets.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'serve';
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const C = { b: '\x1b[1m', dim: '\x1b[2m', r: '\x1b[0m', red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', cyn: '\x1b[36m' };
const SEV = { critical: `${C.red}критично${C.r}`, serious: `${C.red}серйозно${C.r}`, warning: `${C.yel}увага${C.r}`, info: `${C.cyn}інфо${C.r}` };
const money = (n, cur) => new Intl.NumberFormat('uk-UA').format(Math.round(n)) + ' ' + (cur || '');

const dataFile = String(flag('db', process.env.CONV_LENS_DB_URL || './data/conv-lens.db'));
const db = () => openDb({ url: dataFile });

// The site a command works on: --site, or the only site there is.
async function pickSite(d) {
  const want = flag('site', '');
  if (want && want !== true) {
    const s = await getSite(d, String(want));
    if (!s) die(`Немає сайту «${want}». Подивитись список: conv-lens sites`);
    return s;
  }
  const all = await listSites(d);
  if (!all.length) die('Жодного сайту ще немає. Додати: conv-lens add --origin https://ваш-сайт.com');
  if (all.length > 1) die(`Сайтів кілька — вкажіть --site <id>:\n  ${all.map((s) => s.id).join('\n  ')}`);
  return all[0];
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (cmd === 'serve') {
  const port = Number(flag('port', process.env.PORT || 8777));
  const host = String(flag('host', '127.0.0.1'));
  const previewOrigin = flag('preview', '') === true ? '' : String(flag('preview', ''));
  const d = await db();
  const sites = await listSites(d);
  let token = await adminToken(d);
  // A fresh instance stays open so the dashboard can run the setup wizard. As soon as there
  // are sites, a key is required — otherwise anyone who reaches the port reads the data.
  if (!token && sites.length) {
    token = newKey(16);
    await setSetting(d, 'admin_token', token);
    console.log(`\n  ${C.yel}Дашборд був без ключа — створив новий:${C.r} ${C.b}${token}${C.r}`);
    console.log(`  ${C.dim}змінити: conv-lens key --set <свій-ключ>${C.r}`);
  }
  const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

  const { server } = createApp({ dataFile, previewOrigin, previewSiteKey: sites[0] ? sites[0].site_key : '' });
  server.listen(port, host, () => {
    console.log(`\n${C.b}conv-lens${C.r} ${C.dim}· сховище: ${storageKind()}${C.r}`);
    console.log(`  дашборд:  ${C.cyn}${base}/${token ? `?key=${token}` : ''}${C.r}`);
    if (!sites.length) {
      console.log(`\n  ${C.yel}Сайтів ще немає.${C.r} Відкрийте дашборд — він за три кроки запитає адресу,`);
      console.log('  тип сайту і видасть рядок, який треба вставити на сайт.');
    } else {
      console.log(`\n  ${C.b}Сайти${C.r}`);
      for (const s of sites) {
        console.log(`  ${String(s.id).padEnd(20)} ${C.dim}${s.origin || '—'}${C.r}`);
        console.log(`  ${C.dim}  код для вставки:${C.r} ${snippetFor(siteConfig(s), base)}`);
      }
    }
    if (previewOrigin) console.log(`\n  ${C.b}Dry-run${C.r}: ${base}/live  ${C.dim}(${previewOrigin} через Conv Lens, без правок на сайті)${C.r}`);
    console.log('');
  });
} else if (cmd === 'add') {
  const d = await db();
  const origin = String(flag('origin', '') || '');
  const name = String(flag('name', '') || origin);
  const preset = String(flag('preset', 'shop'));
  if (!origin && !name) die('Вкажіть --origin https://ваш-сайт.com');
  if (!PRESET_LIST.some((p) => p.id === preset)) {
    die(`Невідомий тип «${preset}». Доступні:\n  ${PRESET_LIST.map((p) => `${p.id.padEnd(12)} ${p.label}`).join('\n  ')}`);
  }
  const site = await createSite(d, { name, origin, preset });
  if (!(await adminToken(d))) {
    const token = newKey(16);
    await setSetting(d, 'admin_token', token);
    console.log(`Ключ дашборда: ${C.b}${token}${C.r}  ${C.dim}(збережіть — без нього дашборд не відкриється)${C.r}`);
  }
  console.log(`Сайт додано: ${C.b}${site.id}${C.r}`);
  console.log(`Вставте на сайт перед </head>:\n  ${C.cyn}${snippetFor(siteConfig(site), '')}${C.r}`);
  console.log(`${C.dim}Замініть ВАШ-CONV-LENS на адресу, де працює ця програма.${C.r}`);
} else if (cmd === 'sites') {
  const d = await db();
  const sites = await listSites(d);
  if (!sites.length) console.log('Сайтів ще немає. Додати: conv-lens add --origin https://ваш-сайт.com');
  for (const s of sites) {
    const cfg = siteConfig(s);
    console.log(`\n${C.b}${s.id}${C.r}  ${s.name}`);
    console.log(`  адреса:  ${s.origin || '—'}`);
    console.log(`  тип:     ${cfg.preset}`);
    console.log(`  ключ:    ${s.site_key}`);
    console.log(`  код:     ${snippetFor(cfg, '')}`);
  }
  console.log('');
} else if (cmd === 'key') {
  const d = await db();
  const set = flag('set', '');
  if (set && set !== true) {
    await setSetting(d, 'admin_token', String(set));
    console.log('Ключ дашборда змінено');
  } else if (set === true) {
    const token = newKey(16);
    await setSetting(d, 'admin_token', token);
    console.log(`Новий ключ дашборда: ${C.b}${token}${C.r}`);
  } else {
    console.log((await adminToken(d)) || '(ключа немає — дашборд відкритий)');
  }
} else if (cmd === 'seed') {
  const d = await db();
  let site = (await listSites(d))[0];
  if (!site) site = await createSite(d, { name: 'Демо-магазин', origin: 'https://chrono.ua', preset: 'shop' });
  const days = Number(flag('days', 14));
  const perDay = Number(flag('per-day', 64));
  const t = Date.now();
  const res = await seed(d, siteConfig(site), { days, perDay });
  console.log(`Згенеровано ${res.sessions} сесій, ${res.orders} замовлень за ${days} днів (${Date.now() - t} мс)`);
  console.log(`Сайт: ${site.id}   База: ${dataFile}`);
} else if (cmd === 'purge') {
  const d = await db();
  const site = await pickSite(d);
  const days = Number(flag('days', siteConfig(site).retentionDays || 30));
  const n = await purgeOld(d, days, site.id);
  console.log(`Видалено сесій старших за ${days} днів: ${n}`);
} else if (cmd === 'report') {
  const d = await db();
  const site = await pickSite(d);
  const cfg = siteConfig(site);
  const days = Number(flag('days', 14));
  const device = flag('device', '');
  const f = buildFilter({
    from: Date.now() - days * 86400000, to: Date.now(),
    device: device && device !== true ? device : undefined,
    siteId: site.id
  });
  const ov = await overview(d, cfg, f);
  const fn = await funnel(d, cfg, f);
  const ins = await buildInsights(d, cfg, f);

  console.log(`\n${C.b}CONV-LENS — чому не купують${C.r} ${C.dim}(${site.name}, останні ${days} днів)${C.r}\n`);
  console.log(`  Сесій: ${C.b}${ov.sessions}${C.r}   Замовлень: ${C.b}${ov.orders}${C.r}   Конверсія: ${C.b}${ov.cr}%${C.r}   Дохід: ${money(ov.revenue, ov.currency)}`);
  console.log(`  Середній чек: ${money(ov.aov, ov.currency)}   Відмови: ${ov.bounceRate}%   Середній фрикшн: ${ov.avgFriction}/100\n`);

  console.log(`${C.b}ФУНЕЛ${C.r}`);
  const maxN = Math.max(...fn.steps.map((s) => s.reached), 1);
  for (const s of fn.steps) {
    const bar = '█'.repeat(Math.max(1, Math.round((s.reached / maxN) * 34)));
    const drop = s.dropRate > 0 ? `${C.dim}зупинились тут: ${s.dropped} (${s.dropRate}%)${C.r}` : '';
    const hit = s.index > 0 ? `${C.dim}факт. візитів ${s.hit}${C.r}` : '';
    console.log(`  ${String(s.name).padEnd(16)} ${C.cyn}${bar}${C.r} ${String(s.reached).padStart(5)}  ${String(s.shareOfTotal + '%').padStart(6)}  ${hit.padEnd(26)} ${drop}`);
  }

  console.log(`\n${C.b}ДІАГНОЗИ${C.r} ${C.dim}оцінка втрат: ${money(ins.estimatedLost.low, ov.currency)} – ${money(ins.estimatedLost.high, ov.currency)} (причини перетинаються)${C.r}`);
  ins.insights.forEach((i, n) => {
    console.log(`\n  ${C.b}${n + 1}. ${i.title}${C.r}  [${SEV[i.severity]}]`);
    console.log(`     ${i.detail}`);
    if (i.lost.orders > 0) console.log(`     ${C.dim}оцінка втрат: ~${i.lost.orders} замовлень ≈ ${money(i.lost.money, ov.currency)}${C.r}`);
    i.evidence.slice(0, 4).forEach((e) => console.log(`     ${C.dim}·${C.r} ${e.label}: ${e.value}`));
    console.log(`     ${C.grn}→ ${i.action}${C.r}`);
    if (i.sessions.length) console.log(`     ${C.dim}записи: ${i.sessions.slice(0, 3).join(', ')}${C.r}`);
  });

  const fields = (await formAnalytics(d, f, 6)).filter((x) => x.abandonedHere || x.errors);
  if (fields.length) {
    console.log(`\n${C.b}ФОРМА${C.r}`);
    fields.forEach((x) => console.log(`  ${String(x.label || x.field).padEnd(22)} обриви: ${String(x.abandonedHere).padStart(3)}  помилки: ${String(x.errors).padStart(3)}  правок: ${x.correctionRate}%  час: ${x.avgSeconds} с`));
  }

  const seg = (await segments(d, f)).features.filter((x) => x.delta > 5).slice(0, 6);
  if (seg.length) {
    console.log(`\n${C.b}ЧИМ ВІДРІЗНЯЮТЬСЯ ТІ, ХТО НЕ КУПИВ${C.r}`);
    seg.forEach((x) => console.log(`  ${String(x.label).padEnd(38)} не купили ${String(x.nonConverters + '%').padStart(6)}  купили ${String(x.converters + '%').padStart(6)}  ${C.yel}+${x.delta} п.п.${C.r}`));
  }

  const dev = await deviceBreakdown(d, f);
  console.log(`\n${C.b}ПРИСТРОЇ${C.r}`);
  dev.forEach((x) => console.log(`  ${String(x.device).padEnd(10)} сесій ${String(x.sessions).padStart(5)}  CR ${String(x.cr + '%').padStart(6)}  LCP ${x.lcp} мс  фрикшн ${x.friction}`));

  const src = (await sources(d, f)).slice(0, 8);
  console.log(`\n${C.b}КАНАЛИ${C.r}`);
  src.forEach((s) => console.log(`  ${String(s.source + ' / ' + s.medium).padEnd(28)} сесій ${String(s.sessions).padStart(5)}  CR ${String(s.cr + '%').padStart(6)}  відмов ${s.bounceRate}%`));
  console.log('');
} else {
  console.log(`conv-lens — діагностика конверсії для будь-якого сайту

  conv-lens serve                       запустити дашборд і колектор
    --port 8777 --host 127.0.0.1
    --preview https://сайт.com          dry-run: чужий сайт через Conv Lens на /live

  conv-lens add --origin https://сайт.com [--name «Магазин»] [--preset shop]
  conv-lens sites                       список сайтів, ключів і кодів для вставки
  conv-lens key [--set <ключ>]          показати або змінити ключ дашборда
  conv-lens seed [--days 14]            демо-дані, щоб побачити дашборд наповненим
  conv-lens report [--days 14]          текстовий діагноз у термінал
  conv-lens purge [--days 30]           прибрати старі сесії

  --db <шлях|libsql://…>                де лежить база (типово ./data/conv-lens.db)
  --site <id>                           на якому сайті працювати

  Типи сайтів (--preset):
    ${PRESET_LIST.map((p) => `${p.id.padEnd(12)} ${p.label}`).join('\n    ')}`);
}
