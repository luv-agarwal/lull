// Block page. Runs only on its own extension page, never inside a website.
import { loadState, countBlock, dayKey, requestAccess, sitesWithoutAccess } from './lib/store.js';
import { toHost, matchEntry } from './lib/domains.js';
import { activeFilter } from './lib/rules.js';
import { activeUntil } from './lib/schedule.js';

const $ = (id) => document.getElementById(id);
const target = location.hash.slice(1);
const host = toHost(target) || '';
const shown = host.replace(/^www\./, '') || 'This site';
$('domain').textContent = shown;
document.title = `${shown} is resting — Lull`;

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const state = await loadState();
const now = new Date();
const entry = matchEntry(state.sites, host, activeFilter(state.schedules, now)) || matchEntry(state.sites, host);
$('line').textContent = state.settings.line;

// Count real blocks, not reloads or back/forward visits of this page.
const nav = performance.getEntriesByType('navigation')[0];
if (entry && (!nav || nav.type === 'navigate')) countBlock(entry.d);

const { passes = {} } = await chrome.storage.local.get('passes');
const today = passes[dayKey()] || 0;
const sched = entry?.s && state.schedules.find((s) => s.id === entry.s);
const until = sched && activeUntil(sched, now);
const parts = [sched ? (until ? `${sched.name} ends at ${fmt(until)}` : sched.name) : 'Blocked always'];
if (today) parts.push(`${today} pass${today === 1 ? '' : 'es'} today`);
$('meta').textContent = parts.join(' · ');

const minutes = state.settings.passMinutes;
const btn = $('hold');
if (state.settings.strict) {
  $('meta').textContent += ' · Strict mode is on';
} else if (/^https?:/.test(target)) {
  btn.hidden = false;
  $('hold-label').textContent = `Hold for a ${minutes}-minute pass`;
  let timer = 0;
  const start = (e) => {
    if (e.type === 'keydown' && (e.repeat || (e.key !== ' ' && e.key !== 'Enter'))) return;
    e.preventDefault();
    if (timer) return;
    btn.classList.add('holding');
    timer = setTimeout(grant, 3000);
  };
  const stop = (e) => {
    if (e?.type === 'keyup' && e.key !== ' ' && e.key !== 'Enter') return;
    clearTimeout(timer);
    timer = 0;
    btn.classList.remove('holding');
  };
  async function grant() {
    timer = 0;
    btn.classList.replace('holding', 'done');
    $('hold-label').textContent = 'Opening…';
    $('hold-hint').textContent = '';
    const res = await chrome.runtime.sendMessage({ type: 'pass', url: target });
    if (res?.ok) location.replace(target);
    else { $('hold-label').textContent = res?.error || 'Pass not available'; btn.classList.remove('done'); }
  }
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('keydown', start);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur']) btn.addEventListener(ev, stop);
}

if (entry && (await sitesWithoutAccess([entry])).length) {
  $('access').hidden = false;
  $('access-allow').onclick = async () => {
    if (await requestAccess([entry])) $('access').hidden = true;
  };
}
