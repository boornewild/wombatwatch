import { getWeekKey, weekKeyToDate, weekGap, visibleStreakCount, nextStreak } from './streak';

describe('getWeekKey (ISO weeks)', () => {
  it.each([
    [new Date(2026, 8, 28), '2026-W40'], // Monday
    [new Date(2026, 9, 4), '2026-W40'], // Sunday, same week
    [new Date(2026, 9, 5), '2026-W41'], // next Monday
    [new Date(2027, 0, 1), '2026-W53'], // Jan 1 2027 belongs to 2026's last week
    [new Date(2021, 0, 3), '2020-W53'],
  ])('%s → %s', (d, key) => expect(getWeekKey(d)).toBe(key));
});

describe('weekKeyToDate / weekGap', () => {
  it('maps to the Monday of the week (UTC)', () => expect(weekKeyToDate('2026-W40')!.toISOString()).toBe('2026-09-28T00:00:00.000Z'));
  it('returns null for junk', () => {
    expect(weekKeyToDate('')).toBeNull();
    expect(weekKeyToDate('nope')).toBeNull();
  });
  it('counts weeks across a year boundary', () => expect(weekGap('2026-W53', '2027-W01')).toBe(1));
  it('is 99 when either key is missing', () => expect(weekGap('2026-W40', '')).toBe(99));
});

describe('streak rules', () => {
  const now = '2026-W40';
  it('shows the streak this week and last week, hides it after a missed week', () => {
    expect(visibleStreakCount({ count: 3, weekKey: now }, now)).toBe(3);
    expect(visibleStreakCount({ count: 3, weekKey: '2026-W39' }, now)).toBe(3);
    expect(visibleStreakCount({ count: 3, weekKey: '2026-W38' }, now)).toBe(0);
    expect(visibleStreakCount({ count: 0, weekKey: now }, now)).toBe(0);
  });
  it('logging again this week changes nothing', () => expect(nextStreak({ count: 3, weekKey: now }, now)).toEqual({ count: 3, weekKey: now }));
  it('logging the next week increments', () => expect(nextStreak({ count: 3, weekKey: '2026-W39' }, now)).toEqual({ count: 4, weekKey: now }));
  it('after a missed week it restarts at 1', () => expect(nextStreak({ count: 3, weekKey: '2026-W37' }, now)).toEqual({ count: 1, weekKey: now }));
  it('first ever log starts at 1', () => expect(nextStreak({ count: 0, weekKey: '' }, now)).toEqual({ count: 1, weekKey: now }));
});
