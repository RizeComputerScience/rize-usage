/* Rize usage counter, v2 (2026-11-16).
 *
 * Counts page loads and a few named moments on course pages hosted outside Learn
 * (GitHub Pages interactives, practice exams, batting cages, desks, lesson pages).
 * Approved by engineering (Billy Taggart, Matt W.) 2026-11-16 on two conditions:
 * no identifiers of any kind, and no persistent id brought into these pages.
 *
 * What it sends, per event: the page, the event name, a short detail about the
 * page (e.g. "3" for step 3), seconds since load, a screen-size bucket, where the
 * visit came from (learn / canvas / other / direct), and a random id made fresh
 * for this one page load.
 *
 * Where it goes: Rize's Google Analytics 4 property, as one small beacon per
 * event sent straight to GA4's collection address. Google's gtag.js is never
 * loaded, so no Google code runs on the page and nothing is stored: no cookies,
 * no localStorage, a new random client id on every load, ad personalization off,
 * and the page address sent without its query string. (Rize's Workspace blocks
 * anonymous Apps Script endpoints; GA4 is the collector engineering recommends.
 * GA4 does not log or store IP addresses.)
 *
 * Pages that already call gtag('event', ...) (the practice exams) keep working:
 * the counter forwards those calls the same way, keeping only page-level fields
 * on an allowlist (course, exam, qid, qhash, klo, tier, selected, correct, items)
 * and dropping everything else, including any attempt or session id.
 *
 * What it never does: send names, emails, student or Learn ids, or anything a
 * student typed; read form fields; store an id in the browser; set a cookie.
 * Reloading the page makes a new, unrelated load id, so two visits by the same
 * student cannot be linked.
 *
 * Use (one line before </body>; the page name defaults to the address):
 *   <script src="https://rizecomputerscience.github.io/rize-usage/rize-usage.js" defer></script>
 *   window.rizeUsage && rizeUsage.mark('step', 3);   // once per load per (event, detail)
 *   window.rizeUsage && rizeUsage.mark('finish');
 * Optional: data-page="micro-batting-cage" on the script tag names the page.
 *
 * Staff: open any tracked page once with ?rize_staff=1 to stop counting in that
 * browser (?rize_staff=0 undoes it; the flag is the same for every staff member
 * and is never sent). Debug: ?rize_debug=1 logs every event to the console.
 */
