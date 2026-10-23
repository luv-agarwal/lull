// End-to-end check in a real, throwaway Chrome profile (never your own Chrome).
//   node scripts/verify-chrome.mjs [path-to-chrome]
// Loads extension/ over a CDP pipe (no debugging port), serves fake sites on
// 127.0.0.1 and checks: Chrome's plain block without site access, then (with
// access granted, simulated by a copy whose manifest grants *.test) the
// redirect, subdomains, exact hosts, the hold-to-pass and its expiry, a schedule
// edge applied by chrome.alarms, the badge, a 500-site list, and that the
// service worker goes idle. Prints measured numbers.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SHOTS = process.env.SHOTS; // optional folder for screenshots

const CHROME = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT = process.env.LULL_EXT || resolve(new URL('../extension', import.meta.url).pathname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- fake websites
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  const link = new URL(req.url, 'http://x').searchParams.get('link');
  res.end(`<title>site</title><h1>hello from ${req.headers.host}${req.url}</h1>${link ? `<a id="l" href="${link}">go</a>` : ''}`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---- Chrome over a pipe
const profile = mkdtempSync(join(tmpdir(), 'lull-profile-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable', `--host-resolver-rules=MAP *.test 127.0.0.1`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const out = chrome.stdio[3];
const inp = chrome.stdio[4];
let nextId = 1;
const pending = new Map();
const listeners = new Set();
let buf = Buffer.alloc(0);
inp.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  let i;
  while ((i = buf.indexOf(0)) >= 0) {
    const msg = JSON.parse(buf.subarray(0, i).toString());
    buf = buf.subarray(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    } else for (const l of listeners) l(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
  const id = nextId++;
  pending.set(id, { ok, fail });
  out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});

async function evaluate(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function attachSW(extId) {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const t = targetInfos.find((x) => x.type === 'service_worker' && x.url.startsWith(`chrome-extension://${extId}/`));
    if (t) {
      const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      await send('Runtime.enable', {}, sessionId);
      for (let j = 0; j < 50; j++) {
        if ((await evaluate(sessionId, "typeof chrome === 'object' && typeof chrome.storage")) === 'object') return sessionId;
        await sleep(100);
      }
    }
    await sleep(100);
  }
  throw new Error('service worker not found');
}

const errors = [];
listeners.add((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});

async function openTab() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function shot(tab, name, width = 1100, height = 760) {
  if (!SHOTS) return;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, tab.sessionId);
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, tab.sessionId);
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride', {}, tab.sessionId);
}

async function go(tab, url) {
  const loaded = new Promise((ok) => {
    const l = (m) => { if (m.sessionId === tab.sessionId && m.method === 'Page.loadEventFired') { listeners.delete(l); ok(); } };
    listeners.add(l);
    setTimeout(() => { listeners.delete(l); ok(); }, 5000);
  });
  const nav = await send('Page.navigate', { url }, tab.sessionId);
  go.error = nav.errorText || '';
  await loaded;
  await sleep(250); // block page module script finishes
  return evaluate(tab.sessionId, 'location.href');
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Copy of the extension with site access to *.test granted up front, standing in
// for the user clicking "Allow" on Chrome's permission prompt.
const granted = mkdtempSync(join(tmpdir(), 'lull-granted-'));
cpSync(EXT, granted, { recursive: true });
const man = JSON.parse(readFileSync(join(granted, 'manifest.json'), 'utf8'));
man.host_permissions = ['*://*.test/*'];
writeFileSync(join(granted, 'manifest.json'), JSON.stringify(man));

try {
  // 0. Without site access: still blocked, by Chrome's own error page.
  {
    const { id } = await send('Extensions.loadUnpacked', { path: EXT });
    const sw0 = await attachSW(id);
    const t = Date.now();
    await evaluate(sw0, `chrome.storage.sync.set({ siteChunks: 1, sites0: ['blocked.test'] })`);
    for (let i = 0; i < 100; i++) {
      const r = await evaluate(sw0, `chrome.storage.local.get('lastRebuild').then((x) => x.lastRebuild)`);
      if (r && r.at > t) { check('no access: rebuild counts the site as lacking access', r.noAccess === 1, JSON.stringify(r)); break; }
      await sleep(50);
    }
    const tab0 = await openTab();
    await go(tab0, `http://blocked.test:${PORT}/`);
    check('no access: site is blocked with Chrome\'s plain page', go.error === 'net::ERR_BLOCKED_BY_CLIENT', go.error);
    await go(tab0, `chrome-extension://${id}/blocked.html#http://blocked.test:${PORT}/`);
    const offer = await evaluate(tab0.sessionId, `!document.getElementById('access').hidden`);
    check('no access: block page offers to show itself next time', offer);
    await send('Target.closeTarget', { targetId: tab0.targetId });
    await send('Extensions.uninstall', { id });
  }

  const { id: extId } = await send('Extensions.loadUnpacked', { path: granted });
  const BLOCK = `chrome-extension://${extId}/blocked.html#`;
  let sw = await attachSW(extId);
  await send('Runtime.enable', {}, sw);
  const swEval = (expr) => evaluate(sw, `(async () => { ${expr} })()`);
  const waitRebuild = async (since) => {
    for (let i = 0; i < 100; i++) {
      const r = await swEval(`return (await chrome.storage.local.get('lastRebuild')).lastRebuild`);
      if (r && r.at > since) return r;
      await sleep(50);
    }
    throw new Error('no rebuild');
  };
  const setSync = async (obj) => {
    const t = Date.now();
    await swEval(`await chrome.storage.sync.set(${JSON.stringify(obj)})`);
    return waitRebuild(t);
  };
  const badge = () => swEval(`return chrome.action.getBadgeText({})`);
  const tab = await openTab();

  // Close the welcome tab (options page opened on install).
  await sleep(500);

  // 1. Basic block, subdomains, exact host
  await setSync({ siteChunks: 1, sites0: ['blocked.test', '=only.exact.test'], settings: { passMinutes: 0.5 } });
  let href = await go(tab, `http://blocked.test:${PORT}/watch?v=1`);
  check('blocked domain redirects to the block page with the full URL', href === `${BLOCK}http://blocked.test:${PORT}/watch?v=1`, href);
  const shown = await evaluate(tab.sessionId, `document.getElementById('domain')?.textContent`);
  check('block page shows the domain', shown === 'blocked.test', shown);
  href = await go(tab, `http://deep.sub.blocked.test:${PORT}/`);
  check('subdomain is blocked', href.startsWith(BLOCK), href);
  href = await go(tab, `http://only.exact.test:${PORT}/`);
  check('exact host is blocked', href.startsWith(BLOCK), href);
  href = await go(tab, `http://a.only.exact.test:${PORT}/`);
  check('subdomain of an exact host is not blocked', href === `http://a.only.exact.test:${PORT}/`, href);
  await go(tab, `http://notblocked.test:${PORT}/?link=http://blocked.test:${PORT}/from-link`);
  await evaluate(tab.sessionId, `document.getElementById('l').click()`);
  await sleep(1200);
  href = await evaluate(tab.sessionId, 'location.href');
  check('link from another site is blocked too', href.startsWith(BLOCK), href);
  href = await go(tab, `http://notblocked.test:${PORT}/`);
  check('other sites load normally', href === `http://notblocked.test:${PORT}/`, href);
  check('badge shows ON', (await badge()) === 'ON');

  // 2. Exceptions
  await setSync({ allow: ['music.blocked.test'] });
  href = await go(tab, `http://music.blocked.test:${PORT}/`);
  check('exception inside a blocked site loads', href === `http://music.blocked.test:${PORT}/`, href);

  // 3. Hold-to-pass, then expiry (pass length set to 30 s for the test)
  href = await go(tab, `http://blocked.test:${PORT}/after-pass`);
  const box = await evaluate(tab.sessionId, `(() => { const r = document.getElementById('hold').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hidden: document.getElementById('hold').hidden }; })()`);
  check('pass button is visible', !box.hidden);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, tab.sessionId);
  await sleep(1500);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, tab.sessionId);
  await sleep(500);
  href = await evaluate(tab.sessionId, 'location.href');
  check('releasing early gives no pass', href.startsWith(BLOCK), href);
  const passAt = Date.now();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, tab.sessionId);
  await sleep(3600);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, tab.sessionId);
  await sleep(800);
  href = await evaluate(tab.sessionId, 'location.href');
  check('holding 3 s opens the site', href === `http://blocked.test:${PORT}/after-pass`, href);
  href = await go(tab, `http://www.blocked.test:${PORT}/`);
  check('pass covers subdomains', href === `http://www.blocked.test:${PORT}/`, href);
  const passes = await swEval(`return (await chrome.storage.local.get('passes')).passes`);
  check('pass is counted', Object.values(passes || {})[0] === 1, JSON.stringify(passes));

  // 4. Schedule edge applied by the alarm (no storage change involved)
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1);
  const start = new Date(now.getTime() - 60 * 60000);
  await setSync({
    siteChunks: 1, sites0: ['blocked.test', '=only.exact.test', 'focus.test@s1'],
    schedules: [{ id: 's1', name: 'Focus', days: [now.getDay()], start: hhmm(start), end: hhmm(end) }],
  });
  href = await go(tab, `http://focus.test:${PORT}/`);
  check('scheduled site is blocked inside its window', href.startsWith(BLOCK), href);
  const meta = await evaluate(tab.sessionId, `document.getElementById('meta').textContent`);
  check('block page names the window and its end', meta.startsWith('Focus ends at'), meta);
  await shot(tab, 'block-page');

  // wait for the pass to expire and the window to end
  const waitUntil = Math.max(passAt + 31000, end.getTime() + 2000);
  console.log(`...waiting ${Math.round((waitUntil - Date.now()) / 1000)} s for pass expiry and the schedule edge`);
  await sleep(waitUntil - Date.now());
  for (let i = 0; i < 40; i++) {
    const rules = await swEval(`return chrome.declarativeNetRequest.getDynamicRules()`);
    if (!rules.some((r) => r.condition.requestDomains?.includes('focus.test'))) break;
    await sleep(1000);
  }
  let sessionRules = [];
  for (let i = 0; i < 60; i++) {
    sessionRules = await swEval(`return chrome.declarativeNetRequest.getSessionRules()`);
    if (!sessionRules.length) break;
    await sleep(1000);
  }
  console.log(`...pass rule gone ${Math.round((Date.now() - passAt) / 1000)} s after the pass (30 s pass)`);
  check('pass expired (session rule removed by alarm)', sessionRules.length === 0, `${sessionRules.length} session rules`);
  href = await go(tab, `http://blocked.test:${PORT}/`);
  check('site is blocked again after the pass', href.startsWith(BLOCK), href);
  href = await go(tab, `http://focus.test:${PORT}/`);
  check('scheduled site loads after its window ends (rule removed)', href === `http://focus.test:${PORT}/`, href);
  const rulesNow = await swEval(`return chrome.declarativeNetRequest.getDynamicRules()`);
  check('off-hours rule set has no focus.test', !JSON.stringify(rulesNow).includes('focus.test'));

  await setSync({ siteChunks: 1, sites0: ['focus.test@s1'], allow: [] });
  check('badge shows OFF when nothing is blocking', (await badge()) === 'OFF', await badge());

  // 5. 500 sites
  const many = Array.from({ length: 500 }, (_, i) => (i % 10 ? `site${i}.test` : `=www.site${i}.test`));
  const chunked = { siteChunks: 3, schedules: [] };
  for (let i = 0; i < 3; i++) chunked['sites' + i] = many.slice(i * 200, (i + 1) * 200);
  const rb = await setSync(chunked);
  check('500 sites: rule build under 50 ms', rb.buildMs < 50, `build ${rb.buildMs} ms, build+apply ${rb.applyMs} ms, ${rb.rules} rules`);
  href = await go(tab, `http://www.site250.test:${PORT}/`);
  check('500 sites: a listed site is blocked', href.startsWith(BLOCK), href);

  const t0 = Date.now();
  href = await go(tab, `chrome-extension://${extId}/options.html`);
  const perf = await evaluate(tab.sessionId, `(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rows = document.querySelectorAll('#list li').length;
    const nav = performance.getEntriesByType('navigation')[0];
    const f = document.getElementById('filter');
    let t = performance.now();
    f.value = 'site1'; f.dispatchEvent(new Event('input'));
    const filterMs = performance.now() - t;
    t = performance.now();
    f.value = ''; f.dispatchEvent(new Event('input'));
    document.body.offsetHeight;
    const fullMs = performance.now() - t;
    const long = await new Promise((r) => {
      const seen = [];
      new PerformanceObserver((l) => seen.push(...l.getEntries())).observe({ type: 'longtask', buffered: true });
      setTimeout(() => r(seen.map((e) => Math.round(e.duration))), 300);
    });
    return { rows, loadMs: Math.round(nav.loadEventEnd), filterMs: +filterMs.toFixed(1), fullMs: +fullMs.toFixed(1), long };
  })()`);
  check('options page lists all 500 sites', perf.rows === 500, `${perf.rows} rows`);
  await shot(tab, 'options', 1100, 1400);
  check('options page: no long task over 50 ms', perf.long.every((d) => d <= 50),
    `load ${perf.loadMs} ms, full re-render ${perf.fullMs} ms, filter ${perf.filterMs} ms, long tasks: ${JSON.stringify(perf.long)} (${Date.now() - t0} ms wall)`);

  // 6. Popup renders
  href = await go(tab, `chrome-extension://${extId}/popup.html`);
  const popupHost = await evaluate(tab.sessionId, `document.getElementById('host').textContent`);
  check('popup renders', popupHost === 'This page', popupHost);
  await shot(tab, 'popup', 330, 260);

  // 7. Block page weight
  const files = ['blocked.html', 'blocked.css', 'blocked.js', 'lib/store.js', 'lib/domains.js', 'lib/access.js', 'lib/rules.js', 'lib/schedule.js', 'icons/icon32.png'];
  const bytes = files.reduce((a, f) => a + statSync(join(EXT, f)).size, 0);
  check('block page under 50 KB', bytes < 50 * 1024, `${(bytes / 1024).toFixed(1)} KB across ${files.length} files`);

  check('no uncaught errors in extension pages', errors.length === 0, errors.join(' | '));

  // 8. Service worker goes idle
  await go(tab, 'about:blank');
  await send('Target.detachFromTarget', { sessionId: sw });
  console.log('...waiting 45 s for the service worker to go idle');
  await sleep(45000);
  const { targetInfos } = await send('Target.getTargets');
  const alive = targetInfos.some((x) => x.type === 'service_worker' && x.url.includes(extId));
  check('service worker stops when idle', !alive, alive ? 'still running' : 'stopped');
} catch (e) {
  check('run', false, e.stack);
} finally {
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  rmSync(granted, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
