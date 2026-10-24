import { h, nf } from './charts.js';

// First run and per-site settings. Everything a site owner needs to change lives here,
// so nobody has to open a config file or write a regular expression.

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
    h('h2', {}, 'Налаштування сайту'),
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

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
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
    copyBox(d.snippet || '')
  ]);
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

  // --- adding another site
  const addName = input({ type: 'text', placeholder: 'Назва' });
  const addOrigin = input({ type: 'url', placeholder: 'https://інший-сайт.com' });
  const addPreset = select(presets.map((p) => [p.id, p.label]), 'shop');
  const addBtn = h('button', { class: 'primary', type: 'submit' }, 'Додати сайт');
  const addErr = h('p', { class: 'form-err', style: 'display:none' });
  const addForm = h('form', { class: 'card set-form' }, [
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
