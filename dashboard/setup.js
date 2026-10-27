import { h, nf } from './charts.js';
import { PATH_MODES } from './path-modes.js';

// First run and per-site settings. Everything a site owner needs to change lives here,
// so nobody has to open a config file or write a regular expression.

// Asks the server to look at the site instead of asking the owner what it runs on.
async function detect(url, siteId) {
  const q = new URLSearchParams({ url, ...(siteId ? { site: siteId } : {}) });
  const res = await fetch(`/api/detect?${q}`, { headers: keyHeader() });
  return res.json();
}

function keyHeader() {
  try {
    const k = localStorage.getItem('conv-lens-key');
    return k ? { Authorization: `Bearer ${k}` } : {};
  } catch { return {}; }
}

const table = (headers, rows) => h('div', { style: 'overflow:auto' }, h('table', {}, [
  h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows)
]));

const field = (label, input, hint) => h('label', { class: 'fld' }, [
  h('span', { class: 'fld-l' }, label),
  input,
  hint ? h('span', { class: 'fld-h' }, hint) : null
]);

const input = (attrs) => h('input', { class: 'inp', ...attrs });

function select(options, value, attrs = {}) {
  const el = h('select', { class: 'inp', ...attrs }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value == null ? '' : String(value);
  return el;
}

function copyBox(textValue) {
  const box = h('code', { class: 'snippet' }, textValue);
  const btn = h('button', { class: 'primary', type: 'button' }, 'Скопіювати');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textValue);
      btn.textContent = 'Скопійовано ✓';
    } catch {
      const r = document.createRange();
      r.selectNodeContents(box);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      btn.textContent = 'Виділено — Ctrl+C';
    }
    setTimeout(() => { btn.textContent = 'Скопіювати'; }, 2200);
  });
  return h('div', { class: 'snippet-row' }, [box, btn]);
}

// ---------------------------------------------------------------- first run

