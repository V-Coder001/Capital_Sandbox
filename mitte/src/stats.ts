import { addDays, isoDate, startOfDay, startOfWeek } from './dates';
import { intakeBetween, painEntriesBetween, recommendationsFor } from './db';
import { bucketDays, correlations, phraseInsight, weekStats } from './analysis';
import type { DayBucket, WeekStats } from './analysis';
import { DRINK_CATEGORIES, FOOD_CATEGORIES, LOCATION_LABELS, PAIN_TYPE_LABELS } from './types';

export { locationHeat, correlations } from './analysis';
export type { DayBucket, Correlation } from './analysis';

const CATEGORY_LABELS = new Map(
  [...FOOD_CATEGORIES, ...DRINK_CATEGORIES].map((c) => [c.key, c.label]),
);

export async function loadDays(firstDayStart: number, count: number): Promise<DayBucket[]> {
  const until = addDays(firstDayStart, count);
  const pain = await painEntriesBetween(firstDayStart, until);
  const intake = await intakeBetween(firstDayStart, until);
  return bucketDays(pain, intake, firstDayStart, count);
}

export function lastSevenDays(now = Date.now()): number {
  return addDays(startOfDay(now), -6);
}

export type WeeklySummary = WeekStats & {
  weekStart: number;
  days: DayBucket[];
  recommendationsDone: number;
  recommendationsTotal: number;
  insights: string[];
};

export async function buildWeeklySummary(weekStart = startOfWeek()): Promise<WeeklySummary> {
  const days = await loadDays(weekStart, 7);
  const prevDays = await loadDays(addDays(weekStart, -7), 7);

  let done = 0;
  let total = 0;
  for (const d of days) {
    const recs = await recommendationsFor(isoDate(d.dayStart));
    total += recs.length;
    done += recs.filter((r) => r.done).length;
  }

  // Der Montag danach zaehlt mit, damit der Folgetag-Effekt der Sonntagsmahlzeit sichtbar wird.
  const withFollowUp = [...days, ...(await loadDays(addDays(weekStart, 7), 1))];
  const insights = correlations(withFollowUp)
    .slice(0, 2)
    .map((c) => phraseInsight(c, CATEGORY_LABELS.get(c.category) ?? c.category));

  return {
    ...weekStats(days, prevDays),
    weekStart,
    days,
    recommendationsDone: done,
    recommendationsTotal: total,
    insights,
  };
}

export function summaryLabels(s: WeeklySummary): { location: string | null; type: string | null } {
  return {
    location: s.topLocation ? LOCATION_LABELS[s.topLocation.key] : null,
    type: s.topType ? PAIN_TYPE_LABELS[s.topType.key] : null,
  };
}