(function () {
  'use strict';
  if (window.rizeUsage) return;                           // loaded twice: keep the first
  var MEASUREMENT_ID = 'G-XY48TVSPWL';                     // "Rize Course Analytics" GA4 property
  var MAX_MARKS = 60;
  var EVENTS = /^[a-z][a-z0-9_]{0,31}$/;

  var script = document.currentScript;
  var q = location.search;
  var debug = /[?&]rize_debug=1/.test(q);
  var page = clean((script && script.getAttribute('data-page')) ||
    (location.hostname.split('.')[0] + location.pathname.replace(/index\.html$/, '')), 90);

  // Staff opt-out: a constant flag, identical in every staff browser, never sent.
  var staff = false;
  try {
    if (/[?&]rize_staff=1/.test(q)) localStorage.setItem('rize-usage-off', '1');
    if (/[?&]rize_staff=0/.test(q)) localStorage.removeItem('rize-usage-off');
    staff = localStorage.getItem('rize-usage-off') === '1';
  } catch (e) { /* storage blocked: count normally */ }

  var blocked = navigator.webdriver === true ||           // health robot, test runners
    location.protocol === 'file:' ||
    /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) ||
    /\.test$|\.localhost$/.test(location.hostname) ||
    staff;

  var loadId = randomDigits(10) + '.' + Math.floor(Date.now() / 1000);   // GA client id format; memory only, new every load
  var t0 = now();
  var sent = {}, count = 0;

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function randomDigits(n) {
    var a = new Uint32Array(2), s = '';
    try { crypto.getRandomValues(a); s = String(a[0]) + String(a[1]); } catch (e) { s = String(Math.random()).slice(2) + String(Math.random()).slice(2); }
    return (s + '0000000000').slice(0, n);
  }
  function clean(s, n) { return String(s == null ? '' : s).replace(/[^\w\-\/. |:]/g, '').slice(0, n); }
  function sizeBucket() { var w = window.innerWidth || 0; return w < 600 ? 'phone' : w < 1024 ? 'tablet' : 'desktop'; }
  function source() {
    try {
      if (!document.referrer) return 'direct';
      var h = new URL(document.referrer).hostname;
      if (/(^|\.)rize\.education$/.test(h)) return 'learn';
      if (/(^|\.)instructure\.com$/.test(h) || /canvas/.test(h)) return 'canvas';
      return 'other';
    } catch (e) { return 'other'; }
  }
  var from = source();

  // Belt and braces: drop any detail that looks like it could carry a person.
  function safeDetail(d) {
    var s = clean(d, 40);
    if (/@/.test(String(d)) || /\d{5,}/.test(s)) return '';
    return s;
  }

  // GA4 collection, cookieless: a beacon per event, no gtag.js, nothing stored.
  var COLLECT = 'https://www.google-analytics.com/g/collect';
  var EXTRA_KEYS = { course: 1, exam: 1, qid: 1, qhash: 1, klo: 1, tier: 1, selected: 1, correct: 1, items: 1, unit: 1, mode: 1 };
  var sessionId = String(Math.floor(Date.now() / 1000)), seq = 0;
  var ref = '';
  try { if (document.referrer) ref = new URL(document.referrer).origin; } catch (e) { ref = ''; }

  function beacon(name, params) {
    var qs = ['v=2', 'tid=' + MEASUREMENT_ID, 'cid=' + loadId, 'sid=' + sessionId, 'sct=1', 'seg=1', 'npa=1',
      '_s=' + (++seq), 'en=' + encodeURIComponent(name),
      'dl=' + encodeURIComponent(location.origin + location.pathname),
      'dt=' + encodeURIComponent(String(document.title || '').slice(0, 100))];
    if (ref) qs.push('dr=' + encodeURIComponent(ref));
    if (seq === 1) qs.push('_fv=1', '_ss=1', '_nsi=1');
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k) || params[k] === '' || params[k] == null) continue;
      var v = params[k];
      qs.push((typeof v === 'number' ? 'epn.' : 'ep.') + k + '=' + encodeURIComponent(v));
    }
    var url = COLLECT + '?' + qs.join('&');
    if (debug) console.log('[rize-usage]' + (blocked ? ' (not sent)' : ''), name, JSON.stringify(params));
    if (blocked) return;
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, credentials: 'omit' });
    } catch (e) { /* never break the page */ }
  }

  function send(ev, detail) {
    beacon('rz_' + ev, { rz_page: page, rz_detail: safeDetail(detail), rz_from: from, rz_size: sizeBucket(), rz_s: Math.round((now() - t0) / 1000) });
  }

  // Forward a page's own gtag('event', name, params) calls, keeping allowlisted page-level fields only.
  var forwarded = 0;
  function forward(args) {
    try {
      if (!args || args[0] !== 'event' || forwarded >= MAX_MARKS) return;
      var name = String(args[1] || '');
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || name.indexOf('rz_') === 0) return;
      var src = args[2] || {}, out = { rz_page: page, rz_from: from, rz_size: sizeBucket() };
      for (var k in src) {
        if (!EXTRA_KEYS[k] || !Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = src[k];
        if (typeof v === 'boolean') v = v ? 'true' : 'false';
        if (typeof v !== 'number') { v = String(v == null ? '' : v); if (/@/.test(v)) continue; v = v.slice(0, 64); }
        out[k] = v;
      }
      forwarded++;
      beacon(name, out);
    } catch (e) { /* never break the page */ }
  }
  if (window.dataLayer && window.dataLayer.push) {
    var dl = window.dataLayer;
    for (var i = 0; i < dl.length; i++) forward(dl[i]);
    var push = dl.push;
    dl.push = function () { for (var j = 0; j < arguments.length; j++) forward(arguments[j]); return push.apply(dl, arguments); };
  }

  function mark(ev, detail) {
    ev = String(ev || '').toLowerCase();
    if (!EVENTS.test(ev)) return;
    var key = ev + '|' + (detail == null ? '' : detail);
    if (sent[key] || count >= MAX_MARKS) return;
    sent[key] = 1; count++;
    send(ev, detail);
  }

  window.rizeUsage = { mark: mark, version: 2, page: page };

  // Automatic events.
  mark('load');

  var visibleMs = 0, visSince = document.visibilityState === 'visible' ? now() : null;
  function tickVisible() {
    if (visSince != null) { visibleMs += now() - visSince; visSince = document.visibilityState === 'visible' ? now() : null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { visSince = now(); }
    else { tickVisible(); visSince = null; }
  });
  var engagedTimer = setInterval(function () {
    tickVisible(); if (document.visibilityState === 'visible') visSince = now();
    if (visibleMs >= 30000) { mark('engaged'); clearInterval(engagedTimer); }
  }, 5000);

  function firstInteract() {
    mark('interact');
    ['pointerdown', 'keydown'].forEach(function (t) { document.removeEventListener(t, firstInteract, true); });
  }
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, firstInteract, true); });

  window.addEventListener('pagehide', function () {
    tickVisible();
    var s = visibleMs / 1000;
    mark('leave', s < 10 ? 'under 10s' : s < 60 ? '10s-1m' : s < 300 ? '1-5m' : s < 900 ? '5-15m' : '15m+');
  });
})();
