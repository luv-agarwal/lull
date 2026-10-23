import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActive, nextChange, activeUntil, describe } from '../extension/lib/schedule.js';

// 2026-10-19 is a Monday.
const at = (day, h, m = 0) => new Date(2026, 9, 19 + day, h, m);
const work = { id: 'w', name: 'Deep work', days: [1, 2, 3, 4, 5], start: '09:00', end: '13:00' };
const night = { id: 'n', name: 'Night', days: [5], start: '22:00', end: '02:00' };

test('day window: inside, edges, weekend', () => {
  assert.ok(isActive(work, at(0, 9)));
  assert.ok(isActive(work, at(0, 12, 59)));
  assert.ok(!isActive(work, at(0, 13)));
  assert.ok(!isActive(work, at(0, 8, 59)));
  assert.ok(!isActive(work, at(5, 10))); // Saturday
});

test('overnight window belongs to its start day', () => {
  assert.ok(isActive(night, at(4, 23)));   // Friday 23:00
  assert.ok(isActive(night, at(5, 1, 30))); // Saturday 01:30
  assert.ok(!isActive(night, at(5, 2)));
  assert.ok(!isActive(night, at(3, 23)));  // Thursday
});

test('start === end means the whole day; no days means never', () => {
  assert.ok(isActive({ days: [0], start: '00:00', end: '00:00' }, at(6, 15)));
  assert.ok(!isActive({ days: [], start: '09:00', end: '10:00' }, at(0, 9, 30)));
});

test('nextChange finds the next edge across schedules', () => {
  assert.deepEqual(nextChange([work], at(0, 8)), at(0, 9));
  assert.deepEqual(nextChange([work], at(0, 9)), at(0, 13));
  assert.deepEqual(nextChange([work, night], at(4, 14)), at(4, 22));
  assert.equal(nextChange([], at(0, 8)), null);
});

test('activeUntil gives the end of the current window', () => {
  assert.deepEqual(activeUntil(work, at(0, 10)), at(0, 13));
  assert.deepEqual(activeUntil(night, at(4, 23)), at(5, 2));
  assert.equal(activeUntil(work, at(0, 14)), null);
});

test('describe is short and readable', () => {
  assert.equal(describe(work), '09:00–13:00 · Mon–Fri');
  assert.equal(describe(night), '22:00–02:00 · Fri');
});
