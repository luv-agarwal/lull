import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTree, settle, settleDay, view, stageOf, addDays, weekOf, STAGE_DAYS } from '../extension/lib/tree.js';
import { pickQuote, QUOTES } from '../extension/lib/quotes.js';
import { treeSVG, groveSVG } from '../extension/lib/art.js';

// 2026-10-19 is a Monday.
const MON = '2026-10-19';
const grow = (t, n, from) => { for (let i = 0; i < n; i++) t = settleDay(t, addDays(from, i), 0); return t; };
const at = (days, extra = {}) => ({ ...newTree(MON), days, ...extra });

test('stages: seed, sprout 1, sapling 3, young 7, tree 14, old tree 30', () => {
  assert.deepEqual([0, 1, 2, 3, 6, 7, 13, 14, 29].map(stageOf), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(STAGE_DAYS.length, 6);
});

test('a new tree starts as a seed and settles nothing on its first day', () => {
  const t = settle(null, {}, MON);
  assert.equal(t.days, 0);
  assert.equal(t.through, addDays(MON, -1));
});

test('each clean day grows one day; today is not counted until it ends', () => {
  const t = settle(newTree(MON), {}, addDays(MON, 7));
  assert.equal(t.days, 7);
  assert.equal(stageOf(t.days), 3);
  assert.equal(settle(t, {}, addDays(MON, 7)), t, 'settling twice the same day changes nothing');
});

test('first pass of the week drops a leaf and the day still grows', () => {
  let t = settleDay(at(5), MON, 1);
  assert.equal(t.days, 6);
  assert.equal(t.last.kind, 'leaf');
  assert.equal(t.leafWeek, MON);
  t = settleDay(t, addDays(MON, 2), 1); // second pass day that week rests
  assert.equal(t.days, 6);
  assert.equal(t.last.kind, 'rest');
});

test('two passes on one day rest, even with the leaf unused', () => {
  const t = settleDay(at(5), MON, 2);
  assert.equal(t.days, 5);
  assert.equal(t.leafWeek, '');
});

test('week boundary: the leaf comes back on Monday', () => {
  let t = settleDay(at(5), addDays(MON, 6), 1); // Sunday: leaf
  assert.equal(t.days, 6);
  t = settleDay(t, addDays(MON, 7), 1); // next Monday: leaf again
  assert.equal(t.last.kind, 'leaf');
  assert.equal(t.days, 7);
  assert.equal(weekOf(addDays(MON, 6)), MON);
  assert.equal(weekOf(addDays(MON, 7)), addDays(MON, 7));
});

test('3+ passes in a day takes the tree to the top of the stage below', () => {
  const t = settleDay(at(20, { leafWeek: MON }), MON, 3);
  assert.equal(t.days, 13);
  assert.equal(stageOf(t.days), 3);
  assert.equal(t.last.kind, 'shrink');
  assert.equal(stageOf(settleDay(t, addDays(MON, 1), 0).days), 4, 'one clean day restores the stage');
});

test('the third pass day in a row shrinks; a clean day resets the run', () => {
  let t = at(10);
  t = settleDay(t, MON, 1); // leaf, run 1
  t = settleDay(t, addDays(MON, 1), 1); // rest, run 2
  assert.equal(t.days, 11);
  t = settleDay(t, addDays(MON, 2), 1); // third in a row
  assert.equal(t.last.kind, 'shrink');
  assert.equal(t.days, 6);
  let u = settleDay(at(10, { leafWeek: MON }), MON, 1);
  u = settleDay(u, addDays(MON, 1), 0);
  u = settleDay(u, addDays(MON, 2), 1);
  u = settleDay(u, addDays(MON, 3), 1);
  assert.equal(u.last.kind, 'rest');
});

test('never below a sapling after it grew', () => {
  let t = at(3);
  for (let i = 0; i < 10; i++) t = settleDay(t, addDays(MON, i), 5);
  assert.equal(stageOf(t.days), 2);
  t = settleDay(at(8), MON, 4); // young tree -> top of sapling
  assert.equal(t.days, 6);
  t = settleDay(t, addDays(MON, 1), 4); // sapling stays
  assert.equal(t.days, 6);
  assert.equal(settleDay(at(1), MON, 9).days, 1, 'a sprout never goes back to a seed');
});

test('day 30 moves the tree to the grove and starts a new seed', () => {
  const t = grow(at(0), 30, MON);
  assert.equal(t.grove, 1);
  assert.equal(t.days, 0);
  assert.equal(t.last.kind, 'grove');
  const leaf = settleDay(at(29), MON, 1);
  assert.equal(leaf.grove, 1, 'a leaf day can finish the tree');
});

test('settle replays missed days from stored pass counts', () => {
  const passes = { [addDays(MON, 1)]: 1, [addDays(MON, 3)]: 4 };
  const t = settle({ ...at(10), through: addDays(MON, -1) }, passes, addDays(MON, 5));
  // Mon 11, Tue leaf 12, Wed 13, Thu hard day: young tree -> top of sapling (6), Fri 7
  assert.equal(t.through, addDays(MON, 4));
  assert.equal(t.days, 7);
});

test('day boundary is local midnight, also across a DST change', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  const t = settle(newTree('2026-03-01'), {}, '2026-04-01');
  assert.equal(t.days + t.grove * 30, 31);
});

test('a clock set back settles nothing', () => {
  const t = { ...at(5), through: addDays(MON, 3) };
  assert.equal(settle(t, {}, MON), t);
});

test('view: leaf today, resting today, hard day reads only as resting', () => {
  const t = at(9);
  assert.deepEqual(view(t, 0, MON), { stage: 3, days: 9, grove: 0, note: '', fallen: false });
  assert.equal(view(t, 1, MON).note, 'one leaf down, still your tree');
  assert.equal(view(t, 1, MON).fallen, true);
  assert.equal(view(t, 2, MON).note, 'resting today');
  assert.equal(view(t, 5, MON).note, 'resting today');
  assert.equal(view({ ...t, leafWeek: MON }, 0, addDays(MON, 2)).fallen, true, 'leaf stays down that week');
  assert.equal(view({ ...t, leafWeek: MON }, 0, addDays(MON, 7)).fallen, false);
  const shrunk = { ...t, last: { kind: 'shrink', day: MON } };
  assert.match(view(shrunk, 0, addDays(MON, 1)).note, /one clear day/);
  assert.equal(view(shrunk, 0, addDays(MON, 2)).note, '');
});

test('quotes: about 40, short, never the same twice in a row', () => {
  assert.ok(QUOTES.length >= 35);
  for (const [q] of QUOTES) assert.ok(q.length <= 120, q);
  for (let last = 0; last < QUOTES.length; last++) {
    for (const r of [0, 0.5, 0.999]) {
      const i = pickQuote(last, () => r);
      assert.ok(i !== last && i >= 0 && i < QUOTES.length);
    }
  }
});

test('art: every stage draws, the grove caps its width', () => {
  for (let s = 0; s < 6; s++) assert.match(treeSVG(s), /^<svg[^>]*class="tree"[\s\S]*<\/svg>$/);
  assert.match(treeSVG(3, { fallen: true }), /class="fall"/);
  assert.equal(groveSVG(0), '');
  assert.equal((groveSVG(50).match(/<circle/g) || []).length, 12);
});
