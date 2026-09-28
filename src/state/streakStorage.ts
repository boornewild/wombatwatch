/** Persists the volunteer's streak in localStorage under the legacy key. Rules live in domain/streak.ts. */
import { getWeekKey, nextStreak, visibleStreakCount, type Streak } from '../domain/streak';

export const STREAK_KEY = 'ww_streak';
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export function loadStreak(store: KeyValueStore = localStorage): Streak {
  try {
    return JSON.parse(store.getItem(STREAK_KEY) ?? 'null') || { count: 0, weekKey: '' };
  } catch {
    return { count: 0, weekKey: '' };
  }
}

export function activeStreakCount(store: KeyValueStore = localStorage, now: Date = new Date()): number {
  return visibleStreakCount(loadStreak(store), getWeekKey(now));
}

/** Records activity this week; returns the new count. */
export function touchStreak(store: KeyValueStore = localStorage, now: Date = new Date()): number {
  const next = nextStreak(loadStreak(store), getWeekKey(now));
  try {
    store.setItem(STREAK_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the streak just won't persist.
  }
  return next.count;
}
