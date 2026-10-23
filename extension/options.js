import { loadState, saveSites, saveAllow, saveSchedules, saveSettings, clearStats, dayKey, resumeTree, requestAccess, sitesWithoutAccess } from './lib/store.js';
import { parseInput, parseList, formatList, mergeSites, entryKey } from './lib/domains.js';
import { activeFilter } from './lib/rules.js';
import { isActive, activeUntil, describe, DAY_LETTERS } from './lib/schedule.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const say = (el, text, warn = false) => { el.textContent = text; el.classList.toggle('warn', warn); };

let state = await loadState();

// ---------- strict mode gate ----------
const UNLOCK_WAIT = 60;
const UNLOCK_FOR = 5 * 60000;
let unlockedUntil = 0;
const locked = () => state.settings.strict && Date.now() > unlockedUntil;

$('unlock').onclick = () => {
  const btn = $('unlock');
  btn.disabled = true;
  let left = UNLOCK_WAIT;
  btn.textContent = `Wait ${left} s…`;
  const t = setInterval(() => {
    left -= 1;
    if (left > 0) { btn.textContent = `Wait ${left} s…`; return; }
    clearInterval(t);
    unlockedUntil = Date.now() + UNLOCK_FOR;
    btn.textContent = 'Unlocked for 5 minutes';
    renderAll();
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Unlock edits'; renderAll(); }, UNLOCK_FOR);
  }, 1000);
};

// ---------- sites ----------
function schedOptions(selected) {
  return '<option value="">Always</option>' + state.schedules
    .map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

function renderSites() {
  const q = $('filter').value.trim().toLowerCase();
  const shown = q ? state.sites.filter((e) => e.d.includes(q)) : state.sites;
  const dis = locked() ? ' disabled' : '';
  const opts = new Map();
  $('list').innerHTML = shown.map((e) => {
    const k = e.s || '';
    if (!opts.has(k)) opts.set(k, schedOptions(e.s));
    return `<li data-k="${esc(entryKey(e))}"><code>${esc(e.d)}</code>`
      + `<button class="tag" data-act="mode"${dis} title="Toggle subdomains">${e.exact ? 'exact host' : '+ subdomains'}</button>`
      + `<select data-act="sched"${dis} aria-label="Schedule for ${esc(e.d)}">${opts.get(k)}</select>`
      + `<button class="del" data-act="del"${dis} aria-label="Remove ${esc(e.d)}">×</button></li>`;
  }).join('');
  const n = state.sites.length;
  $('count').textContent = (q ? `${shown.length} of ` : '') + `${n} site${n === 1 ? '' : 's'}`;
}

function findIndex(li) {
  const k = li.dataset.k;
  return state.sites.findIndex((e) => entryKey(e) === k);
}

$('list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn || locked()) return;
  const i = findIndex(btn.closest('li'));
  if (i < 0) return;
  if (btn.dataset.act === 'del') state.sites.splice(i, 1);
  else if (btn.dataset.act === 'mode') {
    const e = state.sites[i];
    state.sites[i] = { ...e, exact: !e.exact };
    if (state.sites.some((x, j) => j !== i && entryKey(x) === entryKey(state.sites[i]))) state.sites.splice(i, 1);
  }
  await saveSites(state.sites);
});
$('list').addEventListener('change', async (ev) => {
  const sel = ev.target.closest('select[data-act=sched]');
  if (!sel || locked()) return;
  const i = findIndex(sel.closest('li'));
  if (i < 0) return;
  const { s, ...rest } = state.sites[i];
  state.sites[i] = sel.value ? { ...rest, s: sel.value } : rest;
  await saveSites(state.sites);
});

async function addSites() {
  const s = $('add-sched').value;
  const { sites, skipped } = parseInput($('add-text').value, { exact: $('add-exact').checked, s: s || undefined });
  if (!sites.length) return say($('add-msg'), skipped.length ? `Not a site: ${skipped.join(', ')}` : 'Type a site first.', true);
  const merged = mergeSites(state.sites, sites);
  if (merged.sites.length > 4500) return say($('add-msg'), 'That is more sites than Lull can hold (4,500).', true);
  state.sites = merged.sites;
  await saveSites(state.sites);
  await requestAccess(sites);
  $('add-text').value = '';
  $('add-text').rows = 1;
  say($('add-msg'), `Added ${merged.added} site${merged.added === 1 ? '' : 's'}.` + (skipped.length ? ` Skipped: ${skipped.join(', ')}` : ''), !!skipped.length);
}
$('add').onclick = addSites;
$('add-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSites(); }
});
$('add-text').addEventListener('input', (e) => { e.target.rows = Math.min(8, e.target.value.split('\n').length); });
$('filter').addEventListener('input', renderSites);

