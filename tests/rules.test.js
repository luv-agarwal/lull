import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, passRule, isBlocking, DOMAINS_PER_RULE, MAX_EXACT } from '../extension/lib/rules.js';
import { accessChecker, originsFor, neededOrigins } from '../extension/lib/access.js';

const URL = 'chrome-extension://abc/blocked.html';
const monday10 = new Date(2026, 9, 19, 10);
const monday20 = new Date(2026, 9, 19, 20);
const work = { id: 'w', name: 'Deep work', days: [1, 2, 3, 4, 5], start: '09:00', end: '13:00' };

test('empty list builds no rules', () => {
  assert.deepEqual(buildRules({ sites: [], allow: ['a.com'] }, monday10, URL), []);
});

test('subdomain sites share one redirect rule that keeps the full URL', () => {
  const rules = buildRules({ sites: [{ d: 'youtube.com' }, { d: 'x.com' }] }, monday10, URL);
  assert.equal(rules.length, 1);
  const [r] = rules;
  assert.deepEqual(r.condition.requestDomains, ['youtube.com', 'x.com']);
  assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
  assert.equal(r.action.redirect.regexSubstitution, URL + '#\\0');
  assert.ok(isBlocking(rules));
});

test('exact hosts get a host-pinned regex', () => {
  const [r] = buildRules({ sites: [{ d: 'news.ycombinator.com', exact: true }] }, monday10, URL);
  const re = new RegExp(r.condition.regexFilter);
  assert.ok(re.test('https://news.ycombinator.com/item?id=1'));
  assert.ok(re.test('http://news.ycombinator.com'));
  assert.ok(!re.test('https://a.news.ycombinator.com/'));
  assert.ok(!re.test('https://news.ycombinator.com.evil.io/'));
});

test('schedules switch sites on and off; off-hours means no rule at all', () => {
  const state = { sites: [{ d: 'youtube.com', s: 'w' }, { d: 'x.com' }], schedules: [work] };
  assert.deepEqual(buildRules(state, monday10, URL)[0].condition.requestDomains, ['youtube.com', 'x.com']);
  assert.deepEqual(buildRules(state, monday20, URL)[0].condition.requestDomains, ['x.com']);
  const onlyScheduled = { sites: [{ d: 'youtube.com', s: 'w' }], schedules: [work], allow: ['music.youtube.com'] };
  assert.deepEqual(buildRules(onlyScheduled, monday20, URL), []);
});

test('a site on a deleted schedule blocks always', () => {
  const rules = buildRules({ sites: [{ d: 'a.com', s: 'gone' }], schedules: [] }, monday20, URL);
  assert.equal(rules.length, 1);
});

test('exceptions become a higher-priority allow rule', () => {
  const rules = buildRules({ sites: [{ d: 'youtube.com' }], allow: ['music.youtube.com'] }, monday10, URL);
  const allow = rules.find((r) => r.action.type === 'allow');
  assert.equal(allow.priority, 2);
  assert.deepEqual(allow.condition.requestDomains, ['music.youtube.com']);
});

test('pass rule outranks everything', () => {
  const r = passRule('youtube.com', 100001);
  assert.equal(r.priority, 3);
  assert.equal(r.action.type, 'allow');
});

test('500 sites build fast, with unique ids and bounded rule sizes', () => {
  const sites = [];
  for (let i = 0; i < 500; i++) sites.push(i % 10 ? { d: `site${i}.com` } : { d: `www.site${i}.org`, exact: true });
  const t0 = performance.now();
  let rules;
  for (let k = 0; k < 20; k++) rules = buildRules({ sites, allow: ['ok.site1.com'], schedules: [work] }, monday10, URL);
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 50, `build took ${ms} ms`);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  for (const r of rules) {
    assert.ok((r.condition.requestDomains || []).length <= DOMAINS_PER_RULE);
    assert.ok((r.condition.regexFilter || '').length < 120); // Chrome rejects long alternations
    if (r.condition.regexFilter?.includes('?:')) assert.equal(r.condition.requestDomains.length, 1);
  }
  const covered = rules.filter((r) => r.action.type === 'redirect').flatMap((r) => r.condition.requestDomains);
  assert.equal(covered.length, 500);
  console.log(`# buildRules: 500 sites -> ${rules.length} rules in ${ms.toFixed(3)} ms`);
});

test('exact hosts past the regex budget fall back to subdomain blocking', () => {
  const sites = Array.from({ length: MAX_EXACT + 5 }, (_, i) => ({ d: `h${i}.com`, exact: true }));
  const rules = buildRules({ sites }, monday10, URL);
  const regexRules = rules.filter((r) => r.condition.regexFilter !== '^.+$');
  assert.equal(regexRules.length, MAX_EXACT);
  assert.equal(rules.find((r) => r.condition.regexFilter === '^.+$').condition.requestDomains.length, 5);
});

test('sites without host access get a plain block rule instead of the redirect', () => {
  const has = accessChecker(originsFor({ d: 'youtube.com' }));
  const rules = buildRules({ sites: [{ d: 'youtube.com' }, { d: 'x.com' }, { d: 'a.b.com', exact: true }] }, monday10, URL, has);
  const byType = Object.fromEntries(['redirect', 'block'].map((t) => [t, rules.filter((r) => r.action.type === t).flatMap((r) => r.condition.requestDomains)]));
  assert.deepEqual(byType.redirect, ['youtube.com']);
  assert.deepEqual(byType.block, ['x.com', 'a.b.com']);
  assert.ok(!rules.find((r) => r.action.type === 'block' && r.condition.requestDomains[0] === 'x.com').condition.regexFilter);
});

test('accessChecker: a site needs its own host and its subdomains', () => {
  const has = accessChecker(['*://youtube.com/*', '*://*.youtube.com/*', '*://news.ycombinator.com/*']);
  assert.ok(has({ d: 'youtube.com' }));
  assert.ok(has({ d: 'm.youtube.com' }));
  assert.ok(has({ d: 'news.ycombinator.com', exact: true }));
  assert.ok(!has({ d: 'news.ycombinator.com' })); // subdomains not covered
  assert.ok(!has({ d: 'x.com' }));
  assert.ok(accessChecker(['<all_urls>'])({ d: 'x.com' }));
  assert.deepEqual(neededOrigins([{ d: 'a.com' }, { d: 'a.com', exact: true }]), ['*://a.com/*', '*://*.a.com/*']);
});
