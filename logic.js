// Pure helpers for OrangeSwim. No DOM, no network: everything here is unit tested
// with node:test (see tests/logic.test.mjs).

export const MAX_METERS = 20000;
export const MAX_POOL_LENGTH = 80;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n) => String(n).padStart(2, '0');

/** An error whose message is safe and friendly to show to the user as is. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.friendly = true;
  }
}

/**
 * YYYY-MM-DD for the given date in LOCAL time. Never uses toISOString(), which
 * converts to UTC and can shift the day (late evening in UTC+2, for example).
 */
export function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse 'YYYY-MM-DD' into {year, month (1..12), day}, or null if not a real date. */
export function parseDateStr(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

/**
 * 'YYYY-MM' key of a month. Accepts a Date (local time), a 'YYYY-MM-DD' string,
 * or a {year, month} object (month is 1..12).
 */
export function monthKey(input = new Date()) {
  if (input instanceof Date) return `${input.getFullYear()}-${pad2(input.getMonth() + 1)}`;
  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(input);
    if (!m) throw new Error(`Invalid date string: ${input}`);
    return `${m[1]}-${m[2]}`;
  }
  if (input && Number.isInteger(input.year) && Number.isInteger(input.month)) {
    return `${input.year}-${pad2(input.month)}`;
  }
  throw new Error('monthKey expects a Date, a YYYY-MM-DD string, or {year, month}');
}

/** {year, month} (month 1..12) for a Date in local time, or a 'YYYY-MM-DD' string. */
export function monthOf(input = new Date()) {
  const [y, m] = monthKey(input).split('-').map(Number);
  return { year: y, month: m };
}

/** Add delta months to {year, month}. Handles year boundaries in both directions. */
export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** Negative if a is before b, 0 if same month, positive if after. */
export function compareMonths(a, b) {
  return (a.year * 12 + a.month) - (b.year * 12 + b.month);
}

/**
 * Date range of a month as YYYY-MM-DD strings: start is the 1st (inclusive), end
 * is the 1st of the next month (exclusive). Use as start <= date < end.
 */