async function renderAccess() {
  const missing = await sitesWithoutAccess(state.sites);
  const bar = $('access-bar');
  bar.hidden = !missing.length;
  if (!missing.length) return;
  const n = missing.length;
  $('access-text').textContent = `${n} site${n === 1 ? '' : 's'} still blocked, but with Chrome's plain error page: Lull needs your OK to show its own page there.`;
  $('access-allow').onclick = () => requestAccess(missing);
}
chrome.permissions.onAdded.addListener(renderAccess);
chrome.permissions.onRemoved.addListener(renderAccess);

// ---------- exceptions ----------
function renderAllow() {
  const dis = locked() ? ' disabled' : '';
  $('allow-list').className = 'list simple';
  $('allow-list').innerHTML = state.allow.map((d) =>
    `<li data-d="${esc(d)}"><code>${esc(d)}</code><button class="del" aria-label="Remove ${esc(d)}">×</button></li>`).join('');
  $('allow-add').disabled = !!dis;
}
$('allow-list').addEventListener('click', async (ev) => {
  const li = ev.target.closest('button') && ev.target.closest('li');
  if (!li) return;
  state.allow = state.allow.filter((d) => d !== li.dataset.d);
  await saveAllow(state.allow);
});
$('allow-add').onclick = async () => {
  if (locked()) return;
  const { sites, skipped } = parseInput($('allow-text').value, { exact: true });
  if (!sites.length) return say($('allow-msg'), skipped.length ? `Not a site: ${skipped.join(', ')}` : 'Type a site first.', true);
  state.allow = [...new Set([...state.allow, ...sites.map((e) => e.d)])];
  await saveAllow(state.allow);
  $('allow-text').value = '';
  say($('allow-msg'), skipped.length ? `Skipped: ${skipped.join(', ')}` : '', !!skipped.length);
};

// ---------- schedules ----------
function renderSchedules() {
  const now = new Date();
  const dis = locked() ? ' disabled' : '';
  $('sched-list').innerHTML = state.schedules.map((s) => {
    const until = activeUntil(s, now);
    const used = state.sites.filter((e) => e.s === s.id).length;
    const days = DAY_LETTERS.map((L, d) => `<button data-day="${d}" aria-pressed="${s.days.includes(d)}"${dis} title="${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}">${L}</button>`);
    return `<div class="sched" data-id="${esc(s.id)}">
      <div class="top-row">
        <input type="text" data-f="name" value="${esc(s.name)}" aria-label="Schedule name"${dis}>
        <input type="time" data-f="start" value="${esc(s.start)}" aria-label="Start"${dis}>–<input type="time" data-f="end" value="${esc(s.end)}" aria-label="End"${dis}>
        <span class="days">${days.slice(1).join('')}${days[0]}</span>
      </div>
      <button class="del" data-act="del-sched"${dis} aria-label="Delete ${esc(s.name)}">×</button>
      <div class="meta">${isActive(s, now) ? `<span class="pill on">active${until ? ' until ' + fmt(until) : ''}</span> ` : ''}${esc(describe(s))} · ${used} site${used === 1 ? '' : 's'}</div>
    </div>`;
  }).join('');
  const opts = schedOptions($('add-sched').value);
  $('add-sched').innerHTML = opts;
}

const schedById = (el) => state.schedules.find((s) => s.id === el.closest('.sched').dataset.id);
$('sched-list').addEventListener('click', async (ev) => {
  if (locked()) return;
  const day = ev.target.closest('button[data-day]');
  const del = ev.target.closest('button[data-act=del-sched]');
  if (day) {
    const s = schedById(day);
    const d = +day.dataset.day;
    s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort();
  } else if (del) {
    const s = schedById(del);
    const used = state.sites.filter((e) => e.s === s.id).length;
    if (used && !confirm(`Delete "${s.name}"? Its ${used} site(s) will block always.`)) return;
    state.schedules = state.schedules.filter((x) => x !== s);
    state.sites = state.sites.map(({ s: sid, ...rest }) => (sid && sid !== s.id ? { ...rest, s: sid } : rest));
    await saveSites(state.sites);
  } else return;
  await saveSchedules(state.schedules);
});
$('sched-list').addEventListener('change', async (ev) => {
  const f = ev.target.dataset.f;
  if (!f || locked()) return;
  const s = schedById(ev.target);
  s[f] = f === 'name' ? ev.target.value.trim().slice(0, 40) || s.name : ev.target.value;
  await saveSchedules(state.schedules);
});
$('sched-add').onclick = async () => {
  const id = 's' + Date.now().toString(36);
  state.schedules.push({ id, name: state.schedules.length ? `Focus ${state.schedules.length + 1}` : 'Deep work', days: [1, 2, 3, 4, 5], start: '09:00', end: '13:00' });
  await saveSchedules(state.schedules);
};

