import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateStr,
  parseDateStr,
  monthKey,
  monthOf,
  monthRange,
  shiftMonth,
  compareMonths,
  formatMonthLabel,
  formatDateLabel,
  formatNumber,
  formatMeters,
  formatKm,
  validateName,
  validatePin,
  validateSession,
  normalizePool,
  buildLeaderboard,
  teamTotals,
  sortSessionsNewestFirst,
  summarizeSwimmer,
  distinctPools,
  fitWithin,
  initialOf,
  friendlyError,
  UserError,
  PAUSED_MESSAGE,
} from '../logic.js';

describe('localDateStr', () => {
  test('formats a local date as YYYY-MM-DD with zero padding', () => {
    assert.equal(localDateStr(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(localDateStr(new Date(2026, 9, 1)), '2026-10-01');
  });

  test('uses local time, not UTC (late evening stays on the same day)', () => {
    const lateEvening = new Date(2026, 9, 31, 23, 59, 30);
    assert.equal(localDateStr(lateEvening), '2026-10-31');
    const justAfterMidnight = new Date(2026, 10, 1, 0, 0, 5);
    assert.equal(localDateStr(justAfterMidnight), '2026-11-01');
  });

  test('does not shift when TZ offset would change the UTC day', () => {
    // Midnight local: in any timezone east of UTC toISOString() would give the previous day.
    const d = new Date(2026, 2, 1, 0, 30);
    assert.equal(localDateStr(d), '2026-03-01');
    assert.equal(localDateStr(d), `${d.getFullYear()}-03-01`);
  });

  test('defaults to now', () => {
    assert.match(localDateStr(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseDateStr', () => {
  test('parses valid dates', () => {
    assert.deepEqual(parseDateStr('2026-10-01'), { year: 2026, month: 10, day: 1 });
    assert.deepEqual(parseDateStr('2024-02-29'), { year: 2024, month: 2, day: 29 });
  });
  test('rejects invalid dates', () => {
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-1-1', '', null, 20261001, '2026/10/01']) {
      assert.equal(parseDateStr(bad), null, String(bad));
    }
  });
});

describe('months', () => {
  test('monthKey from Date, string and object', () => {
    assert.equal(monthKey(new Date(2026, 11, 31, 23, 0)), '2026-12');
    assert.equal(monthKey('2026-03-15'), '2026-03');
    assert.equal(monthKey({ year: 2027, month: 1 }), '2027-01');
    assert.throws(() => monthKey('nope'));
    assert.throws(() => monthKey({}));
  });

  test('monthOf', () => {
    assert.deepEqual(monthOf('2026-10-09'), { year: 2026, month: 10 });
    assert.deepEqual(monthOf(new Date(2026, 0, 1)), { year: 2026, month: 1 });
  });

  test('monthRange gives first day and exclusive first day of next month', () => {
    assert.deepEqual(monthRange(2026, 10), { start: '2026-10-01', end: '2026-11-01' });
    assert.deepEqual(monthRange(2026, 2), { start: '2026-02-01', end: '2026-03-01' });
  });

  test('monthRange December rolls over to January of next year', () => {
    assert.deepEqual(monthRange(2026, 12), { start: '2026-12-01', end: '2027-01-01' });
  });

  test('monthRange works with string comparison on boundaries', () => {
    const { start, end } = monthRange(2026, 10);
    const inRange = (d) => d >= start && d < end;
    assert.equal(inRange('2026-09-30'), false);
    assert.equal(inRange('2026-10-01'), true);
    assert.equal(inRange('2026-10-31'), true);
    assert.equal(inRange('2026-11-01'), false);
  });

  test('shiftMonth across year boundaries', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth({ year: 2027, month: 1 }, -1), { year: 2026, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 10 }, 0), { year: 2026, month: 10 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 3 }, -15), { year: 2024, month: 12 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 3 }, 22), { year: 2028, month: 1 });
  });

  test('compareMonths', () => {
    assert.ok(compareMonths({ year: 2026, month: 12 }, { year: 2027, month: 1 }) < 0);
    assert.equal(compareMonths({ year: 2026, month: 5 }, { year: 2026, month: 5 }), 0);
    assert.ok(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 }) > 0);
  });

  test('formatMonthLabel', () => {
    assert.equal(formatMonthLabel({ year: 2026, month: 10 }), 'October 2026');
    assert.equal(formatMonthLabel({ year: 2027, month: 1 }), 'January 2027');
  });

  test('formatDateLabel', () => {
    assert.equal(formatDateLabel('2026-10-01'), 'Thu 1 Oct');
    assert.equal(formatDateLabel('2026-10-01', 2026), 'Thu 1 Oct');
    assert.equal(formatDateLabel('2025-12-25', 2026), 'Thu 25 Dec 2025');
    assert.equal(formatDateLabel('garbage'), 'garbage');
  });
});

