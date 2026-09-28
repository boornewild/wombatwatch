import { loadStreak, activeStreakCount, touchStreak, STREAK_KEY } from './streakStorage';

const memoryStore = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, data };
};

it('uses the legacy localStorage key', () => expect(STREAK_KEY).toBe('ww_streak'));

it('loads a default when empty or corrupt', () => {
  expect(loadStreak(memoryStore())).toEqual({ count: 0, weekKey: '' });
  expect(loadStreak(memoryStore({ ww_streak: '{not json' }))).toEqual({ count: 0, weekKey: '' });
});

it('touchStreak saves and returns the new count', () => {
  const store = memoryStore({ ww_streak: JSON.stringify({ count: 2, weekKey: '2026-W39' }) });
  expect(touchStreak(store, new Date(2026, 8, 30))).toBe(3);
  expect(JSON.parse(store.data.ww_streak!)).toEqual({ count: 3, weekKey: '2026-W40' });
});

it('activeStreakCount reads storage and applies expiry', () => {
  const store = memoryStore({ ww_streak: JSON.stringify({ count: 5, weekKey: '2026-W30' }) });
  expect(activeStreakCount(store, new Date(2026, 8, 30))).toBe(0);
});

it('ignores storage write failures (private browsing)', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  expect(touchStreak(store, new Date(2026, 8, 30))).toBe(1);
});