// ---------- stats ----------
async function renderStats() {
  const { stats = {}, passes = {} } = await chrome.storage.local.get(['stats', 'passes']);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5));
  const totals = days.map((d) => Object.values(stats[dayKey(d)] || {}).reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  $('bars').innerHTML = days.map((d, i) =>
    `<div class="bar" title="${totals[i]} blocks"><span>${totals[i] || ''}</span><i style="height:${(totals[i] / max) * 80}%"></i>${d.toLocaleDateString([], { weekday: 'narrow' })}</div>`).join('');
  const per = {};
  for (const d of days) for (const [k, v] of Object.entries(stats[dayKey(d)] || {})) per[k] = (per[k] || 0) + v;
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $('top').innerHTML = top.length ? top.map(([k, v]) => `<li><code>${esc(k)}</code><span>${v}</span></li>`).join('') : '<li class="muted">No blocks yet.</li>';
  const sum = totals.reduce((a, b) => a + b, 0);
  const p = days.reduce((a, d) => a + (passes[dayKey(d)] || 0), 0);
  $('stat-sum').textContent = `${sum} block${sum === 1 ? '' : 's'} · ${p} pass${p === 1 ? '' : 'es'} taken`;
}
$('clear-stats').onclick = async () => { if (confirm('Clear all stats?')) await clearStats(); };

// ---------- block page + strict ----------
$('line').addEventListener('change', (e) => saveSettings({ line: e.target.value.trim() || 'Not now.' }));
$('tree-on').addEventListener('change', async (e) => {
  if (e.target.checked) await resumeTree();
  await saveSettings({ tree: e.target.checked });
});
$('quotes-on').addEventListener('change', (e) => saveSettings({ quotes: e.target.checked }));
$('strict-on').addEventListener('change', async (e) => {
  if (!e.target.checked && locked()) { e.target.checked = true; return; }
  await saveSettings({ strict: e.target.checked });
});

// ---------- import / export ----------
$('io-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('io-text').value = await f.text();
});
$('import').onclick = async () => {
  const res = parseList($('io-text').value, state.schedules);
  const allowNew = res.allow.filter((d) => !state.allow.includes(d));
  if (allowNew.length && locked()) return say($('io-msg'), 'Strict mode: unlock edits to import exceptions.', true);
  const merged = mergeSites(state.sites, res.sites);
  state.sites = merged.sites;
  state.allow = [...state.allow, ...allowNew];
  await saveSites(state.sites);
  if (allowNew.length) await saveAllow(state.allow);
  if (res.sites.length) await requestAccess(res.sites);
  const notes = [`Added ${merged.added} site${merged.added === 1 ? '' : 's'}`];
  if (allowNew.length) notes.push(`${allowNew.length} exception${allowNew.length === 1 ? '' : 's'}`);
  if (res.skipped.length) notes.push(`skipped ${res.skipped.length}: ${res.skipped.slice(0, 5).join(', ')}`);
  if (res.unknownSchedules.length) notes.push(`unknown schedules set to Always: ${res.unknownSchedules.join(', ')}`);
  say($('io-msg'), notes.join(' · '), !!res.skipped.length);
  $('io-text').value = '';
};
$('export').onclick = () => {
  const blob = new Blob([formatList(state)], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `lull-sites-${dayKey()}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(formatList(state));
  say($('io-msg'), 'Copied.');
};

// ---------- render + live updates ----------
async function renderMeta() {
  const now = new Date();
  const on = state.sites.filter(activeFilter(state.schedules, now)).length;
  const pill = $('state-pill');
  pill.textContent = on ? `Blocking ${on} site${on === 1 ? '' : 's'}` : state.sites.length ? 'Off hours' : 'No sites yet';
  pill.classList.toggle('on', !!on);
  $('strict-bar').hidden = !state.settings.strict;
  $('strict-on').checked = state.settings.strict;
  $('tree-on').checked = state.settings.tree;
  $('quotes-on').checked = state.settings.quotes;
  if (document.activeElement !== $('line')) $('line').value = state.settings.line;
  const { lastRebuild: r } = await chrome.storage.local.get('lastRebuild');
  if (r?.error) { $('perf').textContent = `Could not update blocking rules: ${r.error}`; return; }
  $('perf').textContent = r ? `${r.rules} rule${r.rules === 1 ? '' : 's'} for ${r.sites} sites · built in ${r.buildMs} ms, applied in ${r.applyMs} ms` : '';
}

function renderAll() {
  renderSchedules();
  renderSites();
  renderAccess();
  renderAllow();
  renderMeta();
}

renderAll();
renderStats();

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync') { state = await loadState(); renderAll(); }
  if (area === 'local' && (changes.stats || changes.passes)) renderStats();
  if (area === 'local' && changes.lastRebuild) renderMeta();
});
