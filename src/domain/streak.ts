/**
 * Weekly logging streaks. A week key is an ISO week, e.g. '2026-W40'. Logging anything in a
 * week keeps the streak alive; missing a whole week resets it to 1.
 */
export type Streak = { count: number; weekKey: string };

const WEEK_MS = 7 * 86_400_000;

export function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday decides the ISO year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday (UTC) of an ISO week key. Anchored to Jan 4, which is always in week 1. */
export function weekKeyToDate(weekKey?: string | null): Date | null {
  if (!weekKey) return null;
  const [ys, ws] = weekKey.split('-W');
  const year = Number(ys);
  const week = Number(ws);
  if (!year || !week) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1);
  return new Date(monday1.getTime() + (week - 1) * WEEK_MS);
}

/** Whole weeks between two keys; 99 if either is missing or invalid. */
export function weekGap(a?: string | null, b?: string | null): number {
  const d1 = weekKeyToDate(a);
  const d2 = weekKeyToDate(b);
  if (!d1 || !d2) return 99;
  return Math.round(Math.abs(d1.getTime() - d2.getTime()) / WEEK_MS);
}

/** Count to show: alive this week or last week (so it nudges them to log before the week ends), else 0. */
export function visibleStreakCount(streak: Streak, nowKey: string): number {
  if (!streak.count) return 0;
  return weekGap(nowKey, streak.weekKey) <= 1 ? streak.count : 0;
}

/** Streak after logging activity in week `nowKey`. */
export function nextStreak(streak: Streak, nowKey: string): Streak {
  if (streak.weekKey === nowKey) return streak;
  const gap = weekGap(nowKey, streak.weekKey || '');
  return { count: gap === 1 && streak.count > 0 ? streak.count + 1 : 1, weekKey: nowKey };
}
