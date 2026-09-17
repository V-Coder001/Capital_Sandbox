import { addDays } from './dates';
import type { IntakeEntry, Location, PainEntry, PainType } from './types';

/**
 * Reine Auswertungslogik ohne Datenbank- oder Expo-Abhaengigkeiten,
 * damit sie sich in Node testen laesst.
 */

export type DayBucket = {
  dayStart: number;
  pain: PainEntry[];
  intake: IntakeEntry[];
  avgVas: number | null;
  maxVas: number | null;
  waterGlasses: number;
};

export function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function topOf<T extends string>(values: T[]): { key: T; count: number } | null {
  const counts = new Map<T, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best: { key: T; count: number } | null = null;
  counts.forEach((count, key) => {
    if (best === null || count > best.count) best = { key, count };
  });
  return best;
}

/** Teilt flache Eintragslisten in Tage auf. */
export function bucketDays(
  pain: PainEntry[], intake: IntakeEntry[], firstDayStart: number, count: number,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let i = 0; i < count; i += 1) {
    const dayStart = addDays(firstDayStart, i);
    const dayEnd = addDays(firstDayStart, i + 1);
    const p = pain.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);
    const it = intake.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd);
    const vas = p.map((e) => e.vas);
    buckets.push({
      dayStart,
      pain: p,
      intake: it,
      avgVas: avg(vas),
      maxVas: vas.length ? Math.max(...vas) : null,
      waterGlasses: it.filter((e) => e.category === 'water').reduce((s, e) => s + e.amount, 0),
    });
  }
  return buckets;
}

/** Wie oft tat jedes Bauchfeld im Zeitraum weh - fuer die Heatmap. */
export function locationHeat(entries: PainEntry[]): Record<string, number> {
  const heat: Record<string, number> = {};
  entries.forEach((e) => e.locations.forEach((l) => { heat[l] = (heat[l] ?? 0) + 1; }));
  return heat;
}

export type Correlation = { category: string; withAvg: number; withoutAvg: number; delta: number };

/** Mindestens so viele Tage je Gruppe, sonst sagen wir nichts. */
export const MIN_DAYS_PER_GROUP = 3;
/** Mindestunterschied auf der 0-100-Skala, also 1,5 Punkte in der Anzeige. */
export const MIN_DELTA = 15;

/**
 * Pro Kategorie Durchschnitts-VAS an Tagen MIT vs. OHNE, inklusive Folgetag bis 12 Uhr.
 * Bewusst konservativ: lieber nichts zeigen als einen Zufall als Muster verkaufen.
 */
export function correlations(days: DayBucket[]): Correlation[] {
  const categories = [...new Set(days.flatMap((d) => d.intake.map((i) => i.category)))];
  const out: Correlation[] = [];

  for (const category of categories) {
    const withVas: number[] = [];
    const withoutVas: number[] = [];

    days.forEach((day, idx) => {
      const hasCategory = day.intake.some((i) => i.category === category);
      const relevant = [...day.pain];
      const next = days[idx + 1];
      if (next) {
        relevant.push(...next.pain.filter((p) => new Date(p.timestamp).getHours() < 12));
      }
      const dayAvg = avg(relevant.map((p) => p.vas));
      if (dayAvg === null) return;
      (hasCategory ? withVas : withoutVas).push(dayAvg);
    });

    if (withVas.length < MIN_DAYS_PER_GROUP || withoutVas.length < MIN_DAYS_PER_GROUP) continue;
    const a = avg(withVas)!;
    const b = avg(withoutVas)!;
    if (Math.abs(a - b) < MIN_DELTA) continue;
    out.push({ category, withAvg: a, withoutAvg: b, delta: a - b });
  }

  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export type WeekStats = {
  avgVas: number | null;
  deltaPrevWeek: number | null;
  topLocation: { key: Location; count: number } | null;
  topType: { key: PainType; count: number } | null;
  bestDay: DayBucket | null;
  worstDay: DayBucket | null;
  busiestHour: number | null;
  avgWater: number;
};

/** Kennzahlen einer Woche aus fertigen Tages-Buckets. */
export function weekStats(days: DayBucket[], prevDays: DayBucket[]): WeekStats {
  const allPain = days.flatMap((d) => d.pain);
  const avgVas = avg(allPain.map((p) => p.vas));
  const prevAvg = avg(prevDays.flatMap((d) => d.pain).map((p) => p.vas));
  const rated = days.filter((d) => d.avgVas !== null);
  const hour = topOf(allPain.map((p) => String(new Date(p.timestamp).getHours())));

  return {
    avgVas,
    deltaPrevWeek: avgVas !== null && prevAvg !== null ? avgVas - prevAvg : null,
    topLocation: topOf(allPain.flatMap((p) => p.locations)),
    topType: topOf(allPain.flatMap((p) => p.types)),
    bestDay: rated.length ? rated.reduce((a, b) => (a.avgVas! <= b.avgVas! ? a : b)) : null,
    worstDay: rated.length ? rated.reduce((a, b) => (a.avgVas! >= b.avgVas! ? a : b)) : null,
    busiestHour: hour ? Number(hour.key) : null,
    avgWater: days.length ? days.reduce((s, d) => s + d.waterGlasses, 0) / days.length : 0,
  };
}

/** Formuliert Korrelationen vorsichtig - "faellt auf", nie "verursacht". */
export function phraseInsight(c: Correlation, label: string): string {
  const richtung = c.delta > 0 ? 'höher' : 'niedriger';
  return `An Tagen mit „${label}“ lag dein Wert im Schnitt ${(Math.abs(c.delta) / 10).toFixed(1)} Punkte ${richtung}. Das fällt auf – ein Beweis ist es nicht.`;
}
