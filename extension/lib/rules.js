// Pure declarativeNetRequest rule builder. Input: the stored state and a time;
// output: the full dynamic rule set. The service worker swaps it in with one
// updateDynamicRules call.
//
// Rules (all main_frame only, so pages never load and nothing is injected):
//   priority 1  redirect  requestDomains: [...]      domain + every subdomain (same as ||domain^)
//   priority 1  redirect  regexFilter for exact hosts only
//   priority 1  block     same shapes, for sites Lull has no host access to yet
//                         (Chrome then shows its own plain "blocked" page)
//   priority 2  allow     requestDomains: exceptions
//   priority 3  allow     session rule per 5-minute pass (see passRule)
// The redirect keeps the full original URL after "#" so the block page can show
// it and return to it.

import { isActive } from './schedule.js';

export const DOMAINS_PER_RULE = 1000;
export const MAX_EXACT = 900;
export const PASS_ID_BASE = 100000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Is this entry blocking right now? An entry pointing at a deleted schedule counts as "always".
export function activeFilter(schedules = [], now = new Date()) {
  const known = new Set(schedules.map((s) => s.id));
  const on = new Set(schedules.filter((s) => isActive(s, now)).map((s) => s.id));
  return (e) => !e.s || !known.has(e.s) || on.has(e.s);
}

export function buildRules({ sites = [], allow = [], schedules = [] }, now, blockUrl, hasAccess = () => true) {
  const isOn = activeFilter(schedules, now);
  const groups = { redirect: { wide: [], exact: [] }, block: { wide: [], exact: [] } };
  let exactLeft = MAX_EXACT;
  for (const e of sites) {
    if (!isOn(e)) continue;
    // Chrome allows 1000 regex rules; past MAX_EXACT an exact host also blocks its subdomains.
    const exact = e.exact && exactLeft-- > 0;
    groups[hasAccess(e) ? 'redirect' : 'block'][exact ? 'exact' : 'wide'].push(e.d);
  }
  const actions = {
    redirect: { type: 'redirect', redirect: { regexSubstitution: blockUrl + '#\\0' } },
    block: { type: 'block' },
  };
  const rules = [];
  let id = 1;

  for (const kind of ['redirect', 'block']) {
    const action = actions[kind];
    const wide = [...new Set(groups[kind].wide)];
    for (let i = 0; i < wide.length; i += DOMAINS_PER_RULE) {
      const condition = { requestDomains: wide.slice(i, i + DOMAINS_PER_RULE), resourceTypes: ['main_frame'] };
      if (kind === 'redirect') condition.regexFilter = '^.+$';
      rules.push({ id: id++, priority: 1, action, condition });
    }

    // Exact hosts: requestDomains narrows the candidates, the regex pins the host.
    // One rule per host: Chrome caps each compiled regex at a few KB, and an
    // alternation of even ten hosts goes over.
    for (const d of new Set(groups[kind].exact)) {
      rules.push({
        id: id++,
        priority: 1,
        action,
        condition: {
          regexFilter: `^https?://${escapeRe(d)}(?::[0-9]+)?(?:[/?#].*)?$`,
          isUrlFilterCaseSensitive: true,
          requestDomains: [d],
          resourceTypes: ['main_frame'],
        },
      });
    }
  }

  if (rules.length && allow.length) {
    rules.push({
      id: id++,
      priority: 2,
      action: { type: 'allow' },
      condition: { requestDomains: [...new Set(allow)], resourceTypes: ['main_frame'] },
    });
  }
  return rules;
}

// Session rule for a temporary pass: allow this site until the pass alarm removes it.
export function passRule(domain, id) {
  return {
    id,
    priority: 3,
    action: { type: 'allow' },
    condition: { requestDomains: [domain], resourceTypes: ['main_frame'] },
  };
}

export const isBlocking = (rules) => rules.some((r) => r.action.type === 'redirect' || r.action.type === 'block');
