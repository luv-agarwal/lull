// Pure helpers for site entries: parsing, import/export text, sync storage encoding.
// An entry is { d: "youtube.com", exact?: true, s?: "scheduleId" }.
// No Chrome APIs here, so node --test can cover it.

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// "https://www.YouTube.com/watch?v=1" -> "www.youtube.com"; junk -> null.
export function toHost(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^\*\./, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/\.$/, '');
  if (!HOST_RE.test(host)) return null;
  if (!host.includes('.') && host !== 'localhost') return null;
  return host;
}

// Subdomain mode drops a leading "www." so "www.youtube.com" blocks all of youtube.com.
export function siteFor(input, exact = false) {
  const host = toHost(input);
  if (!host) return null;
  return exact ? host : host.replace(/^www\./, '');
}

export const entryKey = (e) => (e.exact ? '=' : '') + e.d;

// Free text from the add box: one or many sites split by newlines, commas or spaces.
export function parseInput(text, { exact = false, s } = {}) {
  const sites = [];
  const skipped = [];
  for (const tok of String(text || '').split(/[\s,;]+/)) {
    if (!tok) continue;
    const d = siteFor(tok, exact);
    if (d) sites.push(s ? { d, exact, s } : { d, exact });
    else skipped.push(tok);
  }
  return { sites: dedupe(sites), skipped };
}

// Exported list format, one rule per line:
//   youtube.com                 block youtube.com and its subdomains
//   =news.ycombinator.com       block only this exact host
//   reddit.com @Deep work       block during the "Deep work" schedule
//   !music.youtube.com          exception, never blocked
//   # comment
export function parseList(text, schedules = []) {
  const byName = new Map(schedules.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const sites = [];
  const allow = [];
  const skipped = [];
  const unknownSchedules = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    let s;
    const at = line.indexOf('@');
    if (at >= 0) {
      const name = line.slice(at + 1).trim();
      line = line.slice(0, at).trim();
      s = byName.get(name.toLowerCase());
      if (!s && name) unknownSchedules.add(name);
    }
    for (let tok of line.split(/[\s,;]+/)) {
      if (!tok) continue;
      if (tok[0] === '!') {
        const d = siteFor(tok.slice(1), true);
        if (d) allow.push(d); else skipped.push(tok);
        continue;
      }
      const exact = tok[0] === '=';
      if (exact) tok = tok.slice(1);
      const d = siteFor(tok, exact);
      if (!d) { skipped.push(tok); continue; }
      sites.push(s ? { d, exact, s } : { d, exact });
    }
  }
  return { sites: dedupe(sites), allow: [...new Set(allow)], skipped, unknownSchedules: [...unknownSchedules] };
}

export function formatList({ sites = [], allow = [], schedules = [] }) {
  const names = new Map(schedules.map((x) => [x.id, x.name]));
  const lines = ['# Lull block list — one site per line. "=" exact host, "!" exception, "@Name" schedule.'];
  for (const e of sites) {
    const name = e.s && names.get(e.s);
    lines.push(entryKey(e) + (name ? ' @' + name : ''));
  }
  for (const d of allow) lines.push('!' + d);
  return lines.join('\n') + '\n';
}

// Later entries win, so re-adding a site updates its schedule in place.
export function dedupe(sites) {
  const map = new Map();
  for (const e of sites) map.set(entryKey(e), e);
  return [...map.values()];
}

export function mergeSites(current, added) {
  const map = new Map(current.map((e) => [entryKey(e), e]));
  let added_n = 0;
  for (const e of added) {
    if (!map.has(entryKey(e))) added_n++;
    map.set(entryKey(e), { ...map.get(entryKey(e)), ...e });
  }
  return { sites: [...map.values()], added: added_n };
}

// chrome.storage.sync allows 8 KB per item, so the list is stored as chunks
// of compact strings ("=host@scheduleId") under sites0, sites1, ...
export const CHUNK_BYTES = 7000;

export function encodeSites(sites) {
  const chunks = [];
  let cur = [];
  let size = 2;
  for (const e of sites) {
    const str = entryKey(e) + (e.s ? '@' + e.s : '');
    const add = str.length + 3;
    if (cur.length && size + add > CHUNK_BYTES) { chunks.push(cur); cur = []; size = 2; }
    cur.push(str);
    size += add;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function decodeSites(chunks) {
  const out = [];
  for (const chunk of chunks) {
    for (const str of chunk || []) {
      const at = str.indexOf('@');
      let d = at >= 0 ? str.slice(0, at) : str;
      const s = at >= 0 ? str.slice(at + 1) : '';
      const exact = d[0] === '=';
      if (exact) d = d.slice(1);
      const e = { d };
      if (exact) e.exact = true;
      if (s) e.s = s;
      out.push(e);
    }
  }
  return out;
}

// Which entry blocks this host? Exact entries first, then the longest suffix.
// isOn narrows the search to entries whose schedule is active.
export function matchEntry(sites, host, isOn = () => true) {
  if (!host) return null;
  let best = null;
  for (const e of sites) {
    if (!isOn(e)) continue;
    if (e.exact) {
      if (e.d === host) return e;
    } else if ((host === e.d || host.endsWith('.' + e.d)) && (!best || e.d.length > best.d.length)) {
      best = e;
    }
  }
  return best;
}

export const isAllowed = (allow, host) =>
  !!host && allow.some((d) => host === d || host.endsWith('.' + d));
