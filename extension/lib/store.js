// Storage wrapper. The list and settings live in chrome.storage.sync (they follow
// you to other Chromes signed in to the same account); counters stay in
// chrome.storage.local. Nothing leaves the browser through Lull itself.

import { encodeSites, decodeSites } from './domains.js';
import { neededOrigins, accessChecker } from './access.js';

export const DEFAULT_SETTINGS = {
  line: 'Not now. You chose this for a reason.',
  strict: false,
  passMinutes: 5,
};

export async function loadState() {
  const all = await chrome.storage.sync.get(null);
  const n = all.siteChunks || 0;
  const chunks = [];
  for (let i = 0; i < n; i++) chunks.push(all['sites' + i]);
  return {
    sites: decodeSites(chunks),
    allow: all.allow || [],
    schedules: all.schedules || [],
    settings: { ...DEFAULT_SETTINGS, ...(all.settings || {}) },
  };
}

export async function saveSites(sites) {
  const chunks = encodeSites(sites);
  const old = (await chrome.storage.sync.get('siteChunks')).siteChunks || 0;
  const data = { siteChunks: chunks.length };
  chunks.forEach((c, i) => { data['sites' + i] = c; });
  await chrome.storage.sync.set(data);
  const stale = [];
  for (let i = chunks.length; i < old; i++) stale.push('sites' + i);
  if (stale.length) await chrome.storage.sync.remove(stale);
}

export const saveAllow = (allow) => chrome.storage.sync.set({ allow });
export const saveSchedules = (schedules) => chrome.storage.sync.set({ schedules });
export const saveSettings = async (patch) => {
  const { settings } = await chrome.storage.sync.get('settings');
  return chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, ...settings, ...patch } });
};

// ---- local counters: { stats: { "2026-10-23": { "youtube.com": 3 } }, passes: { "2026-10-23": 1 } }

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const KEEP_DAYS = 30;
const prune = (obj) => {
  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 864e5));
  for (const k of Object.keys(obj)) if (k < cutoff) delete obj[k];
  return obj;
};

export async function countBlock(domain) {
  const { stats = {} } = await chrome.storage.local.get('stats');
  const day = (stats[dayKey()] ||= {});
  day[domain] = (day[domain] || 0) + 1;
  await chrome.storage.local.set({ stats: prune(stats) });
}

export async function countPass() {
  const { passes = {} } = await chrome.storage.local.get('passes');
  passes[dayKey()] = (passes[dayKey()] || 0) + 1;
  await chrome.storage.local.set({ passes: prune(passes) });
}

export const clearStats = () => chrome.storage.local.remove(['stats', 'passes']);

// ---- per-site access (needs a click: call from a button handler)

export function requestAccess(sites) {
  const origins = neededOrigins(sites);
  if (!origins.length) return Promise.resolve(true);
  return chrome.permissions.request({ origins }).catch(() => false);
}

export async function sitesWithoutAccess(sites) {
  const { origins = [] } = await chrome.permissions.getAll();
  const has = accessChecker(origins);
  return sites.filter((e) => !has(e));
}
