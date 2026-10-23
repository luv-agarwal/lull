import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toHost, siteFor, parseInput, parseList, formatList, encodeSites, decodeSites,
  mergeSites, matchEntry, isAllowed, CHUNK_BYTES,
} from '../extension/lib/domains.js';

test('toHost cleans URLs and rejects junk', () => {
  assert.equal(toHost('https://www.YouTube.com/watch?v=1'), 'www.youtube.com');
  assert.equal(toHost('reddit.com/r/foo'), 'reddit.com');
  assert.equal(toHost('*.example.org'), 'example.org');
  assert.equal(toHost('example.com.'), 'example.com');
  assert.equal(toHost('localhost:3000'), 'localhost');
  assert.equal(toHost('bücher.de'), 'xn--bcher-kva.de');
  for (const bad of ['', 'nodot', 'chrome://settings', 'file:///etc', 'a b.com', '-x-.com']) assert.equal(toHost(bad), null, bad);
});

test('siteFor drops www only in subdomain mode', () => {
  assert.equal(siteFor('www.youtube.com'), 'youtube.com');
  assert.equal(siteFor('www.youtube.com', true), 'www.youtube.com');
});

test('parseInput takes many sites at once and reports skipped ones', () => {
  const { sites, skipped } = parseInput('youtube.com, x.com\nreddit.com  https://www.youtube.com/  nope', { s: 's1' });
  assert.deepEqual(sites.map((e) => e.d), ['youtube.com', 'x.com', 'reddit.com']);
  assert.equal(sites[0].s, 's1');
  assert.deepEqual(skipped, ['nope']);
});

test('parseList reads the export format', () => {
  const schedules = [{ id: 's1', name: 'Deep work' }];
  const text = '# header\nyoutube.com\n=news.ycombinator.com\nreddit.com @Deep work\n!music.youtube.com\nfoo.com @Nope\n???\n';
  const r = parseList(text, schedules);
  assert.deepEqual(r.sites, [
    { d: 'youtube.com', exact: false },
    { d: 'news.ycombinator.com', exact: true },
    { d: 'reddit.com', exact: false, s: 's1' },
    { d: 'foo.com', exact: false },
  ]);
  assert.deepEqual(r.allow, ['music.youtube.com']);
  assert.deepEqual(r.skipped, ['???']);
  assert.deepEqual(r.unknownSchedules, ['Nope']);
});

test('formatList and parseList round-trip', () => {
  const schedules = [{ id: 's1', name: 'Deep work' }];
  const state = {
    sites: [{ d: 'youtube.com' }, { d: 'news.ycombinator.com', exact: true }, { d: 'reddit.com', s: 's1' }],
    allow: ['music.youtube.com'],
    schedules,
  };
  const back = parseList(formatList(state), schedules);
  assert.deepEqual(back.sites.map((e) => [e.d, !!e.exact, e.s]), [
    ['youtube.com', false, undefined], ['news.ycombinator.com', true, undefined], ['reddit.com', false, 's1'],
  ]);
  assert.deepEqual(back.allow, ['music.youtube.com']);
});

test('sync encoding chunks under the 8 KB item quota and round-trips', () => {
  const sites = Array.from({ length: 3000 }, (_, i) => ({ d: `site-number-${i}.example.com`, ...(i % 3 ? {} : { exact: true }), ...(i % 5 ? {} : { s: 's1' }) }));
  const chunks = encodeSites(sites);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(JSON.stringify(c).length <= CHUNK_BYTES + 100);
  assert.deepEqual(decodeSites(chunks), sites);
});

test('mergeSites dedupes and counts new ones', () => {
  const r = mergeSites([{ d: 'a.com' }], [{ d: 'a.com', s: 's1' }, { d: 'b.com' }, { d: 'a.com', exact: true }]);
  assert.equal(r.added, 2);
  assert.deepEqual(r.sites, [{ d: 'a.com', s: 's1' }, { d: 'b.com' }, { d: 'a.com', exact: true }]);
});

test('matchEntry prefers exact, then longest suffix, honouring isOn', () => {
  const sites = [{ d: 'google.com' }, { d: 'mail.google.com', s: 'x' }, { d: 'news.google.com', exact: true }];
  assert.equal(matchEntry(sites, 'a.mail.google.com').d, 'mail.google.com');
  assert.equal(matchEntry(sites, 'a.mail.google.com', (e) => !e.s).d, 'google.com');
  assert.equal(matchEntry(sites, 'news.google.com').exact, true);
  assert.equal(matchEntry(sites, 'notgoogle.com'), null);
  assert.ok(isAllowed(['music.youtube.com'], 'x.music.youtube.com'));
  assert.ok(!isAllowed(['music.youtube.com'], 'youtube.com'));
});