export function monthRange(year, month) {
  const next = shiftMonth({ year, month }, 1);
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${next.year}-${pad2(next.month)}-01`,
  };
}

/** "October 2026" (English, independent of the device locale). */
export function formatMonthLabel({ year, month }) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** "Thu 1 Oct" for a YYYY-MM-DD string, adding the year when it differs from refYear. */
export function formatDateLabel(dateStr, refYear) {
  const d = parseDateStr(dateStr);
  if (!d) return String(dateStr ?? '');
  const weekday = DAY_SHORT[new Date(d.year, d.month - 1, d.day).getDay()];
  const base = `${weekday} ${d.day} ${MONTH_SHORT[d.month - 1]}`;
  return refYear != null && refYear !== d.year ? `${base} ${d.year}` : base;
}

/** Whole number with comma thousands separators: 12500 -> "12,500". */
export function formatNumber(n) {
  const value = Math.round(Number(n) || 0);
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 12500 -> "12,500 m" */
export function formatMeters(meters) {
  return `${formatNumber(meters)} m`;
}

/** 12500 -> "12.5 km", 10000 -> "10 km", 1234567 -> "1,234.6 km" */
export function formatKm(meters) {
  const km = Math.round((Number(meters) || 0) / 100) / 10;
  const whole = Math.trunc(km);
  const decimal = Math.round(Math.abs(km - whole) * 10);
  return `${formatNumber(whole)}${decimal ? `.${decimal}` : ''} km`;
}

/** Validate a display name: trimmed, 2 to 30 characters. */
export function validateName(name) {
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2) return { ok: false, value, error: 'Name must be at least 2 characters.' };
  if (value.length > 30) return { ok: false, value, error: 'Name must be 30 characters or less.' };
  return { ok: true, value, error: null };
}

/** Validate a PIN: exactly 4 digits. */
export function validatePin(pin) {
  const value = String(pin ?? '');
  if (!/^[0-9]{4}$/.test(value)) return { ok: false, value, error: 'PIN must be exactly 4 digits.' };
  return { ok: true, value, error: null };
}

/**
 * Validate a session form. meters may be a number or a numeric string.
 * today is the local YYYY-MM-DD used to reject future dates.
 * Returns {ok, errors: {date?, meters?}, value: {date, meters}}.
 */
export function validateSession({ date, meters, today = localDateStr() } = {}) {
  const errors = {};
  const dateStr = typeof date === 'string' ? date.trim() : '';
  if (!dateStr) {
    errors.date = 'Date is required.';
  } else if (!parseDateStr(dateStr)) {
    errors.date = 'Enter a valid date.';
  } else if (dateStr > today) {
    errors.date = 'Date cannot be in the future.';
  }

  let metersNum = NaN;
  if (typeof meters === 'number') {
    metersNum = meters;
  } else if (typeof meters === 'string' && /^\s*\d+\s*$/.test(meters)) {
    metersNum = Number(meters.trim());
  }
  if (meters == null || (typeof meters === 'string' && meters.trim() === '')) {
    errors.meters = 'Distance is required.';
  } else if (!Number.isInteger(metersNum)) {
    errors.meters = 'Distance must be a whole number of meters.';
  } else if (metersNum < 1 || metersNum > MAX_METERS) {
    errors.meters = `Distance must be between 1 and ${formatNumber(MAX_METERS)} m.`;
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { date: dateStr, meters: Number.isInteger(metersNum) ? metersNum : null },
  };
}

/** Trim a pool name; empty becomes null. */
export function normalizePool(pool) {
  const value = String(pool ?? '').trim().replace(/\s+/g, ' ');
  return value ? value : null;
}

const nameCompare = (a, b) =>
  String(a).localeCompare(String(b), 'en', { sensitivity: 'base' }) ||
  (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/**
 * Monthly ranking. swimmers: [{id, name}], sessions: [{swimmerId, meters}].
 * Every swimmer appears, including those with 0 m. Sorted by meters desc, then name.
 * Ties share a rank (1, 1, 3). Returns [{rank, swimmer, meters, count}].
 */
export function buildLeaderboard(swimmers = [], sessions = []) {
  const rows = new Map();
  for (const s of swimmers) rows.set(s.id, { swimmer: { id: s.id, name: s.name }, meters: 0, count: 0 });
  for (const s of sessions) {
    let row = rows.get(s.swimmerId);
    if (!row) {
      row = { swimmer: { id: s.swimmerId, name: s.swimmerName || 'Unknown swimmer' }, meters: 0, count: 0 };
      rows.set(s.swimmerId, row);
    }
    row.meters += Number(s.meters) || 0;
    row.count += 1;
  }
  const sorted = [...rows.values()].sort(
    (a, b) => b.meters - a.meters || nameCompare(a.swimmer.name, b.swimmer.name),
  );
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.meters !== sorted[i - 1].meters) rank = i + 1;
    return { rank, ...row };
  });
}

/** Totals over a list of sessions: {meters, count, swimmers (distinct active)}. */
export function teamTotals(sessions = []) {
  const active = new Set();
  let meters = 0;
  for (const s of sessions) {
    meters += Number(s.meters) || 0;
    active.add(s.swimmerId);
  }
  return { meters, count: sessions.length, swimmers: active.size };
}

/** Newest first: by date desc, then createdAt desc. Returns a new array. */
export function sortSessionsNewestFirst(sessions = []) {
  return [...sessions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    return ca === cb ? 0 : ca < cb ? 1 : -1;
  });
}

/**
 * Personal stats. sessions should be all sessions of the swimmer (any month).
 * range is {start, end} of the month to count as "this month".
 */
export function summarizeSwimmer(sessions = [], swimmerId, range) {
  let monthMeters = 0;
  let monthCount = 0;
  let totalMeters = 0;
  let count = 0;
  for (const s of sessions) {
    if (s.swimmerId !== swimmerId) continue;
    const m = Number(s.meters) || 0;
    totalMeters += m;
    count += 1;
    if (range && s.date >= range.start && s.date < range.end) {
      monthMeters += m;
      monthCount += 1;
    }
  }
  return { monthMeters, monthCount, totalMeters, count };
}

/** Distinct pool names (case-insensitive), in the order first seen, nulls skipped. */
export function distinctPools(pools = []) {
  const seen = new Set();
  const out = [];
  for (const p of pools) {
    const value = normalizePool(p);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Scale (width, height) to fit within maxSide on the longest side. Never upscales. */
export function fitWithin(width, height, maxSide = 1600) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** First letter for an avatar bubble. */
export function initialOf(name) {
  const ch = String(name ?? '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

export const PAUSED_MESSAGE =
  "Can't reach the server. If nobody used the app for about a week, the free Supabase project may be paused. Resume it from the Supabase dashboard.";

/** Turn any thrown error (Supabase, network, our own) into a short friendly sentence. */
export function friendlyError(err, { online = true } = {}) {
  if (!online) return "You're offline. Check your connection and try again.";
  const msg = String((err && (err.message || err.error_description || err.msg)) || err || '').trim();
  const status = err && err.status;
  if (err && err.friendly && msg) return msg;
  if (status === 540 || /project.*paused/i.test(msg)) return PAUSED_MESSAGE;
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed|err_name_not_resolved|error loading dynamically imported module|importing a module script failed/i.test(msg)) {
    return PAUSED_MESSAGE;
  }
  if (/wrong name or pin/i.test(msg)) return 'Wrong name or PIN.';
  if (/already taken|duplicate key|swimmers_name_lower/i.test(msg)) {
    return 'That name is already taken. Pick another one, or sign in instead.';
  }
  if (/invalid api key|no api key|jwt|apikey/i.test(msg)) {
    return 'The app is not configured correctly. Check SUPABASE_URL and SUPABASE_ANON_KEY in config.js.';
  }
  if (/could not find the function|function .* does not exist|relation .* does not exist|schema cache/i.test(msg)) {
    return 'The database is not set up yet. Run supabase/schema.sql in the Supabase SQL editor.';
  }
  if (/quota|exceeded the quota/i.test(msg)) {
    return 'This device ran out of storage space. Try a smaller photo or delete old sessions.';
  }
  if (/payload too large|maximum allowed size|entity too large/i.test(msg)) {
    return 'That photo is too large. Try another one.';
  }
  // Errors raised on purpose by our SQL functions (plpgsql RAISE) are already friendly.
  if (err && err.code === 'P0001' && msg) return msg;
  return msg && msg.length <= 140 ? `Something went wrong: ${msg}` : 'Something went wrong. Please try again.';
}
