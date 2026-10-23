// Lull service worker. Event-driven only: it wakes on install/startup, storage
// changes, alarms (schedule edges, pass expiry), messages and the shortcut, then
// goes idle. No content scripts, no webRequest, no timers.

import { loadState, saveSites, countPass } from './lib/store.js';
import { buildRules, passRule, isBlocking, PASS_ID_BASE } from './lib/rules.js';
import { nextChange } from './lib/schedule.js';
import { siteFor, mergeSites, matchEntry, toHost } from './lib/domains.js';
import { accessChecker, neededOrigins } from './lib/access.js';

const dnr = chrome.declarativeNetRequest;
const BLOCK_URL = chrome.runtime.getURL('blocked.html');
const REQUIRED = new Set(chrome.runtime.getManifest().host_permissions || []);

async function rebuild() {
  const state = await loadState();
  const now = new Date();
  let { origins = [] } = await chrome.permissions.getAll();

  // Give back access to sites that left the list.
  const needed = new Set(neededOrigins(state.sites));
  const extra = origins.filter((o) => !needed.has(o) && !REQUIRED.has(o));
  if (extra.length && (await chrome.permissions.remove({ origins: extra }).catch(() => false))) {
    origins = origins.filter((o) => !extra.includes(o));
  }

  const t0 = performance.now();
  const hasAccess = accessChecker(origins);
  const rules = buildRules(state, now, BLOCK_URL, hasAccess);
  const t1 = performance.now();
  const old = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
  const t2 = performance.now();

  const next = nextChange(state.schedules, now);
  if (next) await chrome.alarms.create('tick', { when: next.getTime() });
  else await chrome.alarms.clear('tick');

  const on = isBlocking(rules);
  await chrome.action.setBadgeText({ text: on ? 'ON' : state.sites.length ? 'OFF' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: on ? '#4f7a6b' : '#8a847b' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });

  await chrome.storage.local.set({
    lastRebuild: {
      buildMs: +(t1 - t0).toFixed(2), applyMs: +(t2 - t0).toFixed(2), rules: rules.length,
      sites: state.sites.length, noAccess: state.sites.filter((e) => !hasAccess(e)).length, at: Date.now(),
    },
  });
}

// Rebuilds run one at a time, in order.
let chain = Promise.resolve();
const queueRebuild = () => (chain = chain.then(rebuild).catch((e) => {
  console.error('Lull rebuild failed', e);
  return chrome.storage.local.set({ lastRebuild: { error: String(e.message || e), at: Date.now() } });
}));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  queueRebuild();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(queueRebuild);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') queueRebuild();
});
chrome.permissions.onAdded.addListener(queueRebuild);
chrome.permissions.onRemoved.addListener(queueRebuild);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tick') return queueRebuild();
  if (alarm.name.startsWith('pass:')) {
    const domain = alarm.name.slice(5);
    const rules = await dnr.getSessionRules();
    const ids = rules.filter((r) => r.condition.requestDomains?.[0] === domain).map((r) => r.id);
    if (ids.length) await dnr.updateSessionRules({ removeRuleIds: ids });
  }
});

async function grantPass(url) {
  const state = await loadState();
  if (state.settings.strict) return { ok: false, error: 'Strict mode is on.' };
  const host = toHost(url);
  const entry = matchEntry(state.sites, host);
  if (!entry) return { ok: true, until: Date.now() }; // no longer blocked
  const rules = await dnr.getSessionRules();
  const existing = rules.find((r) => r.condition.requestDomains?.[0] === entry.d);
  const id = existing ? existing.id : Math.max(PASS_ID_BASE, ...rules.map((r) => r.id)) + 1;
  const until = Date.now() + state.settings.passMinutes * 60000;
  await dnr.updateSessionRules({ removeRuleIds: existing ? [id] : [], addRules: [passRule(entry.d, id)] });
  await chrome.alarms.create('pass:' + entry.d, { when: until });
  await countPass();
  return { ok: true, until, domain: entry.d };
}

async function activePasses() {
  const rules = await dnr.getSessionRules();
  const out = {};
  for (const r of rules) {
    const d = r.condition.requestDomains?.[0];
    const alarm = d && (await chrome.alarms.get('pass:' + d));
    if (alarm) out[d] = alarm.scheduledTime;
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === 'pass') grantPass(msg.url).then(reply);
  else if (msg.type === 'passes') activePasses().then(reply);
  else if (msg.type === 'rebuild') queueRebuild().then(() => reply({ ok: true }));
  else return;
  return true;
});

// Shortcut: block the site in the current tab and show the block page there.
// A service worker cannot ask for site access, so the block page offers it.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'block-current-site' || !tab?.url) return;
  const d = siteFor(tab.url);
  if (!d) return;
  const state = await loadState();
  await saveSites(mergeSites(state.sites, [{ d }]).sites);
  await queueRebuild();
  chrome.tabs.update(tab.id, { url: BLOCK_URL + '#' + tab.url });
});