describe('formatting numbers', () => {
  test('formatNumber', () => {
    assert.equal(formatNumber(0), '0');
    assert.equal(formatNumber(999), '999');
    assert.equal(formatNumber(1000), '1,000');
    assert.equal(formatNumber(1234567), '1,234,567');
    assert.equal(formatNumber(-2500), '-2,500');
    assert.equal(formatNumber('abc'), '0');
  });
  test('formatMeters', () => {
    assert.equal(formatMeters(12500), '12,500 m');
    assert.equal(formatMeters(0), '0 m');
    assert.equal(formatMeters(50), '50 m');
  });
  test('formatKm', () => {
    assert.equal(formatKm(12500), '12.5 km');
    assert.equal(formatKm(10000), '10 km');
    assert.equal(formatKm(1250), '1.3 km');
    assert.equal(formatKm(0), '0 km');
    assert.equal(formatKm(1234567), '1,234.6 km');
  });
});

describe('validation', () => {
  test('validateName trims and enforces 2..30', () => {
    assert.deepEqual(validateName('  Alice  '), { ok: true, value: 'Alice', error: null });
    assert.equal(validateName('Jo').ok, true);
    assert.equal(validateName('J').ok, false);
    assert.equal(validateName('   ').ok, false);
    assert.equal(validateName(undefined).ok, false);
    assert.equal(validateName('x'.repeat(30)).ok, true);
    assert.equal(validateName('x'.repeat(31)).ok, false);
    assert.equal(validateName('Mary   Ann').value, 'Mary Ann');
  });

  test('validatePin requires exactly 4 digits', () => {
    assert.equal(validatePin('1234').ok, true);
    assert.equal(validatePin('0000').ok, true);
    for (const bad of ['123', '12345', 'abcd', '12 4', '', null, undefined, '１２３４']) {
      assert.equal(validatePin(bad).ok, false, String(bad));
    }
    assert.equal(validatePin(1234).ok, true);
  });

  const today = '2026-10-15';

  test('validateSession accepts a valid session (string or number meters)', () => {
    const r = validateSession({ date: '2026-10-15', meters: '1500', today });
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { date: '2026-10-15', meters: 1500 });
    assert.equal(validateSession({ date: '2026-10-01', meters: 1, today }).ok, true);
    assert.equal(validateSession({ date: '2025-01-01', meters: 20000, today }).ok, true);
    assert.equal(validateSession({ date: '2026-10-15', meters: ' 750 ', today }).ok, true);
  });

  test('validateSession requires the date and rejects future or invalid dates', () => {
    assert.ok(validateSession({ date: '', meters: 100, today }).errors.date);
    assert.ok(validateSession({ meters: 100, today }).errors.date);
    assert.ok(validateSession({ date: '2026-10-16', meters: 100, today }).errors.date);
    assert.ok(validateSession({ date: '2026-02-30', meters: 100, today }).errors.date);
    assert.equal(validateSession({ date: '2026-10-16', meters: 100, today }).ok, false);
  });

  test('validateSession meters must be an integer 1..20000', () => {
    for (const bad of [0, -5, 20001, 1.5, '1.5', '12a', '', '   ', null, undefined, NaN, '1e3']) {
      const r = validateSession({ date: today, meters: bad, today });
      assert.equal(r.ok, false, `meters=${String(bad)}`);
      assert.ok(r.errors.meters, `meters=${String(bad)}`);
    }
    assert.match(validateSession({ date: today, meters: 30000, today }).errors.meters, /20,000/);
  });

  test('validateSession reports both errors at once', () => {
    const r = validateSession({ date: '', meters: '', today });
    assert.deepEqual(Object.keys(r.errors).sort(), ['date', 'meters']);
  });

  test('normalizePool', () => {
    assert.equal(normalizePool('  Piscine   du Centre '), 'Piscine du Centre');
    assert.equal(normalizePool('   '), null);
    assert.equal(normalizePool(null), null);
  });
});