export function renderSetup(view, { presets, onDone }) {
  view.innerHTML = '';
  const origin = input({ type: 'url', placeholder: 'https://ваш-сайт.com', required: true, autocomplete: 'off' });
  const name = input({ type: 'text', placeholder: 'Назва, щоб ви його впізнали' });
  const preset = select(presets.map((p) => [p.id, p.label]), 'shop');
  const hint = h('p', { class: 'fld-h', style: 'margin:0' }, presets.find((p) => p.id === 'shop')?.hint || '');
  preset.addEventListener('change', () => { hint.textContent = presets.find((p) => p.id === preset.value)?.hint || ''; });
  const err = h('p', { class: 'form-err', style: 'display:none' });
  const submit = h('button', { class: 'primary', type: 'submit' }, 'Створити і показати код');

  const form = h('form', { class: 'card setup' }, [
    h('h2', {}, 'Вітаємо в Conv Lens'),
    h('p', { class: 'lead' }, 'Три поля — і ви отримаєте один рядок, який треба вставити на сайт. Більше нічого налаштовувати не потрібно.'),
    field('Адреса сайту', origin, 'Разом з https://. Саме з цього сайту приймаються дані.'),
    field('Назва', name, 'Необов’язково.'),
    field('Що це за сайт', preset, null),
    hint,
    err,
    submit
  ]);

  // Typing the address is enough: the server opens the site and preselects the type,
  // so there is one less question the owner has to know the answer to.
  const found = h('p', { class: 'inst', style: 'display:none' });
  form.insertBefore(found, err);
  let lastChecked = '';
  origin.addEventListener('blur', async () => {
    const v = origin.value.trim();
    if (!v || v === lastChecked) return;
    lastChecked = v;
    found.style.display = '';
    found.className = 'inst wait';
    found.textContent = 'Дивимось на сайт…';
    try {
      const d = await detect(v);
      if (!d.ok) { found.className = 'inst wait'; found.textContent = 'Не вдалось відкрити сайт: ' + d.error + '. Нічого страшного — виберіть тип самі.'; return; }
      preset.value = d.preset;
      preset.dispatchEvent(new Event('change'));
      if (!name.value.trim() && d.title) name.value = d.title;
      found.className = 'inst ok';
      found.textContent = `Схоже на: ${d.platform}. Тип підібрали — змініть, якщо не вгадали.`;
    } catch {
      found.style.display = 'none';
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.style.display = 'none';
    submit.disabled = true;
    submit.textContent = 'Створюємо…';
    try {
      const res = await fetch('api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: origin.value.trim(), name: name.value.trim(), preset: preset.value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'не вдалось');
      renderSetupDone(view, data, onDone);
    } catch (e) {
      err.textContent = 'Не вдалось: ' + e.message;
      err.style.display = '';
      submit.disabled = false;
      submit.textContent = 'Створити і показати код';
    }
  });

  view.appendChild(form);
  setTimeout(() => origin.focus(), 0);
}

function renderSetupDone(view, data, onDone) {
  const snippet = `<script src="${location.origin}/cl/t.js?s=${data.site.site_key}" defer></script>`;
  view.innerHTML = '';
  const go = h('button', { class: 'primary', type: 'button' }, 'Відкрити дашборд');
  go.addEventListener('click', () => onDone(data.token));
  view.appendChild(h('div', { class: 'card setup' }, [
    h('h2', {}, 'Готово. Залишився один рядок'),
    h('p', { class: 'lead' }, 'Вставте це на сайт перед закриваючим тегом </head> — на всіх сторінках.'),
    copyBox(snippet),
    h('h3', {}, 'Куди саме вставляти'),
    h('ul', { class: 'steps' }, [
      h('li', {}, 'WordPress: плагін у папці integrations/wordpress — вставте в нього лише ключ, нічого в коді шукати не треба.'),
      h('li', {}, 'Google Tag Manager: новий тег типу «Custom HTML», вставити рядок, тригер — All Pages.'),
      h('li', {}, 'Інші сайти: у шаблон, де вже є теги аналітики, або в налаштування теми «код у head».')
    ]),
    h('h3', {}, 'Ваш ключ доступу до дашборда'),
    h('p', { class: 'lead' }, 'Без нього дашборд не відкриється. Збережіть його в менеджері паролів — показуємо лише раз.'),
    copyBox(data.token),
    go
  ]));
}

// ---------------------------------------------------------------- settings

const FUNNEL_KINDS = [['path', 'адреса сторінки містить'], ['event', 'сталася подія'], ['any', 'будь-який візит']];

function funnelEditor(funnel) {
  const rows = h('div', { class: 'fn-rows' });
  const add = (step = {}) => {
    const m = step.match || {};
    const kind = m.any ? 'any' : m.event ? 'event' : 'path';
    const name = input({ type: 'text', value: step.name || '', placeholder: 'Назва кроку' });
    const kindSel = select(FUNNEL_KINDS, kind);
    const val = input({ type: 'text', value: m.event || m.path || '', placeholder: kind === 'event' ? 'назва події' : '/checkout' });
    const del = h('button', { class: 'ghost', type: 'button', title: 'Прибрати крок' }, '✕');
    const row = h('div', { class: 'fn-row' }, [name, kindSel, val, del]);
    const sync = () => { val.style.visibility = kindSel.value === 'any' ? 'hidden' : ''; };
    kindSel.addEventListener('change', sync);
    sync();
    del.addEventListener('click', () => row.remove());
    row.read = () => {
      const n = name.value.trim();
      if (!n) return null;
      const match = kindSel.value === 'any' ? { any: true }
        : kindSel.value === 'event' ? { event: val.value.trim() }
        : { path: val.value.trim() };
      if (kindSel.value !== 'any' && !(match.event || match.path)) return null;
      return { id: step.id || n.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) || 'step', name: n, match };
    };
    rows.appendChild(row);
  };
  (funnel || []).forEach(add);
  const addBtn = h('button', { class: 'ghost', type: 'button' }, '+ крок');
  addBtn.addEventListener('click', () => add({}));
  const el = h('div', {}, [
    h('div', { class: 'fn-head' }, [h('span', {}, 'Крок'), h('span', {}, 'Коли зараховуємо'), h('span', {}, 'Значення'), h('span', {})]),
    rows,
    addBtn
  ]);
  el.read = () => [...rows.children].map((r) => r.read()).filter(Boolean);
  return el;
}

export async function renderSettings(view, ctx) {
  const { api, apiPost, presets } = ctx;
  const d = await api('site');
  const cfg = d.config || {};
  const site = d.site || {};
  let usage = null;
  try { usage = await api('storage'); } catch {}

  view.innerHTML = '';

  const name = input({ type: 'text', value: site.name || '' });
  const origin = input({ type: 'url', value: site.origin || '' });
  const preset = select(presets.map((p) => [p.id, p.label]), cfg.preset || 'shop');
  const currency = input({ type: 'text', value: cfg.currency || '', placeholder: 'UAH' });
  const aov = input({ type: 'number', value: cfg.avgOrderValue ?? '', min: '0', step: '1' });
  const retention = select([[7, '7 днів'], [14, '14 днів'], [30, '30 днів'], [60, '60 днів'], [90, '90 днів']], cfg.retentionDays || 30);
  const sample = select([[1, 'усі відвідувачі'], [0.5, 'половина'], [0.25, 'чверть'], [0.1, 'десята частина']], cfg.sampleRate ?? 1);
  const replayMode = select([['snapshot', 'зі знімка верстки'], ['live', 'відкривати справжню сторінку']], cfg.replayMode || 'snapshot');
  const pathMode = select(PATH_MODES, cfg.pathMode || 'noise');
  const dnt = h('input', { type: 'checkbox', ...(cfg.respectDnt ? { checked: 'checked' } : {}) });
  const fn = funnelEditor(cfg.funnel);
  const ctaSel = input({ type: 'text', value: (cfg.ctaSelectors || []).join(', '), placeholder: '[data-cl-cta], .buy-button' });

  const surveyOn = h('input', { type: 'checkbox', ...(cfg.survey?.enabled ? { checked: 'checked' } : {}) });
  const surveyQ = input({ type: 'text', value: cfg.survey?.question || '', placeholder: 'Що завадило оформити замовлення?' });
  const surveyOpts = h('textarea', { class: 'inp', rows: '5', placeholder: 'Одна причина на рядок' }, (cfg.survey?.options || []).join('\n'));

  const saved = h('span', { class: 'saved', style: 'display:none' }, 'Збережено ✓');
  const err = h('p', { class: 'form-err', style: 'display:none' });
  const save = h('button', { class: 'primary', type: 'submit' }, 'Зберегти');

  const presetHint = h('span', { class: 'fld-h' }, presets.find((p) => p.id === (cfg.preset || 'shop'))?.hint || '');
  preset.addEventListener('change', () => {
    presetHint.textContent = presets.find((p) => p.id === preset.value)?.hint || '';
  });

  const form = h('form', { class: 'card set-form' }, [
    h('h2', {}, `Налаштування сайту «${site.name || site.id}»`),
    h('p', { class: 'lead' }, 'Ці поля змінюють саме цей сайт. Щоб завести ще один, скористайтесь формою '
      + '«Ще один сайт» унизу сторінки — інакше новий сайт писатиме дані в цей.'),
    h('div', { class: 'grid2' }, [
      field('Назва', name),
      field('Адреса сайту', origin, 'З цього домену приймаються дані.')
    ]),
    h('div', { class: 'grid2' }, [
      field('Тип сайту', preset, null),
      field('Валюта', currency)
    ]),
    presetHint,
    h('p', { class: 'fld-h' }, 'Зміна типу сайту перезапише кроки фунела нижче лише після збереження з порожнім фунелом; інакше ваші кроки лишаються.'),
    h('div', { class: 'grid2' }, [
      field('Середній чек', aov, 'Потрібен, щоб оцінювати втрати в грошах.'),
      field('Зберігати дані', retention, 'Старші сесії видаляються автоматично.')
    ]),
    h('div', { class: 'grid2' }, [
      field('Записувати', sample, 'На великому трафіку достатньо частини.'),
      h('label', { class: 'fld chk' }, [dnt, h('span', {}, 'Не записувати тих, хто просив не відслідковувати (Do Not Track)')])
    ]),
    field('Що вважати однією сторінкою', pathMode,
      'Якщо сайт додає до адреси ?v=8 чи utm-мітки, це та сама сторінка. Інакше у звітах замість '
      + 'однієї сторінки будуть десятки її версій.'),
    field('Як відтворювати сесії', replayMode,
      'Знімок верстки працює завжди. «Справжня сторінка» потрібна лише сайтам, де головне намальовано на canvas або в 3D: сторінка відкривається у фреймі і керується через тег Conv Lens, тому вона має публікувати window.__replay.'),
    h('h3', {}, 'Кроки фунела'),
    h('p', { class: 'fld-h' }, 'Порядок має значення: що нижче, то глибше в фунелі. «Адреса містить» — це частина URL, наприклад /checkout.'),
    fn,
    h('h3', {}, 'Головні кнопки'),
    field('Селектори CTA', ctaSel, 'Через кому. Якщо не знаєте — лишіть як є, кнопки ловляться і за текстом.'),
    h('h3', {}, 'Опитування тих, хто пішов'),
    h('label', { class: 'fld chk' }, [surveyOn, h('span', {}, 'Питати причину, коли людина збирається піти')]),
    field('Питання', surveyQ),
    field('Варіанти відповіді', surveyOpts),
    err,
    h('div', { class: 'row-actions' }, [save, saved])
  ]);

  const originWas = site.origin || '';
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // Repointing a site that already has data is how two different websites end up sharing one
    // bucket: the reports keep the old site's sessions while the name says something else.
    const originNow = origin.value.trim();
    if (originNow !== originWas && (d.install?.sessions || 0) > 0) {
      const ok = confirm(
        `У цього сайту вже є ${nf(d.install.sessions)} записаних сесій з ${originWas || 'попередньої адреси'}.\n\n`
        + 'Зміна адреси їх не переносить і не видаляє — вони залишаться тут, під новою назвою.\n\n'
        + 'Якщо ви хочете підключити ІНШИЙ сайт, не міняйте адресу: скористайтесь формою «Ще один сайт» унизу.\n\n'
        + 'Все одно змінити адресу?');
      if (!ok) { origin.value = originWas; return; }
    }
    err.style.display = 'none';
    save.disabled = true;
    try {
      await apiPost('site', {
        name: name.value.trim(),
        origin: origin.value.trim(),
        config: {
          preset: preset.value,
          currency: currency.value.trim(),
          avgOrderValue: Number(aov.value) || 0,
          retentionDays: Number(retention.value) || 30,
          sampleRate: Number(sample.value) || 1,
          replayMode: replayMode.value,
          pathMode: pathMode.value,
          respectDnt: dnt.checked,
          funnel: fn.read(),
          ctaSelectors: ctaSel.value.split(',').map((s) => s.trim()).filter(Boolean),
          survey: {
            enabled: surveyOn.checked,
            question: surveyQ.value.trim(),
            options: surveyOpts.value.split('\n').map((s) => s.trim()).filter(Boolean)
          }
        }
      });
      saved.style.display = '';
      setTimeout(() => { saved.style.display = 'none'; }, 2000);
      ctx.onChange?.();
    } catch (e) {
      err.textContent = 'Не збереглось: ' + e.message;
      err.style.display = '';
    }
    save.disabled = false;
  });

  view.appendChild(form);

  // --- the snippet, always one click away, with a plain answer to "did it work?"
  const inst = d.install || {};
  const fresh = inst.lastEventAt && Date.now() - inst.lastEventAt < 30 * 60000;
  const status = inst.sessions
    ? h('p', { class: 'inst ok' }, fresh
        ? `Код працює: дані приходять, останні — ${new Date(inst.lastEventAt).toLocaleString('uk-UA')}.`
        : `Дані були, але давно — останні ${new Date(inst.lastEventAt).toLocaleString('uk-UA')}. Перевірте, чи код ще стоїть на сайті.`)
    : h('p', { class: 'inst wait' }, 'Жодної події ще не прийшло. Вставте рядок на сайт, відкрийте будь-яку його сторінку і натисніть «Оновити».');

  const snippetCard = h('div', { class: 'card set-form' }, [
    h('h2', {}, 'Код для сайту'),
    h('p', { class: 'lead' }, 'Один рядок перед </head> на всіх сторінках. Якщо вже вставлений — нічого робити не треба.'),
    status,
    copyBox(d.snippet || ''),
    d.connect ? h('div', {}, [
      h('h3', {}, 'Або один код підключення'),
      h('p', { class: 'lead' }, 'Для плагіна WordPress та інших інтеграцій: вставте цей рядок в єдине поле — адреса і ключ усередині.'),
      copyBox(d.connect)
    ]) : null
  ]);
  // "Did I paste it right?" answered by looking at the page, not by waiting for data.
  const checkOut = h('p', { class: 'inst', style: 'display:none' });
  const check = h('button', { class: 'primary', type: 'button' }, 'Перевірити встановлення');
  check.addEventListener('click', async () => {
    check.disabled = true;
    checkOut.style.display = '';
    checkOut.className = 'inst wait';
    checkOut.textContent = 'Відкриваємо сайт і шукаємо код…';
    try {
      const r = await detect(site.origin || '', site.id);
      if (!r.ok) {
        checkOut.className = 'inst wait';
        checkOut.textContent = 'Не вдалось відкрити сайт: ' + r.error;
      } else if (!r.tag.found) {
        checkOut.className = 'inst wait';
        checkOut.textContent = 'Код на сторінці не знайдено. Перевірте, що ви вставили рядок саме на цей сайт і зберегли зміни.';
      } else if (r.tag.placeholder) {
        checkOut.className = 'inst wait';
        checkOut.textContent = 'Код стоїть, але в ньому лишився приклад замість ваших значень — замініть адресу та ключ на ті, що вище.';
      } else if (r.tag.otherKey) {
        checkOut.className = 'inst wait';
        checkOut.textContent = 'Код стоїть, але з ключем іншого сайту — дані пишуться не сюди. Замініть рядок на той, що вище.';
      } else {
        checkOut.className = 'inst ok';
        checkOut.textContent = `Код на місці і ключ правильний. Платформа: ${r.platform}.`;
      }
    } catch (e) {
      checkOut.className = 'inst wait';
      checkOut.textContent = 'Не вдалось перевірити: ' + e.message;
    }
    check.disabled = false;
  });
  snippetCard.appendChild(h('div', { class: 'row-actions' }, [check]));
  snippetCard.appendChild(checkOut);

  const rotate = h('button', { class: 'ghost', type: 'button' }, 'Замінити ключ сайту');
  rotate.addEventListener('click', async () => {
    if (!confirm('Старий код на сайті перестане працювати, доки ви не вставите новий. Замінити ключ?')) return;
    try {
      const r = await apiPost('site/key', {});
      snippetCard.replaceChild(copyBox(r.snippet || ''), snippetCard.querySelector('.snippet-row'));
      ctx.onChange?.();
    } catch (e) { alert('Не вдалось: ' + e.message); }
  });
  snippetCard.appendChild(h('p', { class: 'fld-h' }, 'Знадобиться, якщо ключ потрапив не туди, куди слід.'));
  snippetCard.appendChild(rotate);
  view.appendChild(snippetCard);

  // --- apply the page rule to history too
  {
    const out = h('p', { class: 'inst', style: 'display:none' });
    const btn = h('button', { class: 'ghost', type: 'button' }, 'Почистити вже записані адреси');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.style.display = '';
      out.className = 'inst wait';
      out.textContent = 'Чистимо…';
      try {
        const r = await apiPost('site/clean-paths', {});
        out.className = 'inst ok';
        out.textContent = r.merged
          ? `Готово: ${nf(r.merged)} адрес зведено до ${nf(r.pages - r.merged)} справжніх сторінок. Натисніть «Оновити».`
          : 'Нічого чистити — усі адреси вже у правильному вигляді.';
      } catch (e) {
        out.className = 'inst wait';
        out.textContent = 'Не вдалось: ' + e.message;
      }
      btn.disabled = false;
    });
    view.appendChild(h('div', { class: 'card set-form' }, [
      h('h2', {}, 'Адреси сторінок'),
      h('p', { class: 'lead' }, 'Правило вище діє на нові дані. Натисніть, щоб застосувати його і до вже записаних — '
        + 'версії однієї сторінки зіллються в одну.'),
      out, btn
    ]));
  }

  // --- a link to hand to whoever owns this site
  if (d.viewUrl) {
    const shareBox = h('div', { class: 'card set-form' }, [
      h('h2', {}, 'Доступ для клієнта'),
      h('p', { class: 'lead' }, 'Це посилання відкриває дашборд лише цього сайту і лише на перегляд: '
        + 'інші сайти, налаштування і видалення записів за ним недоступні. Можна давати стороннім.'),
      copyBox(d.viewUrl)
    ]);
    const reset = h('button', { class: 'ghost', type: 'button' }, 'Відкликати доступ');
    reset.addEventListener('click', async () => {
      if (!confirm('Стара адреса перестане працювати в усіх, кому ви її давали. Видати нову?')) return;
      try {
        const r = await apiPost('site/view-key', {});
        shareBox.replaceChild(copyBox(r.viewUrl || ''), shareBox.querySelector('.snippet-row'));
      } catch (e) { alert('Не вдалось: ' + e.message); }
    });
    shareBox.appendChild(h('p', { class: 'fld-h' }, 'Відкликання видає нову адресу замість старої.'));
    shareBox.appendChild(reset);
    view.appendChild(shareBox);
  }

  // --- data recorded before this instance knew about sites
  const orph = d.orphans || {};
  if (orph.sessions || orph.events) {
    const out = h('p', { class: 'inst wait' },
      `У базі є ${nf(orph.sessions)} сесій і ${nf(orph.events)} подій без привʼязки до сайту — `
      + 'найчастіше це дані, записані до переїзду на окрему Conv Lens. Зараз вони в жодному звіті не видно.');
    const btn = h('button', { class: 'primary', type: 'button' }, 'Прийняти їх у цей сайт');
    btn.addEventListener('click', async () => {
      if (!confirm(`Усі ${nf(orph.sessions)} сесій без привʼязки стануть даними сайту «${site.name}». Продовжити?`)) return;
      btn.disabled = true;
      let moved = 0;
      try {
        for (let pass = 0; pass < 200; pass++) {
          const r = await apiPost('site/adopt', {});
          moved += r.moved || 0;
          btn.textContent = `Переносимо… ${nf(moved)}`;
          if (!r.remaining) break;
        }
        out.className = 'inst ok';
        out.textContent = `Готово: ${nf(moved)} сесій тепер належать цьому сайту. Натисніть «Оновити», щоб побачити їх у звітах.`;
        btn.remove();
      } catch (e) {
        out.textContent = 'Не вдалось: ' + e.message;
        btn.disabled = false;
        btn.textContent = 'Спробувати ще раз';
      }
    });
    view.appendChild(h('div', { class: 'card set-form' }, [
      h('h2', {}, 'Дані без сайту'),
      out,
      btn
    ]));
  }

  // --- how much space this site takes
  if (usage) {
    const mb = (b) => (b ? (b / 1048576).toFixed(1) + ' МБ' : '—');
    view.appendChild(h('div', { class: 'card set-form' }, [
      h('h2', {}, 'Місце в базі'),
      h('table', {}, h('tbody', {}, [
        h('tr', {}, [h('td', {}, 'Сесії'), h('td', { class: 'num' }, nf(usage.sessions?.n || 0))]),
        h('tr', {}, [h('td', {}, 'Події'), h('td', { class: 'num' }, `${nf(usage.events?.n || 0)} · ${mb(usage.events?.bytes)}`)]),
        h('tr', {}, [h('td', {}, 'Рухи мишки і скрол'), h('td', { class: 'num' }, `${nf(usage.moves?.n || 0)} · ${mb(usage.moves?.bytes)}`)]),
        h('tr', {}, [h('td', {}, 'Знімки сторінок'), h('td', { class: 'num' }, `${nf(usage.snapshots?.n || 0)} · ${mb(usage.snapshots?.bytes)}`)]),
        usage.fileBytes ? h('tr', {}, [h('td', {}, 'Файл бази цілком'), h('td', { class: 'num' }, mb(usage.fileBytes))]) : null
      ])),
      h('p', { class: 'fld-h' }, 'Найбільше місця забирають рухи мишки. Якщо база росте швидко — зменште «Записувати» або термін зберігання.')
    ]));
  }

  // --- the owner's own password
  {
    const pass1 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Новий пароль' });
    const pass2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Ще раз' });
    const out = h('p', { class: 'inst', style: 'display:none' });
    const btn = h('button', { class: 'primary', type: 'submit' }, 'Змінити пароль');
    const form2 = h('form', { class: 'card set-form' }, [
      h('h2', {}, 'Ваш пароль'),
      h('p', { class: 'lead' }, 'Зараз ви заходите довгим ключем, який видав майстер. Його можна замінити на '
        + 'звичайний пароль. Після зміни старий ключ перестане працювати — на всіх пристроях.'),
      h('div', { class: 'grid2' }, [field('Новий пароль', pass1), field('Підтвердження', pass2)]),
      out,
      btn
    ]);
    form2.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      out.style.display = 'none';
      if (pass1.value !== pass2.value) {
        out.className = 'inst wait'; out.style.display = ''; out.textContent = 'Паролі не збігаються.';
        return;
      }
      if (pass1.value.trim().length < 8) {
        out.className = 'inst wait'; out.style.display = ''; out.textContent = 'Хоча б 8 символів.';
        return;
      }
      if (!confirm('Старий ключ перестане працювати одразу, зокрема там, де ви вже увійшли. Продовжити?')) return;
      btn.disabled = true;
      try {
        const r = await apiPost('owner-password', { password: pass1.value.trim() });
        // The reply carries the new session token, so this browser stays logged in.
        try { localStorage.setItem('conv-lens-key', r.token); } catch {}
        out.className = 'inst ok';
        out.style.display = '';
        out.textContent = 'Пароль змінено. Цей браузер лишається в системі; на інших треба увійти наново.';
        pass1.value = ''; pass2.value = '';
      } catch (e) {
        out.className = 'inst wait';
        out.style.display = '';
        out.textContent = e.message;
      }
      btn.disabled = false;
    });
    view.appendChild(form2);
  }

  // --- who may open this dashboard
  {
    const card = h('div', { class: 'card set-form' }, [
      h('h2', {}, 'Хто має доступ'),
      h('p', { class: 'lead' }, 'Кожен запис — це одна людина зі своїм паролем. Пароль показується один раз. '
        + 'Щоб закрити комусь доступ, приберіть його запис — решта працюватимуть далі.')
    ]);
    const listBox = h('div', {});
    const out = h('p', { class: 'inst', style: 'display:none' });

    const draw = async () => {
      listBox.innerHTML = '';
      let d2;
      try { d2 = await api('access'); } catch (e) { listBox.appendChild(h('p', { class: 'fld-h' }, 'Не вдалось завантажити: ' + e.message)); return; }
      const rows = d2.access || [];
      if (!rows.length) {
        listBox.appendChild(h('p', { class: 'fld-h' }, 'Поки доступ має лише власник — ви, за своїм ключем.'));
      } else {
        listBox.appendChild(table(['Кому', 'Що бачить', 'Створено', 'Останній вхід', ''],
          rows.map((a) => {
            const del = h('button', { class: 'ghost', type: 'button' }, 'Прибрати');
            del.addEventListener('click', async () => {
              if (!confirm(`Закрити доступ для «${a.label}»? Його пароль перестане працювати одразу.`)) return;
              try { await apiPost('access/delete', { id: a.id }); await draw(); }
              catch (e) { alert('Не вдалось: ' + e.message); }
            });
            const when = (ms) => (ms ? new Date(ms).toLocaleDateString('uk-UA') : '—');
            return h('tr', {}, [
              h('td', {}, a.label),
              h('td', {}, a.scope),
              h('td', {}, when(a.created_at)),
              h('td', {}, a.last_at ? when(a.last_at) : 'ще не заходив'),
              h('td', {}, del)
            ]);
          })));
      }

      const who = input({ type: 'text', placeholder: 'Імʼя або компанія' });
      const scope = select([['', 'усі сайти (повний доступ)'], ...(d2.sites || []).map((x) => [x.id, 'лише ' + x.name])], '');
      const pass = input({ type: 'text', placeholder: 'Лишіть порожнім — згенеруємо' });
      const addBtn = h('button', { class: 'primary', type: 'submit' }, 'Видати доступ');
      const addForm = h('form', { style: 'margin-top:16px' }, [
        h('h3', {}, 'Видати доступ'),
        h('div', { class: 'grid2' }, [field('Кому', who), field('Що зможе бачити', scope)]),
        field('Пароль', pass, 'Запишіть його — показуємо лише зараз.'),
        addBtn
      ]);
      addForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!who.value.trim()) { who.focus(); return; }
        addBtn.disabled = true;
        try {
          const r = await apiPost('access', { label: who.value.trim(), siteId: scope.value, password: pass.value.trim() });
          out.className = 'inst ok';
          out.style.display = '';
          out.innerHTML = '';
          out.append(`Доступ для «${r.access.label}» створено. Пароль (показуємо один раз): `);
          out.appendChild(h('b', {}, r.password));
          await draw();
        } catch (e) {
          out.className = 'inst wait';
          out.style.display = '';
          out.textContent = 'Не вдалось: ' + e.message;
        }
        addBtn.disabled = false;
      });
      listBox.appendChild(addForm);
    };

    card.appendChild(out);
    card.appendChild(listBox);
    view.appendChild(card);
    draw();
  }

  // --- adding another site
  const addName = input({ type: 'text', placeholder: 'Назва' });
  const addOrigin = input({ type: 'url', placeholder: 'https://інший-сайт.com' });
  const addPreset = select(presets.map((p) => [p.id, p.label]), 'shop');
  const addBtn = h('button', { class: 'primary', type: 'submit' }, 'Додати сайт');
  const addErr = h('p', { class: 'form-err', style: 'display:none' });
  const addForm = h('form', { class: 'card set-form', id: 'addSiteForm' }, [
    h('h2', {}, 'Ще один сайт'),
    h('p', { class: 'lead' }, 'Та сама програма обслуговує скільки треба сайтів — у кожного свій код і свої дані.'),
    h('div', { class: 'grid2' }, [field('Назва', addName), field('Адреса', addOrigin)]),
    field('Тип сайту', addPreset),
    addErr,
    addBtn
  ]);
  addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    addErr.style.display = 'none';
    addBtn.disabled = true;
    try {
      const r = await apiPost('sites', { name: addName.value.trim(), origin: addOrigin.value.trim(), preset: addPreset.value });
      ctx.onAdded?.(r.site);
    } catch (e) {
      addErr.textContent = 'Не вдалось: ' + e.message;
      addErr.style.display = '';
    }
    addBtn.disabled = false;
  });
  view.appendChild(addForm);
}
