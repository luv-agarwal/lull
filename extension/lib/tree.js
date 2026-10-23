// The tree: pure rules, no chrome.* calls. A day is settled once it is over,
// from the number of passes taken that day (local dates, "YYYY-MM-DD").
//   no pass                         -> grows one day
//   1st pass of the week (1 that day) -> drops a leaf, still grows
//   3+ passes, or 3rd pass day in a row -> back to the top of the stage below,
//                                         never below a sapling
//   any other pass day              -> rests
// At day 30 the tree joins the grove and a new seed starts.

export const STAGE_DAYS = [0, 1, 3, 7, 14, 30]; // seed, sprout, sapling, young tree, tree, old tree
export const SAPLING = 2;
export const GROVE_AT = STAGE_DAYS[5];

export const stageOf = (days) => {
  let s = 0;
  while (s + 1 < STAGE_DAYS.length && days >= STAGE_DAYS[s + 1]) s++;
  return s;
};

const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
// Weeks start on Monday; a week is named by its Monday.
export const weekOf = (k) => { const d = parse(k); return addDays(k, -((d.getDay() + 6) % 7)); };

export const newTree = (today) => ({ through: addDays(today, -1), days: 0, run: 0, leafWeek: '', leafDay: '', grove: 0, last: null });

// Apply one finished (or, for a preview, unfinished) day.
export function settleDay(tree, day, passes) {
  const t = { ...tree, through: day };
  if (!passes) {
    t.run = 0;
    t.days++;
    t.last = null;
    if (t.days >= GROVE_AT) { t.grove++; t.days = 0; t.last = { kind: 'grove', day }; }
    return t;
  }
  t.run++;
  const stage = stageOf(t.days);
  if (passes >= 3 || t.run >= 3) {
    t.run = 0;
    if (stage > SAPLING) { t.days = STAGE_DAYS[stage] - 1; t.last = { kind: 'shrink', day }; }
    else t.last = { kind: 'rest', day };
  } else if (passes === 1 && t.leafWeek !== weekOf(day)) {
    t.leafWeek = weekOf(day);
    t.leafDay = day;
    t.days++;
    t.last = { kind: 'leaf', day };
    if (t.days >= GROVE_AT) { t.grove++; t.days = 0; t.last = { kind: 'grove', day }; }
  } else {
    t.last = { kind: 'rest', day };
  }
  return t;
}

// Settle every finished day up to yesterday. passesByDay: { "YYYY-MM-DD": n }.
// Days with no record count as days with no pass.
export function settle(tree, passesByDay, today) {
  let t = tree || newTree(today);
  for (let day = addDays(t.through, 1), guard = 0; day < today && guard < 1000; day = addDays(day, 1), guard++) {
    t = settleDay(t, day, passesByDay[day] || 0);
  }
  return t;
}

// What to draw today: settled growth plus today's passes so far. A hard day
// shows only as "resting" until it settles, so it never reads as "nothing left to lose".
export function view(tree, passesToday, today) {
  let note = '';
  let leafToday = false;
  if (passesToday) {
    leafToday = settleDay(tree, today, passesToday).leafDay === today;
    note = leafToday ? 'one leaf down, still your tree' : 'resting today';
  } else if (tree.last?.day === addDays(today, -1)) {
    if (tree.last.kind === 'shrink') note = 'back one stage, one clear day brings it back';
    if (tree.last.kind === 'grove') note = 'a new seed; your last tree joined the grove';
  }
  return {
    stage: stageOf(tree.days), days: tree.days, grove: tree.grove, note,
    fallen: leafToday || tree.leafWeek === weekOf(today),
  };
}
