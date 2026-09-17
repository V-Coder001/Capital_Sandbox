import rulesFile from './rules.json';
import type { IntakeEntry, PainEntry } from './types';

export type Facts = {
  hour: number;
  waterGlasses: number;
  painEntriesToday: number;
  avgVasToday: number;
  maxVasToday: number;
  avgVasYesterday: number;
  highDayStreak: number;
  typesToday: string[];
  foodsToday: string[];
  drinksToday: string[];
  lowerBellyToday: boolean;
  upperBellyToday: boolean;
  fattyYesterday: boolean;
  alcoholYesterday: boolean;
  coffeeBeforeMorningPain: boolean;
};

type Condition = {
  fact: keyof Facts;
  lt?: number | string;
  lte?: number | string;
  gt?: number | string;
  gte?: number | string;
  eq?: number | string;
  includes?: string;
  isTrue?: boolean;
};

type Rule = { id: string; priority: number; when: { all: Condition[] }; text: string };

const RULES = rulesFile.rules as Rule[];
export const SAFETY_NET = rulesFile.safetyNet;

/** Ein Schwellwert darf entweder eine Zahl oder der Name eines anderen Facts sein. */
function resolve(value: number | string, facts: Facts): number {
  if (typeof value === 'number') return value;
  const v = facts[value as keyof Facts];
  return typeof v === 'number' ? v : NaN;
}

function matches(cond: Condition, facts: Facts): boolean {
  const actual = facts[cond.fact];
  if (cond.includes !== undefined) {
    return Array.isArray(actual) && actual.includes(cond.includes);
  }
  if (cond.isTrue !== undefined) return actual === cond.isTrue;
  if (typeof actual !== 'number') return false;
  if (cond.lt !== undefined && !(actual < resolve(cond.lt, facts))) return false;
  if (cond.lte !== undefined && !(actual <= resolve(cond.lte, facts))) return false;
  if (cond.gt !== undefined && !(actual > resolve(cond.gt, facts))) return false;
  if (cond.gte !== undefined && !(actual >= resolve(cond.gte, facts))) return false;
  if (cond.eq !== undefined && actual !== resolve(cond.eq, facts)) return false;
  return true;
}

export function evaluateRules(facts: Facts, max = 3): { ruleId: string; text: string }[] {
  return RULES.filter((r) => r.when.all.every((c) => matches(c, facts)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max)
    .map((r) => ({ ruleId: r.id, text: r.text }));
}

const UPPER = ['upper_left', 'stomach', 'upper_right'];
const LOWER = ['lower_left', 'lower_center', 'lower_right'];

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function buildFacts(
  now: number,
  today: { pain: PainEntry[]; intake: IntakeEntry[] },
  yesterday: { pain: PainEntry[]; intake: IntakeEntry[] },
  previousDays: PainEntry[][],
): Facts {
  const vasToday = today.pain.map((p) => p.vas);
  const typesToday = [...new Set(today.pain.flatMap((p) => p.types as string[]))];
  const locationsToday = new Set(today.pain.flatMap((p) => p.locations as string[]));
  const foodsToday = [...new Set(today.intake.filter((i) => i.kind === 'food').map((i) => i.category))];
  const drinksToday = [...new Set(today.intake.filter((i) => i.kind === 'drink').map((i) => i.category))];

  const morningCoffee = today.intake.some(
    (i) => i.category === 'coffee' && new Date(i.timestamp).getHours() < 11,
  );
  const morningPain = today.pain.some(
    (p) => new Date(p.timestamp).getHours() < 12 && p.vas >= 40,
  );

  // Aufeinanderfolgende Tage (heute rueckwaerts) mit einem Maximalwert >= 70.
  let streak = 0;
  for (const day of [today.pain, ...previousDays]) {
    const dayMax = day.length ? Math.max(...day.map((p) => p.vas)) : 0;
    if (dayMax >= 70) streak += 1;
    else break;
  }

  return {
    hour: new Date(now).getHours(),
    waterGlasses: today.intake
      .filter((i) => i.category === 'water')
      .reduce((sum, i) => sum + i.amount, 0),
    painEntriesToday: today.pain.length,
    avgVasToday: Math.round(avg(vasToday)),
    maxVasToday: vasToday.length ? Math.max(...vasToday) : 0,
    avgVasYesterday: Math.round(avg(yesterday.pain.map((p) => p.vas))),
    highDayStreak: streak,
    typesToday,
    foodsToday,
    drinksToday,
    lowerBellyToday: LOWER.some((l) => locationsToday.has(l)),
    upperBellyToday: UPPER.some((l) => locationsToday.has(l)),
    fattyYesterday: yesterday.intake.some(
      (i) => i.category === 'fatty' || i.category === 'convenience',
    ),
    alcoholYesterday: yesterday.intake.some((i) => i.category === 'alcohol'),
    coffeeBeforeMorningPain: morningCoffee && morningPain,
  };
}

/** Sicherheitsnetz: sehr hoher Wert oder Warnwort in der Notiz. */
export function needsSafetyNet(vas: number, note: string | null): boolean {
  if (vas >= SAFETY_NET.vasThreshold) return true;
  if (!note) return false;
  const lower = note.toLowerCase();
  return SAFETY_NET.keywords.some((k) => lower.includes(k));
}
