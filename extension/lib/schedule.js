// Pure schedule evaluation. A schedule is
//   { id, name, days: [1,2,3,4,5] (0 = Sunday), start: "09:00", end: "13:00" }
// A window whose end is at or before its start runs overnight into the next day;
// start === end means the whole day. Days name the day a window starts on.

export const minutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function isActive(sched, now = new Date()) {
  const days = sched.days || [];
  if (!days.length) return false;
  const day = now.getDay();
  const m = now.getHours() * 60 + now.getMinutes();
  const s = minutes(sched.start);
  const e = minutes(sched.end);
  if (s === e) return days.includes(day);
  if (s < e) return days.includes(day) && m >= s && m < e;
  return (days.includes(day) && m >= s) || (days.includes((day + 6) % 7) && m < e);
}

const at = (base, dayOffset, mins) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 0, 0, 0, 0);
  d.setMinutes(mins);
  return d;
};

// The next moment after `now` where any schedule may switch on or off.
export function nextChange(schedules, now = new Date()) {
  let best = null;
  for (const sc of schedules || []) {
    if (!sc.days || !sc.days.length) continue;
    for (let off = 0; off <= 8; off++) {
      for (const mins of [minutes(sc.start), minutes(sc.end)]) {
        const t = at(now, off, mins);
        if (t > now && (!best || t < best)) best = t;
      }
    }
  }
  return best;
}

// When does an active schedule stop? null if it is not active.
export function activeUntil(sched, now = new Date()) {
  if (!isActive(sched, now)) return null;
  let t = now;
  for (let i = 0; i < 20; i++) {
    t = nextChange([sched], t);
    if (!t) return null;
    if (!isActive(sched, t)) return t;
  }
  return null; // active around the clock
}

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function describe(sched) {
  const days = [...(sched.days || [])].sort();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let d;
  if (days.join() === '1,2,3,4,5') d = 'Mon–Fri';
  else if (days.length === 7) d = 'Every day';
  else if (days.join() === '0,6') d = 'Weekends';
  else d = days.map((x) => names[x]).join(' ');
  return `${sched.start}–${sched.end} · ${d}`;
}
