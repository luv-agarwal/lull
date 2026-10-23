import { loadState, saveSites, requestAccess } from './lib/store.js';
import { toHost, siteFor, matchEntry, mergeSites, isAllowed } from './lib/domains.js';
import { activeFilter } from './lib/rules.js';
import { isActive, activeUntil } from './lib/schedule.js';

const $ = (id) => document.getElementById(id);
const BLOCK_URL = chrome.runtime.getURL('blocked.html');
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let url = tab?.url || '';
if (url.startsWith(BLOCK_URL)) url = url.slice(BLOCK_URL.length + 1);
const host = toHost(/^https?:/.test(url) ? url : '');

const state = await loadState();
const now = new Date();
const isOn = activeFilter(state.schedules, now);
const activeCount = state.sites.filter(isOn).length;
const status = $('status');
if (!state.sites.length) status.textContent = 'No sites yet';
else if (activeCount) {
  status.classList.add('on');
  const live = state.schedules.filter((s) => isActive(s, now)).map((s) => s.name);
  status.textContent = 'Blocking' + (live.length ? ' · ' + live[0] : '');
} else status.textContent = 'Off hours';

for (const s of state.schedules) $('sched').add(new Option(s.name, s.id));
$('sched-row').hidden = !state.schedules.length;

const { shortcut } = (await chrome.commands.getAll()).find((c) => c.name === 'block-current-site') || {};
$('shortcut').innerHTML = shortcut ? `Block site <span class="kbd">${shortcut}</span>` : '';
$('open-options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); };

async function add(exact) {
  const d = siteFor(host, exact);
  const s = $('sched').value;
  const entry = s ? { d, exact, s } : { d, exact };
  const fresh = await loadState();
  await saveSites(mergeSites(fresh.sites, [entry]).sites);
  await requestAccess([entry]);
  await chrome.runtime.sendMessage({ type: 'rebuild' });
  chrome.tabs.reload(tab.id);
  window.close();
}

if (!host) {
  $('host').textContent = 'This page';
  $('sub').textContent = "Lull blocks websites only (http and https).";
  $('actions').hidden = true;
} else {
  $('host').textContent = host;
  const entry = matchEntry(state.sites, host);
  const sched = entry?.s && state.schedules.find((s) => s.id === entry.s);
  const passes = await chrome.runtime.sendMessage({ type: 'passes' });
  if (isAllowed(state.allow, host)) {
    $('sub').textContent = 'Exception: never blocked';
  } else if (entry) {
    const until = sched && activeUntil(sched, now);
    $('sub').textContent = (entry.exact ? 'Blocked (exact host)' : 'Blocked')
      + (sched ? (until ? ` · ${sched.name} until ${fmt(until)}` : ` · ${sched.name}, not now`) : ' · always')
      + (passes?.[entry.d] ? ` · pass until ${fmt(passes[entry.d])}` : '');
  } else {
    const n = Object.values((await chrome.storage.local.get('stats')).stats || {})
      .reduce((a, day) => a + (day[siteFor(host)] || 0), 0);
    $('sub').textContent = 'Not blocked' + (n ? ` · blocked ${n}× before` : '');
  }
  if (entry) {
    $('block').hidden = true;
    $('sched-row').hidden = true;
    const ub = $('unblock');
    ub.hidden = false;
    ub.textContent = `Unblock ${entry.exact ? '' : '*.'}${entry.d}`;
    if (state.settings.strict) {
      ub.disabled = true;
      ub.title = 'Strict mode: unblock from Settings after a 60-second wait.';
    }
    ub.onclick = async () => {
      const fresh = await loadState();
      await saveSites(fresh.sites.filter((e) => !(e.d === entry.d && !!e.exact === !!entry.exact)));
      await chrome.runtime.sendMessage({ type: 'rebuild' });
      if (tab.url.startsWith(BLOCK_URL)) chrome.tabs.update(tab.id, { url });
      window.close();
    };
  } else {
    const wide = siteFor(host);
    $('block').textContent = `Block ${wide}`;
    $('block').onclick = () => add(false);
    if (wide !== host) {
      $('exact').hidden = false;
      $('exact').textContent = `Block only ${host}`;
      $('exact').onclick = () => add(true);
    }
  }
}