describe('buildLeaderboard', () => {
  const swimmers = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'bob' },
    { id: 'c', name: 'Chloe' },
    { id: 'd', name: 'Dan' },
  ];

  test('sums meters and counts sessions, sorted by meters desc', () => {
    const sessions = [
      { swimmerId: 'a', meters: 1000 },
      { swimmerId: 'b', meters: 3000 },
      { swimmerId: 'a', meters: 1500 },
      { swimmerId: 'c', meters: 500 },
    ];
    const rows = buildLeaderboard(swimmers, sessions);
    assert.deepEqual(rows.map((r) => [r.rank, r.swimmer.id, r.meters, r.count]), [
      [1, 'b', 3000, 1],
      [2, 'a', 2500, 2],
      [3, 'c', 500, 1],
      [4, 'd', 0, 0],
    ]);
  });

  test('includes swimmers with zero meters', () => {
    const rows = buildLeaderboard(swimmers, []);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.meters === 0 && r.count === 0 && r.rank === 1));
    // Sorted by name case-insensitively when tied.
    assert.deepEqual(rows.map((r) => r.swimmer.name), ['Alice', 'bob', 'Chloe', 'Dan']);
  });

  test('ties share a rank and the next rank skips (1, 1, 3)', () => {
    const sessions = [
      { swimmerId: 'c', meters: 2000 },
      { swimmerId: 'a', meters: 2000 },
      { swimmerId: 'b', meters: 1000 },
    ];
    const rows = buildLeaderboard(swimmers, sessions);
    assert.deepEqual(rows.map((r) => [r.rank, r.swimmer.name]), [
      [1, 'Alice'],
      [1, 'Chloe'],
      [3, 'bob'],
      [4, 'Dan'],
    ]);
  });

  test('zero meter swimmers tie together at the bottom', () => {
    const rows = buildLeaderboard(swimmers, [{ swimmerId: 'd', meters: 100 }]);
    assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2, 2]);
  });

  test('sessions of unknown swimmers still count, with their name', () => {
    const rows = buildLeaderboard([{ id: 'a', name: 'Alice' }], [{ swimmerId: 'z', swimmerName: 'Zed', meters: 50 }]);
    assert.deepEqual(rows.map((r) => r.swimmer.name), ['Zed', 'Alice']);
  });

  test('handles empty input and does not mutate arguments', () => {
    assert.deepEqual(buildLeaderboard(), []);
    const sw = [{ id: 'a', name: 'A1' }];
    const se = [{ swimmerId: 'a', meters: '700' }];
    const rows = buildLeaderboard(sw, se);
    assert.equal(rows[0].meters, 700);
    assert.deepEqual(sw, [{ id: 'a', name: 'A1' }]);
  });
});

describe('aggregates', () => {
  const sessions = [
    { id: '1', swimmerId: 'a', date: '2026-10-02', meters: 1000, createdAt: '2026-10-02T10:00:00Z' },
    { id: '2', swimmerId: 'b', date: '2026-10-05', meters: 2000, createdAt: '2026-10-05T08:00:00Z' },
    { id: '3', swimmerId: 'a', date: '2026-09-30', meters: 500, createdAt: '2026-09-30T19:00:00Z' },
    { id: '4', swimmerId: 'a', date: '2026-10-05', meters: 750, createdAt: '2026-10-05T18:00:00Z' },
  ];

  test('teamTotals', () => {
    assert.deepEqual(teamTotals(sessions), { meters: 4250, count: 4, swimmers: 2 });
    assert.deepEqual(teamTotals([]), { meters: 0, count: 0, swimmers: 0 });
  });

  test('sortSessionsNewestFirst by date then createdAt', () => {
    assert.deepEqual(sortSessionsNewestFirst(sessions).map((s) => s.id), ['4', '2', '1', '3']);
    assert.deepEqual(sessions.map((s) => s.id), ['1', '2', '3', '4'], 'input untouched');
  });

  test('summarizeSwimmer splits month and all time', () => {
    const r = summarizeSwimmer(sessions, 'a', monthRange(2026, 10));
    assert.deepEqual(r, { monthMeters: 1750, monthCount: 2, totalMeters: 2250, count: 3 });
    assert.deepEqual(summarizeSwimmer(sessions, 'zzz', monthRange(2026, 10)), {
      monthMeters: 0, monthCount: 0, totalMeters: 0, count: 0,
    });
  });

  test('distinctPools dedupes case-insensitively and skips empties', () => {
    assert.deepEqual(distinctPools(['Neptune', null, 'neptune ', '', 'Olympic  Pool', 'Olympic Pool']), ['Neptune', 'Olympic Pool']);
  });
});

describe('misc helpers', () => {
  test('fitWithin downsizes the longest side and never upscales', () => {
    assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
    assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1600, 10, 1600), { width: 1600, height: 10 });
  });

  test('initialOf', () => {
    assert.equal(initialOf(' alice'), 'A');
    assert.equal(initialOf(''), '?');
  });

  test('friendlyError maps common failures', () => {
    assert.match(friendlyError(new TypeError('Failed to fetch')), /paused/);
    assert.equal(friendlyError(new TypeError('Load failed')), PAUSED_MESSAGE);
    assert.equal(friendlyError({ message: '', status: 540 }), PAUSED_MESSAGE);
    assert.match(friendlyError(new Error('x'), { online: false }), /offline/);
    assert.equal(friendlyError({ message: 'Wrong name or PIN.', code: 'P0001' }), 'Wrong name or PIN.');
    assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "swimmers_name_lower_idx"' }), /taken/);
    assert.match(friendlyError({ message: 'Could not find the function public.add_session in the schema cache' }), /schema\.sql/);
    assert.match(friendlyError({ message: 'Invalid API key' }), /config\.js/);
    assert.equal(friendlyError(new UserError('Custom friendly text.')), 'Custom friendly text.');
    assert.equal(friendlyError({ message: 'Pool name is too long (80 characters max).', code: 'P0001' }), 'Pool name is too long (80 characters max).');
    assert.equal(friendlyError(null), 'Something went wrong. Please try again.');
    assert.match(friendlyError(new Error('boom')), /boom/);
  });
});
