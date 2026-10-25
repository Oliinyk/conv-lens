(function () {
  if (window.__convLens) return;
  var W = window, D = document, N = navigator;

  // One <script src="https://lens.example.com/cl/t.js?s=SITEKEY"> is the whole install:
  // the site key and the collector URL are read from the tag when no inline config was set.
  var SELF = D.currentScript || (function () { var t = D.getElementsByTagName('script'); return t[t.length - 1]; })();
  var SELFQ = {};
  try {
    var selfUrl = new URL((SELF && SELF.src) || '', location.href);
    selfUrl.searchParams.forEach(function (v, k) { SELFQ[k] = v; });
    SELFQ.origin = selfUrl.origin;
  } catch (e) {}

  var CFG = W.convLensConfig || {};
  if (!CFG.site && (SELFQ.s || SELFQ.site)) CFG.site = SELFQ.s || SELFQ.site;
  if (!CFG.endpoint && SELFQ.origin && SELFQ.origin !== location.origin) CFG.endpoint = SELFQ.origin + '/cl/collect';
  var SITE = CFG.site || '';
  var ENDPOINT = CFG.endpoint || '/cl/collect';
  var SAMPLE = CFG.sampleRate == null ? 1 : CFG.sampleRate;
  var MOUSE_MS = CFG.mousePathSampleMs || 120;
  var SNAP_MAX = CFG.snapshotMaxElements || 450;
  var FUNNEL = CFG.funnel || [];
  var CTA = (CFG.ctaSelectors || []).join(',');
  var SURVEY = CFG.survey || {};

  // Replay mode: the dashboard opened this page inside its player. Nothing is tracked here —
  // instead we expose a bridge so the player can drive the page from another domain, which is
  // the only way a canvas or WebGL scene can be replayed (a DOM snapshot cannot capture it).
  // A page opts in by publishing window.__replay = { ready, apply(state), theme(dark), forceBuilt() }.
  if (/[?&]replay=1/.test(location.search)) {
    var allowed = SELFQ.origin || '';
    var answered = false;
    var send = function (msg) {
      try { (W.parent || W).postMessage(Object.assign({ __convLensReplay: true }, msg), allowed || '*'); } catch (e) {}
    };
    W.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.__convLensReplay !== true || ev.source !== W.parent) return;
      if (allowed && ev.origin !== allowed) return;
      var api = W.__replay;
      if (m.op === 'ping') { send({ op: 'ready', has: !!(api && api.ready) }); return; }
      if (!api) return;
      try {
        if (m.op === 'apply' && api.apply) api.apply(m.st || {});
        else if (m.op === 'scroll') W.scrollTo(0, m.y || 0);
        else if (m.op === 'theme' && api.theme) api.theme(!!m.dark);
        else if (m.op === 'forceBuilt' && api.forceBuilt) api.forceBuilt();
      } catch (e) {}
    });
    // The page may publish its API after this script runs, so announce readiness when it appears.
    var tries = 0;
    var watch = setInterval(function () {
      tries++;
      if (W.__replay && W.__replay.ready && !answered) { answered = true; send({ op: 'ready', has: true }); }
      if (answered || tries > 100) clearInterval(watch);
    }, 100);
    send({ op: 'ready', has: !!(W.__replay && W.__replay.ready) });
    W.__convLens = { replayBridge: true };
    return;
  }

  if (CFG.respectDnt !== false && (N.doNotTrack === '1' || W.doNotTrack === '1')) return;

  var queue = [], sid = null, vid = null, consent = !CFG.requireConsent;
  var startedAt = Date.now(), pageStart = Date.now(), flushTimer = null;
  var path = location.pathname, seq = 0, sent = 0;
  var snapped = {}, surveyShown = false, lastInteractive = 0;

  function uid() {
    var a = new Uint8Array(9);
    (W.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function ss(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; }
  }

  vid = ls('cl_vid');
  if (!vid) { vid = uid(); ls('cl_vid', vid); }
  var prev = ss('cl_sid'), prevTs = +(ss('cl_sid_ts') || 0);
  if (prev && Date.now() - prevTs < 30 * 60000) sid = prev;
  else { sid = uid(); ss('cl_sid', sid); }
  ss('cl_sid_ts', String(Date.now()));

  if (SAMPLE < 1) {
    var h = 0; for (var i = 0; i < vid.length; i++) h = (h * 31 + vid.charCodeAt(i)) % 1000;
    if (h / 1000 >= SAMPLE) return;
  }

  function deviceType() {
    var w = W.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1100) return 'tablet';
    return 'desktop';
  }
  function trim(s, n) { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

  var UTIL = /^(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|gap|space|text|bg|border|rounded|font|leading|tracking|shadow|opacity|z|top|left|right|bottom|inset|flex|grid|col|row|order|items|justify|self|place|content|object|overflow|whitespace|break|cursor|select|resize|list|appearance|outline|ring|divide|transition|duration|delay|ease|animate|scale|rotate|translate|skew|origin|fill|stroke|aspect|basis|grow|shrink|sr|touch|pointer|backdrop|blur|from|via|to|decoration|indent|table|float|clear|hover|focus|active|disabled|group|peer|sm|md|lg|xl|dark|first|last|odd|even|motion|print|align|snap|scroll|caret|accent)-|^(?:flex|grid|block|inline|inline-flex|inline-block|hidden|absolute|relative|fixed|sticky|static|container|truncate|italic|underline|uppercase|lowercase|capitalize|border|rounded|shadow|transition|transform|isolate|visible|invisible|antialiased|group|peer)$/;

  function classesOf(node) {
    return (node.getAttribute('class') || '').split(/\s+/).filter(function (c) {
      if (!c || c.length > 40) return false;
      if (/[:\[\]\/!%]/.test(c)) return false;
      if (UTIL.test(c)) return false;
      if (/^(is-|has-|active|hover|focus|open|js-)/.test(c)) return false;
      if (/[0-9]{4,}/.test(c)) return false;
      return true;
    }).slice(0, 2);
  }
  function nthOf(node) {
    var p = node.parentNode;
    if (!p || !p.children) return '';
    var sibs = Array.prototype.filter.call(p.children, function (c) { return c.tagName === node.tagName; });
    return sibs.length > 1 ? ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')' : '';
  }
  function partOf(node, isLeaf) {
    var tag = node.tagName.toLowerCase();
    if (node.id && !/^[0-9]/.test(node.id) && node.id.length < 40 && !/[0-9a-f]{8,}/i.test(node.id)) return '#' + node.id;
    var tid = node.getAttribute('data-testid') || node.getAttribute('data-test') || node.getAttribute('data-qa');
    if (tid) return '[data-testid="' + trim(tid, 40) + '"]';
    var cls = classesOf(node);
    if (cls.length) return tag + '.' + cls.join('.');
    var al = node.getAttribute('aria-label');
    if (al && al.length < 40) return tag + '[aria-label="' + trim(al, 40) + '"]';
    var nm = node.getAttribute('name');
    if (nm) return tag + '[name="' + trim(nm, 40) + '"]';
    if (isLeaf && /^(BUTTON|A)$/.test(node.tagName)) {
      var txt = trim(node.innerText || node.textContent, 36);
      if (txt) return tag + ':has-text("' + txt + '")';
    }
    if (tag === 'input' && node.type) return 'input[type="' + node.type + '"]' + nthOf(node);
    return tag + nthOf(node);
  }
  function selectorOf(el) {
    if (!el || el === D.body || el.nodeType !== 1) return 'body';
    if (el.getAttribute && el.getAttribute('data-cl')) return '[data-cl="' + el.getAttribute('data-cl') + '"]';
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 4 && node !== D.body) {
      var p = partOf(node, depth === 0);
      parts.unshift(p);
      if (p.charAt(0) === '#' || p.indexOf('[data-testid') === 0) break;
      node = node.parentNode; depth++;
    }
    return parts.join('>').slice(0, 180);
  }
  function labelOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var t = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
    if (!t && el.tagName === 'INPUT') t = el.getAttribute('placeholder') || el.getAttribute('name') || el.type;
    if (!t && el.tagName === 'IMG') t = el.getAttribute('alt');
    if (!t) t = el.innerText || el.textContent;
    return trim(t, 60);
  }
  function isInteractive(el) {
    var n = el;
    for (var d = 0; n && n.nodeType === 1 && d < 4; d++, n = n.parentNode) {
      var tag = n.tagName;
      if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|OPTION)$/.test(tag)) return true;
      if (n.getAttribute && (n.getAttribute('onclick') || n.getAttribute('role') === 'button' || n.hasAttribute('data-cl-cta'))) return true;
      try { if (getComputedStyle(n).cursor === 'pointer') return true; } catch (e) {}
    }
    return false;
  }

  function push(type, data) {
    if (!consent) return;
    queue.push({ t: type, ts: Date.now(), p: path, s: ++seq, d: data || {} });
    if (queue.length >= 40) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 5000);
  }
  function envelope(items) {
    return JSON.stringify({
      site: SITE,
      sid: sid, vid: vid, href: location.href, path: path, ref: D.referrer || '',
      title: trim(D.title, 80), tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '',
      lang: N.language, ua: N.userAgent, dev: deviceType(),
      vw: W.innerWidth, vh: W.innerHeight, dpr: W.devicePixelRatio || 1,
      touch: ('ontouchstart' in W) || N.maxTouchPoints > 0,
      startedAt: startedAt, batch: ++sent, items: items
    });
  }
  // text/plain is the only JSON-carrying type the CORS safelist allows. Anything else turns the
  // request into a preflighted one, and a preflighted sendBeacon is dropped by the browser even
  // though sendBeacon() itself returned true. The collector parses the body as JSON regardless.
  var BODY_TYPE = 'text/plain;charset=UTF-8';

  function flush(sync) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!queue.length || !consent) return;
    var body = envelope(queue.splice(0, queue.length));
    try {
      // sendBeacon refuses bodies over the browser's quota (~64 KB) and returns false; without
      // this check those events would be gone, because the queue is already drained.
      if (sync && N.sendBeacon && N.sendBeacon(ENDPOINT, new Blob([body], { type: BODY_TYPE }))) return;
      fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': BODY_TYPE }, credentials: 'omit' }).catch(function () {});
    } catch (e) {}
  }

  function funnelStep() {
    for (var i = FUNNEL.length - 1; i >= 0; i--) {
      var m = FUNNEL[i].match || {};
      if (m.path && new RegExp(m.path, 'i').test(location.pathname + location.search)) return FUNNEL[i].id;
    }
    return null;
  }

  function classify(el, st) {
    var tag = el.tagName;
    if (tag === 'IMG' || (st.backgroundImage && st.backgroundImage !== 'none')) return 'img';
    if (/^(BUTTON)$/.test(tag) || (tag === 'INPUT' && /^(submit|button)$/.test(el.type))) return 'button';
    if (tag === 'A') return 'link';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return 'input';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (/^(SVG|VIDEO|IFRAME|CANVAS)$/.test(tag)) return 'media';
    return 'box';
  }
  function ownText(el) {
    var s = '';
    for (var i = 0; i < el.childNodes.length && s.length < 120; i++) {
      if (el.childNodes[i].nodeType === 3) s += el.childNodes[i].nodeValue + ' ';
    }
    return trim(s, 90);
  }
  function snapshot() {
    var key = path + '|' + deviceType();
    if (snapped[key]) return;
    snapped[key] = 1;
    var els = [], all = D.body ? D.body.querySelectorAll('*') : [], n = 0;
    var sx = W.scrollX || 0, sy = W.scrollY || 0;
    for (var i = 0; i < all.length && n < SNAP_MAX; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|NOSCRIPT|LINK|META|HEAD|BR|TEMPLATE)$/.test(el.tagName)) continue;
      var st; try { st = getComputedStyle(el); } catch (e) { continue; }
      if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.width > 4000) continue;
      var kind = classify(el, st), txt = ownText(el);
      var painted = st.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(st.backgroundColor);
      var bordered = st.borderBottomWidth !== '0px' || st.borderTopWidth !== '0px';
      if (kind === 'box' && !txt && !painted && !bordered) continue;
      var e = {
        x: Math.round(r.left + sx), y: Math.round(r.top + sy),
        w: Math.round(r.width), h: Math.round(r.height), k: kind
      };
      if (txt) e.t = txt;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') e.t = trim(el.getAttribute('placeholder') || el.getAttribute('name') || '', 40);
      if (kind === 'img') {
        var src = el.currentSrc || el.src || (st.backgroundImage.match(/url\(["']?([^"')]+)/) || [])[1];
        if (src && src.indexOf('data:') !== 0) e.src = src.slice(0, 300);
      }
      if (painted) e.bg = st.backgroundColor;
      if (txt) { e.c = st.color; e.fs = parseInt(st.fontSize) || 14; e.fw = st.fontWeight; }
      if (kind === 'button' || kind === 'link' || kind === 'input') e.sel = selectorOf(el);
      els.push(e); n++;
    }
    push('snapshot', {
      w: Math.max(D.documentElement.scrollWidth, W.innerWidth),
      h: Math.max(D.documentElement.scrollHeight, W.innerHeight),
      els: els
    });
  }

  function pageview() {
    path = location.pathname + (location.search || '');
    pageStart = Date.now();
    maxDepth = 0; dirChanges = 0;
    push('pageview', { step: funnelStep(), title: trim(D.title, 80), h: D.documentElement.scrollHeight });
    setTimeout(function () { markEngaged('time'); }, 15000);
    setTimeout(snapshot, 1200);
    setTimeout(observeCta, 900);
    autoPath();
  }

  var clickBuf = [], lastClick = null;
  D.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1) return;
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var inter = isInteractive(el);
    var rec = {
      sel: selectorOf(el), label: labelOf(el), tag: el.tagName,
      x: Math.round(ev.pageX), y: Math.round(ev.pageY),
      vx: Math.round(ev.clientX), vy: Math.round(ev.clientY),
      ex: Math.round(r.left + W.scrollX), ey: Math.round(r.top + W.scrollY),
      ew: Math.round(r.width), eh: Math.round(r.height),
      inter: inter ? 1 : 0, dh: D.body ? D.body.innerHTML.length : 0,
      url: location.pathname, since: Date.now() - pageStart
    };
    push('click', rec);
    if (inter) lastInteractive = Date.now();

    var now = Date.now();
    clickBuf = clickBuf.filter(function (c) { return now - c.ts < 1200; });
    clickBuf.push({ ts: now, x: ev.clientX, y: ev.clientY, sel: rec.sel, label: rec.label });
    if (clickBuf.length >= 3) {
      var near = clickBuf.filter(function (c) {
        return Math.abs(c.x - ev.clientX) < 34 && Math.abs(c.y - ev.clientY) < 34;
      });
      if (near.length >= 3) {
        push('rage_click', { sel: rec.sel, label: rec.label, n: near.length, x: rec.x, y: rec.y });
        clickBuf = [];
      }
    }

    lastClick = { ts: now, rec: rec, href: location.href, scroll: W.scrollY, dh: rec.dh, errored: false };
    setTimeout(function () {
      if (!lastClick || lastClick.ts !== now) return;
      var changed = location.href !== lastClick.href ||
        Math.abs(W.scrollY - lastClick.scroll) > 60 ||
        (D.body && Math.abs(D.body.innerHTML.length - lastClick.dh) > 120);
      if (!changed && !lastClick.errored && !inter) {
        push('dead_click', { sel: rec.sel, label: rec.label, tag: rec.tag, x: rec.x, y: rec.y });
      }
    }, 900);
  }, true);

  var mouseBuf = [], lastMouse = 0;
  D.addEventListener('mousemove', function (ev) {
    var now = Date.now();
    if (now - lastMouse < MOUSE_MS) return;
    lastMouse = now;
    mouseBuf.push([Math.round(ev.pageX), Math.round(ev.pageY), now - pageStart]);
    if (mouseBuf.length >= 30) { push('mouse', { pts: mouseBuf.splice(0, mouseBuf.length) }); }
  }, { passive: true });

  var maxDepth = 0, lastScroll = 0, lastY = 0, dirChanges = 0, lastDir = 0;
  W.addEventListener('scroll', function () {
    var now = Date.now();
    var y = W.scrollY, dh = D.documentElement.scrollHeight - W.innerHeight;
    var depth = dh > 0 ? Math.min(100, Math.round(((y + W.innerHeight) / D.documentElement.scrollHeight) * 100)) : 100;
    if (depth > maxDepth) maxDepth = depth;
    var dir = y > lastY ? 1 : -1;
    if (dir !== lastDir) { dirChanges++; lastDir = dir; }
    lastY = y;
    if (now - lastScroll < 400) return;
    lastScroll = now;
    push('scroll', { y: Math.round(y), depth: depth, since: now - pageStart });
    if (depth >= 50) markEngaged('scroll');
    if (D.documentElement.scrollWidth > D.documentElement.clientWidth + 10) {
      push('hscroll', { sw: D.documentElement.scrollWidth, cw: D.documentElement.clientWidth });
    }
  }, { passive: true });

  var ctaSeen = {}, io = null;
  var CTA_TEXT = CFG.ctaText ? new RegExp(CFG.ctaText, 'i') : null;
  function ctaNodes() {
    var list = [];
    if (CTA) { try { Array.prototype.push.apply(list, D.querySelectorAll(CTA)); } catch (e) {} }
    if (CTA_TEXT) {
      try {
        Array.prototype.forEach.call(D.querySelectorAll('button,a[href],input[type=submit]'), function (el) {
          var t = (el.innerText || el.value || '').trim();
          if (t && CTA_TEXT.test(t) && list.indexOf(el) < 0) list.push(el);
        });
      } catch (e) {}
    }
    return list;
  }
  function observeCta() {
    var nodes = ctaNodes();
    if (!nodes.length) return;
    if (io) io.disconnect();
    if (W.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var sel = selectorOf(en.target);
          if (ctaSeen[sel]) return;
          ctaSeen[sel] = 1;
          push('element_seen', { sel: sel, label: labelOf(en.target), after: Date.now() - pageStart, kind: 'cta' });
        });
      }, { threshold: 0.4 });
      nodes.forEach(function (el) { try { io.observe(el); } catch (e) {} });
    }
    nodes.forEach(function (el) {
      var r = el.getBoundingClientRect();
      push('element_pos', { sel: selectorOf(el), label: labelOf(el), y: Math.round(r.top + W.scrollY), fold: W.innerHeight });
    });
  }

  var AUTO = (CFG.autoTrack || []).map(function (rule) {
    return {
      event: rule.event,
      clickText: rule.clickText ? new RegExp(rule.clickText, 'i') : null,
      clickSelector: rule.clickSelector || null,
      path: rule.path ? new RegExp(rule.path, 'i') : null,
      formSubmit: !!rule.formSubmit,
      once: rule.once !== false,
      fired: {}
    };
  });
  function autoFire(rule, data) {
    var key = rule.event + '|' + path;
    if (rule.once && rule.fired[key]) return;
    rule.fired[key] = 1;
    push('custom', { name: rule.event, props: data || {}, step: funnelStep(), auto: 1 });
  }
  // Generic engagement steps so a lead-gen funnel works with no code on the site.
  var engagedOn = {}, formStartedOn = {};
  function markEngaged(why) {
    if (engagedOn[path]) return;
    engagedOn[path] = 1;
    push('custom', { name: 'engaged', props: { why: why, depth: maxDepth, ms: Date.now() - pageStart }, step: funnelStep(), auto: 1 });
  }
  function markFormStart(field, label) {
    if (formStartedOn[path]) return;
    formStartedOn[path] = 1;
    push('custom', { name: 'form_start', props: { field: field, label: label }, step: funnelStep(), auto: 1 });
  }

  function autoPath() {
    AUTO.forEach(function (r) { if (r.path && r.path.test(path)) autoFire(r, { path: path }); });
  }
  D.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1 || !el.closest) return;
    var node = el.closest('button, a, input[type=submit], [role=button]');
    if (!node) return;
    var txt = (node.innerText || node.value || '').trim();
    AUTO.forEach(function (r) {
      if (r.clickSelector) { try { if (node.matches(r.clickSelector)) autoFire(r, { label: trim(txt, 60) }); } catch (e) {} }
      if (r.clickText && txt && r.clickText.test(txt)) autoFire(r, { label: trim(txt, 60) });
    });
  }, true);

  var fieldState = {}, lastField = null;
  function fieldKey(el) { return el.getAttribute('name') || el.id || selectorOf(el); }
  D.addEventListener('focusin', function (ev) {
    var el = ev.target;
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (el.type === 'password') { lastField = { key: 'password', start: Date.now() }; return; }
    var k = fieldKey(el);
    fieldState[k] = fieldState[k] || { keys: 0, back: 0, edits: 0, errors: 0, time: 0 };
    lastField = { key: k, start: Date.now(), label: labelOf(el), sel: selectorOf(el), type: el.type };
    push('field_focus', { key: k, label: lastField.label, type: el.type, since: Date.now() - pageStart });
    markFormStart(k, lastField.label);
  }, true);
  D.addEventListener('focusout', function (ev) {
    var el = ev.target;
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'password') return;
    var k = fieldKey(el), st = fieldState[k];
    if (!st || !lastField || lastField.key !== k) return;
    st.time += Date.now() - lastField.start;
    push('field_blur', {
      key: k, label: lastField.label, type: lastField.type,
      ms: Date.now() - lastField.start, keys: st.keys, back: st.back, errors: st.errors,
      filled: el.value ? 1 : 0, len: (el.value || '').length,
      valid: el.checkValidity ? (el.checkValidity() ? 1 : 0) : 1
    });
    st.keys = 0; st.back = 0;
  }, true);
  D.addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (!/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    var k = fieldKey(el), st = fieldState[k];
    if (!st) return;
    st.keys++;
    if (ev.key === 'Backspace' || ev.key === 'Delete') st.back++;
  }, true);
  D.addEventListener('invalid', function (ev) {
    var el = ev.target, k = fieldKey(el);
    if (fieldState[k]) fieldState[k].errors++;
    push('validation_error', {
      key: k, label: labelOf(el),
      msg: trim(el.validationMessage, 80), since: Date.now() - pageStart
    });
  }, true);
  D.addEventListener('submit', function (ev) {
    var f = ev.target;
    push('form_submit', { sel: selectorOf(f), fields: f.elements ? f.elements.length : 0, since: Date.now() - pageStart });
    AUTO.forEach(function (r) {
      if (!r.formSubmit) return;
      var ok = true;
      if (r.clickSelector) { try { ok = f.matches(r.clickSelector); } catch (e) { ok = true; } }
      if (ok) autoFire(r, { sel: selectorOf(f), fields: f.elements ? f.elements.length : 0 });
    });
  }, true);

  W.addEventListener('error', function (ev) {
    if (lastClick && Date.now() - lastClick.ts < 1500) lastClick.errored = true;
    var m = ev.message || (ev.error && ev.error.message) || 'script error';
    push('js_error', {
      msg: trim(String(m), 160),
      src: trim(String(ev.filename || '').split('?')[0], 120),
      line: ev.lineno || 0,
      stack: trim(((ev.error && ev.error.stack) || '').split('\n').slice(1, 3).join(' | '), 200),
      since: Date.now() - pageStart
    });
  });
  W.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    push('js_error', { msg: trim('unhandled: ' + ((r && r.message) || String(r)), 160), src: '', line: 0, since: Date.now() - pageStart });
  });

  var _fetch = W.fetch;
  if (_fetch) {
    W.fetch = function (input, init) {
      var t0 = Date.now();
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      return _fetch.apply(this, arguments).then(function (res) {
        if (res && res.status >= 400) {
          push('net_error', { url: trim(url.split('?')[0], 160), status: res.status, ms: Date.now() - t0, kind: 'fetch' });
        }
        return res;
      }).catch(function (err) {
        push('net_error', { url: trim(url.split('?')[0], 160), status: 0, ms: Date.now() - t0, kind: 'fetch', msg: trim(String(err && err.message), 80) });
        throw err;
      });
    };
  }
  var XHR = W.XMLHttpRequest;
  if (XHR) {
    var open = XHR.prototype.open, send = XHR.prototype.send;
    XHR.prototype.open = function (m, u) { this.__cl = { u: String(u || ''), m: m }; return open.apply(this, arguments); };
    XHR.prototype.send = function () {
      var x = this, t0 = Date.now();
      x.addEventListener('loadend', function () {
        if (!x.__cl) return;
        if (x.status === 0 || x.status >= 400) {
          push('net_error', { url: trim(x.__cl.u.split('?')[0], 160), status: x.status, ms: Date.now() - t0, kind: 'xhr' });
        }
      });
      return send.apply(this, arguments);
    };
  }

  function perf() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) push('perf', { metric: 'ttfb', value: Math.round(nav.responseStart), nav: nav.type });
      new PerformanceObserver(function (l) {
        var e = l.getEntries().pop();
        if (e) push('perf', { metric: 'lcp', value: Math.round(e.startTime), el: trim(e.element ? selectorOf(e.element) : '', 80) });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      var cls = 0;
      new PerformanceObserver(function (l) {
        l.getEntries().forEach(function (e) { if (!e.hadRecentInput) cls += e.value; });
      }).observe({ type: 'layout-shift', buffered: true });
      var inp = 0;
      new PerformanceObserver(function (l) {
        l.getEntries().forEach(function (e) {
          var d = e.duration || 0;
          if (d > inp) { inp = d; }
          if (d > 400) push('slow_interaction', { ms: Math.round(d), name: e.name, sel: trim(e.target ? selectorOf(e.target) : '', 80) });
        });
      }).observe({ type: 'event', durationThreshold: 200, buffered: true });
      var lt = 0;
      new PerformanceObserver(function (l) { lt += l.getEntries().length; }).observe({ type: 'longtask', buffered: true });
      addEventListener('visibilitychange', function () {
        if (D.visibilityState === 'hidden') {
          push('perf', { metric: 'cls', value: Math.round(cls * 1000) / 1000 });
          push('perf', { metric: 'inp', value: Math.round(inp) });
          push('perf', { metric: 'longtasks', value: lt });
        }
      });
    } catch (e) {}
  }

  if (W.visualViewport) {
    W.visualViewport.addEventListener('resize', function () {
      var s = W.visualViewport.scale;
      if (s > 1.15) push('zoom', { scale: Math.round(s * 100) / 100 });
    });
  }
  W.addEventListener('popstate', function () { push('back_nav', { to: location.pathname }); pageview(); });
  D.addEventListener('copy', function () {
    var sel = trim(String(W.getSelection ? W.getSelection() : ''), 80);
    push('copy', { text: sel });
  });
  D.addEventListener('mouseleave', function (ev) {
    if (ev.clientY > 12) return;
    push('exit_intent', { since: Date.now() - pageStart, depth: maxDepth });
    maybeSurvey();
  });

  function stepIndexOf(id) { for (var i = 0; i < FUNNEL.length; i++) if (FUNNEL[i].id === id) return i; return -1; }
  function maybeSurvey() {
    if (!SURVEY.enabled || surveyShown) return;
    if (Date.now() - startedAt < (SURVEY.minSeconds || 20) * 1000) return;
    if (SURVEY.paths && !new RegExp(SURVEY.paths, 'i').test(location.pathname)) return;
    surveyShown = true;
    var box = D.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('data-cl-survey', '1');
    box.style.cssText = 'position:fixed;z-index:2147483000;right:18px;bottom:18px;max-width:340px;background:#fff;color:#111;color-scheme:light;border:1px solid #e3e3df;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:18px;font:14px/1.45 system-ui,sans-serif';
    var opts = (SURVEY.options || []).map(function (o, i) {
      return '<button data-i="' + i + '" style="display:block;width:100%;text-align:left;margin:6px 0;padding:9px 11px;border:1px solid #e3e3df;border-radius:9px;background:#fcfcfb;cursor:pointer;font:inherit">' + o + '</button>';
    }).join('');
    box.innerHTML = '<div style="font-weight:600;margin-bottom:10px">' + (SURVEY.question || '') + '</div>' + opts +
      (SURVEY.allowText ? '<textarea placeholder="Можна написати своїми словами" style="width:100%;margin-top:8px;padding:8px;border:1px solid #e3e3df;border-radius:9px;background:#fff;color:#111;font:inherit;resize:vertical" rows="2"></textarea>' : '') +
      '<div style="display:flex;gap:8px;margin-top:10px"><button data-skip="1" style="flex:1;padding:8px;border:0;background:none;color:#52514e;cursor:pointer;font:inherit">Закрити</button></div>';
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.getAttribute('data-skip')) { push('survey_skip', {}); box.remove(); flush(true); return; }
      var ta = box.querySelector('textarea');
      push('survey_answer', {
        answer: (SURVEY.options || [])[+b.getAttribute('data-i')] || '',
        text: trim(ta ? ta.value : '', 300),
        step: funnelStep(), since: Date.now() - startedAt
      });
      box.innerHTML = '<div style="font-weight:600">Дякуємо, це дуже допомагає 🙏</div>';
      flush(true);
      setTimeout(function () { box.remove(); }, 2200);
    });
    D.body.appendChild(box);
    push('survey_shown', { step: funnelStep() });
  }

  var hp = history.pushState, hr = history.replaceState;
  history.pushState = function () { var r = hp.apply(this, arguments); setTimeout(pageview, 30); return r; };
  history.replaceState = function () { var r = hr.apply(this, arguments); return r; };

  addEventListener('visibilitychange', function () {
    if (D.visibilityState === 'hidden') {
      push('page_leave', {
        ms: Date.now() - pageStart, depth: maxDepth, dirChanges: dirChanges,
        lastField: lastField ? lastField.key : '', step: funnelStep()
      });
      if (mouseBuf.length) push('mouse', { pts: mouseBuf.splice(0, mouseBuf.length) });
      flush(true);
    }
  });
  addEventListener('pagehide', function () { flush(true); });

  W.__convLens = {
    track: function (name, props) { push('custom', { name: name, props: props || {}, step: funnelStep() }); },
    goal: function (name, props) {
      push('goal', { name: name, props: props || {}, value: (props && props.value) || 0, currency: (props && props.currency) || CFG.currency || '' });
      flush(true);
    },
    identify: function (id, traits) { push('identify', { id: String(id).slice(0, 64), traits: traits || {} }); },
    consent: function (ok) { consent = !!ok; if (ok) { pageview(); perf(); } },
    survey: maybeSurvey,
    flush: flush,
    sid: function () { return sid; }
  };
  W.cl = W.cl || function (cmd) {
    var fn = W.__convLens[cmd];
    if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1));
  };
  (W.clQueue || []).forEach(function (a) { W.cl.apply(null, a); });

  if (consent) {
    push('session_start', {
      ref: D.referrer || '', entry: location.pathname + location.search,
      utm: location.search, screen: screen.width + 'x' + screen.height
    });
    if (D.readyState === 'loading') addEventListener('DOMContentLoaded', pageview);
    else pageview();
    perf();
  }
})();
