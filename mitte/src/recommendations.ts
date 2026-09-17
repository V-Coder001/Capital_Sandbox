import { addDays, startOfDay } from './dates';
import { intakeBetween, painEntriesBetween } from './db';
import { buildFacts, evaluateRules } from './rules';
import type { PainEntry } from './types';

/** Laedt die Tagesdaten aus der lokalen Datenbank und wertet die Regeln aus. */
export async function todaysRecommendations(
  now = Date.now(),
): Promise<{ ruleId: string; text: string }[]> {
  const dayStart = startOfDay(now);
  const today = {
    pain: await painEntriesBetween(dayStart, addDays(dayStart, 1)),
    intake: await intakeBetween(dayStart, addDays(dayStart, 1)),
  };
  const yStart = addDays(dayStart, -1);
  const yesterday = {
    pain: await painEntriesBetween(yStart, dayStart),
    intake: await intakeBetween(yStart, dayStart),
  };

  // Die Vortage brauchen wir nur fuer die Serie hoher Werte.
  const previousDays: PainEntry[][] = [yesterday.pain];
  for (let i = 2; i <= 6; i += 1) {
    const s = addDays(dayStart, -i);
    previousDays.push(await painEntriesBetween(s, addDays(s, 1)));
  }

  return evaluateRules(buildFacts(now, today, yesterday, previousDays));
}
