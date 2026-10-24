import { overview, funnel, elementFriction, formAnalytics, errorList, speed, segments, sources, deviceBreakdown, surveyAnswers, ctaVisibility, exitPaths } from './aggregate.js';

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

async function sample(db, f, extraSql, args = [], limit = 5) {
  try {
    return (await db.prepare(`SELECT s.id FROM sessions s WHERE ${f.sql} AND ${extraSql}
      ORDER BY s.friction DESC, s.max_step DESC LIMIT ?`).all(...f.args, ...args, limit)).map((r) => r.id);
  } catch { return []; }
}

function lostOrders(affected, segCr, baseCr, aov) {
  const gap = Math.max(0, baseCr - segCr);
  const orders = (affected * gap) / 100;
  return { orders: Math.round(orders * 10) / 10, money: Math.round(orders * aov) };
}

export async function buildInsights(db, cfg, f) {
  const ov = (await overview(db, cfg, f));
  const fn = (await funnel(db, cfg, f));
  const aov = ov.aov || cfg.avgOrderValue || 0;
  const baseCr = ov.cr;
  const out = [];
  const add = (i) => { if (i) out.push(i); };

  if (ov.sessions < 20) {
    add({
      id: 'low-data', severity: 'info', title: 'Даних поки мало',
      detail: `Зібрано ${ov.sessions} сесій. Для надійних висновків треба хоча б 200–300 сесій або 2 тижні трафіку.`,
      affected: ov.sessions, lost: { orders: 0, money: 0 }, evidence: [], sessions: [], action: 'Почекати накопичення даних'
    });
  }

  const steps = fn.steps.filter((s) => s.index > 0);
  const worst = steps.reduce((a, b) => (b.dropped > (a?.dropped || 0) ? b : a), null);
  if (worst && worst.dropped >= 3) {
    const prev = fn.steps[worst.index - 1];
    add({
      id: 'funnel-drop', severity: worst.dropRate > 70 ? 'critical' : 'serious',
      title: `Найбільша втрата на кроці «${worst.name}»`,
      detail: `${worst.dropped} сесій (${worst.dropRate}% тих, хто дійшов) зупиняються саме тут і далі не йдуть. З кроку «${prev.name}» на наступний переходить лише ${prev.conversionToNext}%.`,
      affected: worst.dropped,
      lost: lostOrders(worst.dropped, 0, baseCr, aov),
      evidence: [
        { label: 'Дійшли до кроку', value: worst.reached },
        { label: 'Залишились тут назавжди', value: worst.dropped },
        { label: 'Частка від усього трафіку', value: worst.shareOfTotal + '%' },
        { label: 'Фактично були на цьому кроці', value: worst.hit }
      ],
      sessions: (await sample(db, f, 's.max_step = ? AND s.converted = 0', [worst.index])),
      action: `Переглянути 5 записів сесій, які обірвались на «${worst.name}»`
    });
  }

  const els = (await elementFriction(db, f, 12));
  const topRage = els.filter((e) => e.rage >= 2).sort((a, b) => b.rage - a.rage)[0];
  if (topRage) {
    const segCr = pct(topRage.sessions - topRage.lost_sessions, topRage.sessions);
    add({
      id: 'rage-element', severity: topRage.rage >= 6 ? 'critical' : 'serious',
      title: `Люди нервово клікають: «${topRage.label || topRage.sel}»`,
      detail: `${topRage.rage} серій швидких повторних кліків по одному елементу на ${topRage.path}. Так клікають, коли елемент не реагує або реагує не так, як очікували.`,
      affected: topRage.sessions,
      lost: lostOrders(topRage.sessions, segCr, baseCr, aov),
      evidence: [
        { label: 'Селектор', value: topRage.sel },
        { label: 'Rage-кліків', value: topRage.rage },
        { label: 'З них не купили', value: `${topRage.lost_sessions} з ${topRage.sessions}` }
      ],
      sessions: (await sample(db, f, 's.rage > 0 AND s.converted = 0')),
      action: 'Перевірити цей елемент на тому ж девайсі та браузері, що в записах'
    });
  }

  const topDead = els.filter((e) => e.dead >= 3).sort((a, b) => b.dead - a.dead)[0];
  if (topDead) {
    add({
      id: 'dead-element', severity: 'warning',
      title: `Клікають по тому, що не клікається: «${topDead.label || topDead.sel}»`,
      detail: `${topDead.dead} кліків по елементу, який нічого не робить (${topDead.path}). Класика для годинників: фото моделі, бейдж «в наявності», блок характеристик, ціна — люди думають, що це посилання.`,
      affected: topDead.sessions,
      lost: lostOrders(topDead.sessions, 0, baseCr * 0.5, aov),
      evidence: [
        { label: 'Селектор', value: topDead.sel },
        { label: 'Мертвих кліків', value: topDead.dead },
        { label: 'Сесій', value: topDead.sessions }
      ],
      sessions: (await sample(db, f, 's.dead > 0')),
      action: 'Зробити елемент клікабельним або прибрати візуальні ознаки клікабельності'
    });
  }

  const errs = (await errorList(db, f, 8));
  const topJs = errs.js.filter((e) => e.sessions >= 2)[0];
  if (topJs) {
    const segCr = pct(topJs.sessions - topJs.lost, topJs.sessions);
    add({
      id: 'js-error', severity: topJs.sessions >= 10 ? 'critical' : 'serious',
      title: `JS-помилка ламає сценарій у ${topJs.sessions} сесіях`,
      detail: `«${topJs.msg}» — ${topJs.n} разів. Не купили ${topJs.lost} з ${topJs.sessions}. Браузери: ${topJs.browsers || 'різні'}.`,
      affected: topJs.sessions,
      lost: lostOrders(topJs.sessions, segCr, baseCr, aov),
      evidence: [
        { label: 'Файл', value: topJs.src || '—' },
        { label: 'Сторінки', value: (topJs.paths || '').split(',').slice(0, 3).join(', ') },
        { label: 'Конверсія в сегменті', value: segCr + '% проти ' + baseCr + '% загалом' }
      ],
      sessions: (await sample(db, f, 's.js_errors > 0 AND s.converted = 0')),
      action: 'Відтворити помилку у вказаному браузері на вказаній сторінці'
    });
  }

  const topNet = errs.net.filter((e) => e.sessions >= 2)[0];
  if (topNet) {
    const segCr = pct(topNet.sessions - topNet.lost, topNet.sessions);
    add({
      id: 'net-error', severity: 'critical',
      title: `Запит падає з кодом ${topNet.status || 'network fail'}`,
      detail: `${topNet.url} — ${topNet.n} невдалих запитів у ${topNet.sessions} сесіях. Якщо це додавання в кошик або оформлення, людина натискає кнопку і не отримує нічого.`,
      affected: topNet.sessions,
      lost: lostOrders(topNet.sessions, segCr, baseCr, aov),
      evidence: [
        { label: 'URL', value: topNet.url },
        { label: 'Статус', value: topNet.status || 'немає відповіді' },
        { label: 'Не купили', value: `${topNet.lost} з ${topNet.sessions}` }
      ],
      sessions: (await sample(db, f, 's.net_errors > 0')),
      action: 'Перевірити цей ендпоінт під навантаженням і в кеші CDN'
    });
  }

  const forms = (await formAnalytics(db, f, 20));
  const topAbandon = forms.filter((x) => x.abandonedHere >= 2).sort((a, b) => b.abandonedHere - a.abandonedHere)[0];
  if (topAbandon) {
    add({
      id: 'form-abandon', severity: 'serious',
      title: `Форма обривається на полі «${topAbandon.label || topAbandon.field}»`,
      detail: `${topAbandon.abandonedHere} людей останнім торкались саме цього поля і пішли. Середній час у полі ${topAbandon.avgSeconds} с, виправлень ${topAbandon.correctionRate}% натискань, помилок валідації ${topAbandon.errors}.`,
      affected: topAbandon.abandonedHere,
      lost: lostOrders(topAbandon.abandonedHere, 0, baseCr * 3, aov),
      evidence: [
        { label: 'Поле', value: topAbandon.field },
        { label: 'Сторінка', value: topAbandon.path },
        { label: 'Приклад помилки', value: topAbandon.errorSample || '—' }
      ],
      sessions: (await sample(db, f, 's.last_field = ? AND s.converted = 0', [topAbandon.field])),
      action: 'Спростити поле: маска, автозаповнення, зрозумілий текст помилки або зробити необов’язковим'
    });
  }

  const loopField = forms.filter((x) => x.errors >= 3 && x.correctionRate > 25).sort((a, b) => b.errors - a.errors)[0];
  if (loopField && loopField.field !== topAbandon?.field) {
    add({
      id: 'validation-loop', severity: 'warning',
      title: `Поле «${loopField.label || loopField.field}» не приймає те, що вводять`,
      detail: `${loopField.errors} помилок валідації, ${loopField.correctionRate}% натискань — це стирання введеного. Людина переписує значення по колу.`,
      affected: loopField.sessions,
      lost: lostOrders(loopField.sessions, 0, baseCr, aov),
      evidence: [
        { label: 'Текст помилки', value: loopField.errorSample || '—' },
        { label: 'Середній час у полі', value: loopField.avgSeconds + ' с' },
        { label: 'Залишають порожнім', value: loopField.leftEmptyRate + '%' }
      ],
      sessions: (await sample(db, f, 's.validation_errors > 0 AND s.converted = 0')),
      action: 'Приймати телефон у будь-якому форматі й нормалізувати на бекенді'
    });
  }

  const devs = (await deviceBreakdown(db, f));
  const mobile = devs.find((d) => d.device === 'mobile');
  const desktop = devs.find((d) => d.device === 'desktop');
  if (mobile && desktop && mobile.sessions >= 15 && mobile.cr < desktop.cr * 0.6) {
    add({
      id: 'mobile-gap', severity: 'critical',
      title: `Мобільні конвертують у ${desktop.cr && mobile.cr ? Math.round((desktop.cr / Math.max(mobile.cr, 0.1)) * 10) / 10 : '∞'} рази гірше`,
      detail: `Мобільні: ${mobile.cr}% з ${mobile.sessions} сесій. Десктоп: ${desktop.cr}% з ${desktop.sessions}. Для магазину годинників це зазвичай незручна картка товару або форма оформлення на вузькому екрані.`,
      affected: mobile.sessions,
      lost: lostOrders(mobile.sessions, mobile.cr, desktop.cr, aov),
      evidence: [
        { label: 'Горизонтальний скрол', value: `${mobile.hscroll} сесій` },
        { label: 'Зум сторінки', value: `${mobile.zooms} сесій` },
        { label: 'LCP мобільний', value: mobile.lcp + ' мс' },
        { label: 'Не побачили CTA', value: `${mobile.cta_unseen} сесій` }
      ],
      sessions: (await sample(db, f, "s.device = 'mobile' AND s.converted = 0")),
      action: 'Пройти шлях «картка → кошик → оформлення» на реальному телефоні'
    });
  }

  const cta = (await ctaVisibility(db, f)).filter((c) => c.belowFold && c.sessions >= 3)[0];
  if (cta) {
    add({
      id: 'cta-below-fold', severity: 'warning',
      title: `Кнопку «${cta.label || cta.sel}» видно лише після скролу`,
      detail: `На ${cta.path} (${cta.device}) кнопка в середньому на ${cta.avg_y} px від верху, а екран — ${cta.fold} px. Частина людей її просто не бачить.`,
      affected: cta.sessions,
      lost: lostOrders(cta.sessions, 0, baseCr, aov),
      evidence: [
        { label: 'Позиція кнопки', value: cta.avg_y + ' px' },
        { label: 'Висота екрана', value: cta.fold + ' px' },
        { label: 'Сесій', value: cta.sessions }
      ],
      sessions: (await sample(db, f, 's.cta_seen = 0 AND s.max_step >= 2')),
      action: 'Підняти кнопку вище або додати липку кнопку купівлі на мобільному'
    });
  }

  const sp = (await speed(db, f));
  const good = sp.buckets.find((b) => b.bucket === 'good');
  const poor = sp.buckets.find((b) => b.bucket === 'poor');
  if (good && poor && poor.sessions >= 10 && poor.cr < good.cr * 0.7) {
    add({
      id: 'speed-conversion', severity: 'serious',
      title: 'Повільні завантаження з’їдають конверсію',
      detail: `При LCP понад 4 с конверсія ${poor.cr}%, при LCP до 2.5 с — ${good.cr}%. Повільних сесій ${poor.sessions}.`,
      affected: poor.sessions,
      lost: lostOrders(poor.sessions, poor.cr, good.cr, aov),
      evidence: [
        { label: 'Середній LCP у поганій групі', value: poor.lcp + ' мс' },
        { label: 'Глибина скролу', value: `${poor.depth}% проти ${good.depth}%` },
        { label: 'Найповільніша сторінка', value: sp.byPath[0] ? `${sp.byPath[0].path} — ${sp.byPath[0].lcp} мс` : '—' }
      ],
      sessions: (await sample(db, f, 's.lcp > 4000 AND s.converted = 0')),
      action: 'Оптимізувати найповільніші сторінки зі списку у вкладці «Швидкість»'
    });
  }

  const srcs = (await sources(db, f));
  const deadSource = srcs.filter((s) => s.sessions >= 15 && s.orders === 0).sort((a, b) => b.sessions - a.sessions)[0];
  if (deadSource) {
    add({
      id: 'dead-source', severity: 'warning',
      title: `Канал ${deadSource.source} / ${deadSource.medium} не дає жодного замовлення`,
      detail: `${deadSource.sessions} сесій, 0 покупок, відмов ${deadSource.bounceRate}%, середній час ${deadSource.dwell} с. Або трафік нецільовий, або сторінка входу не відповідає обіцянці.`,
      affected: deadSource.sessions,
      lost: lostOrders(deadSource.sessions, 0, baseCr, aov),
      evidence: [
        { label: 'Відмови', value: deadSource.bounceRate + '%' },
        { label: 'Середній час', value: deadSource.dwell + ' с' },
        { label: 'Фрикшн', value: deadSource.friction }
      ],
      sessions: (await sample(db, f, 's.source = ? AND s.converted = 0', [deadSource.source])),
      action: 'Звірити обіцянку в об’яві/сніпеті з тим, що людина бачить на сторінці входу'
    });
  }

  if (ov.bounceRate > 45 && ov.sessions >= 30) {
    add({
      id: 'instant-exit', severity: 'serious',
      title: `${ov.bounceRate}% йдуть майже відразу`,
      detail: `Люди закривають сторінку за секунди і без скролу. Це майже завжди невідповідність очікуванням: не та модель, не та ціна, не той регіон доставки — або сторінка довго не показує контент.`,
      affected: Math.round((ov.bounceRate / 100) * ov.sessions),
      lost: lostOrders(Math.round((ov.bounceRate / 100) * ov.sessions), 0, baseCr, aov),
      evidence: [
        { label: 'Середня глибина скролу', value: ov.avgDepth + '%' },
        { label: 'Середній час', value: ov.avgDuration + ' с' },
        { label: 'Топ сторінка виходу', value: (await exitPaths(db, f, 1))[0]?.path || '—' }
      ],
      sessions: (await sample(db, f, 's.duration < 10000 AND s.converted = 0')),
      action: 'Перевірити відповідність сторінок входу запитам і швидкість першого екрана'
    });
  }

  const seg = (await segments(db, f));
  const topSeg = seg.features.filter((x) => x.delta >= 12 && x.affected >= 5)[0];
  if (topSeg && !out.some((i) => i.id.includes(topSeg.key))) {
    add({
      id: 'segment-' + topSeg.key, severity: 'warning',
      title: `Ті, хто не купив, набагато частіше: ${topSeg.label.toLowerCase()}`,
      detail: `Серед тих, хто не купив, це ${topSeg.nonConverters}% сесій, серед покупців — ${topSeg.converters}%. Різниця ${topSeg.delta} п.п.`,
      affected: topSeg.affected,
      lost: lostOrders(topSeg.affected, 0, baseCr, aov),
      evidence: [
        { label: 'Не купили', value: topSeg.nonConverters + '%' },
        { label: 'Купили', value: topSeg.converters + '%' },
        { label: 'Сесій під ознакою', value: topSeg.affected }
      ],
      sessions: (await sample(db, f, 's.converted = 0')),
      action: 'Дивитись записи сесій саме з цією ознакою'
    });
  }

  const sv = (await surveyAnswers(db, f));
  if (sv.answered >= 5) {
    const top = sv.grouped[0];
    add({
      id: 'survey', severity: 'info',
      title: `Найчастіша відповідь в опитуванні: «${top.answer}»`,
      detail: `${top.n} з ${sv.answered} відповідей. Опитування показали ${sv.shown} разів — відповідають ${pct(sv.answered, sv.shown)}%.`,
      affected: sv.answered,
      lost: { orders: 0, money: 0 },
      evidence: sv.grouped.slice(0, 4).map((g) => ({ label: g.answer, value: g.n })),
      sessions: [],
      action: 'Читати коментарі своїми словами у вкладці «Опитування»'
    });
  }

  const rank = { critical: 0, serious: 1, warning: 2, info: 3 };
  out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.lost.money - a.lost.money));
  const sum = out.reduce((a, b) => a + (b.lost.money || 0), 0);
  const top = out.reduce((a, b) => Math.max(a, b.lost.money || 0), 0);
  return {
    generatedAt: Date.now(), baseCr, aov, currency: cfg.currency, sessions: ov.sessions,
    insights: out,
    estimatedLost: { low: top, high: sum, note: 'Причини перетинаються: одна сесія може страждати від кількох. Нижня межа — найбільша окрема причина, верхня — сума всіх.' }
  };
}
