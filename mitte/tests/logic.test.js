/**
 * Tests der reinen Auswertungslogik. Laeuft in Node, ohne Geraet und ohne Datenbank:
 *   npm test
 */
const assert = require('assert');
const { buildFacts, evaluateRules, needsSafetyNet } = require('../.tmp-test/rules.js');
const { correlations, weekStats, topOf, bucketDays } = require('../.tmp-test/analysis.js');
const { startOfWeek, startOfDay, addDays, suggestMeal, isoDate } = require('../.tmp-test/dates.js');

const day = startOfDay(new Date('2026-09-17T09:00:00'));
const pain = (h, vas, types = [], locations = ['navel']) => ({
  id: 1, timestamp: day + h * 3600e3, vas, types, locations, duration: null, note: null,
});
const intake = (h, category, kind = 'food', amount = 1) => ({
  id: 1, timestamp: day + h * 3600e3, meal: 'lunch', kind, category, amount,
});

// --- Fakten aus den Tagesdaten ---
const facts = buildFacts(
  day + 16 * 3600e3,
  {
    pain: [pain(9, 60, ['cramping'], ['lower_left'])],
    intake: [intake(8, 'coffee', 'drink'), intake(12, 'water', 'drink', 2)],
  },
  { pain: [pain(10, 30)], intake: [intake(19, 'fatty')] },
  [[pain(10, 80)], [pain(10, 90)]],
);
assert.strictEqual(facts.waterGlasses, 2, 'Wassergläser werden über amount summiert');
assert.strictEqual(facts.hour, 16);
assert.strictEqual(facts.lowerBellyToday, true);
assert.strictEqual(facts.upperBellyToday, false);
assert.strictEqual(facts.fattyYesterday, true);
assert.strictEqual(facts.coffeeBeforeMorningPain, true, 'Kaffee vor 11 Uhr + Morgenschmerz ≥ 40');
assert.strictEqual(facts.avgVasToday, 60);
assert.strictEqual(facts.highDayStreak, 0, 'heute unter 70 – die Serie startet nicht');

const streakFacts = buildFacts(
  day + 20 * 3600e3,
  { pain: [pain(9, 75)], intake: [] },
  { pain: [pain(9, 80)], intake: [] },
  [[pain(9, 80)], [pain(9, 90)], [pain(9, 10)]],
);
assert.strictEqual(streakFacts.highDayStreak, 3, 'drei Tage in Folge ≥ 70');

// --- Regelauswertung ---
const recs = evaluateRules(facts);
assert.ok(recs.length > 0 && recs.length <= 3, 'höchstens drei Karten pro Tag');
assert.ok(recs.some((r) => r.ruleId === 'coffee_empty_stomach'));
assert.ok(recs.some((r) => r.ruleId === 'cramps_lower_belly'));

// Die Wasser-Regel trifft zu, fällt aber aus den Top 3 – die Priorität entscheidet.
assert.ok(evaluateRules(facts, 20).some((r) => r.ruleId === 'water_low_afternoon'));
assert.ok(!recs.some((r) => r.ruleId === 'water_low_afternoon'));

assert.strictEqual(evaluateRules(streakFacts)[0].ruleId, 'high_streak', 'höchste Priorität zuerst');

const emptyFacts = buildFacts(day + 9 * 3600e3, { pain: [], intake: [] }, { pain: [], intake: [] }, []);
assert.ok(evaluateRules(emptyFacts).length >= 1, 'am leeren Tag greift die Fallback-Regel');

// Schwellwert, der auf einen anderen Fact zeigt (avgVasToday > avgVasYesterday)
const fattyFacts = buildFacts(
  day + 18 * 3600e3,
  { pain: [pain(9, 70)], intake: [] },
  { pain: [pain(9, 20)], intake: [intake(19, 'fatty')] },
  [],
);
assert.ok(evaluateRules(fattyFacts, 20).some((r) => r.ruleId === 'fatty_yesterday'));

// --- Sicherheitsnetz ---
assert.strictEqual(needsSafetyNet(95, null), true, 'sehr hoher Wert');
assert.strictEqual(needsSafetyNet(50, 'war Blut dabei'), true);
assert.strictEqual(needsSafetyNet(50, 'FIEBER seit gestern'), true, 'Groß-/Kleinschreibung egal');
assert.strictEqual(needsSafetyNet(50, 'alles ruhig'), false);

// --- Korrelationen ---
const mkDay = (i, hasDairy, vas) => ({
  dayStart: addDays(day, i),
  pain: [{ ...pain(12, vas), timestamp: addDays(day, i) + 12 * 3600e3 }],
  intake: hasDairy ? [{ ...intake(12, 'dairy'), timestamp: addDays(day, i) + 12 * 3600e3 }] : [],
  avgVas: vas, maxVas: vas, waterGlasses: 0,
});
const days = [
  mkDay(0, true, 70), mkDay(1, true, 75), mkDay(2, true, 72),
  mkDay(3, false, 30), mkDay(4, false, 35), mkDay(5, false, 25),
];
const cors = correlations(days);
assert.strictEqual(cors.length, 1, 'genau eine belastbare Kategorie');
assert.strictEqual(cors[0].category, 'dairy');
assert.ok(cors[0].delta > 15);

assert.strictEqual(correlations(days.slice(0, 4)).length, 0, 'unter 3 Tagen je Gruppe: keine Aussage');

const flat = [
  mkDay(0, true, 50), mkDay(1, true, 51), mkDay(2, true, 52),
  mkDay(3, false, 48), mkDay(4, false, 49), mkDay(5, false, 50),
];
assert.strictEqual(correlations(flat).length, 0, 'unter 1,5 Punkten Unterschied: keine Aussage');

// --- Wochenkennzahlen ---
const stats = weekStats(days, []);
assert.strictEqual(stats.deltaPrevWeek, null, 'ohne Vorwoche kein Vergleich');
assert.strictEqual(stats.worstDay.avgVas, 75);
assert.strictEqual(stats.bestDay.avgVas, 25);
assert.strictEqual(stats.busiestHour, 12);
assert.strictEqual(stats.topLocation.key, 'navel');

// --- Tages-Buckets ---
const buckets = bucketDays([pain(9, 40), pain(30, 60)], [intake(9, 'water', 'drink', 3)], day, 2);
assert.strictEqual(buckets.length, 2);
assert.strictEqual(buckets[0].pain.length, 1, 'der Eintrag nach 24 h gehört zum Folgetag');
assert.strictEqual(buckets[1].pain.length, 1);
assert.strictEqual(buckets[0].waterGlasses, 3);
assert.strictEqual(buckets[1].waterGlasses, 0);
assert.strictEqual(topOf([]), null);

// --- Datums-Helfer ---
assert.strictEqual(new Date(startOfWeek(day)).getDay(), 1, 'die Woche beginnt am Montag');
assert.strictEqual(isoDate(day), '2026-09-17');
assert.strictEqual(suggestMeal(day + 8 * 3600e3), 'breakfast');
assert.strictEqual(suggestMeal(day + 12 * 3600e3), 'lunch');
assert.strictEqual(suggestMeal(day + 19 * 3600e3), 'dinner');
assert.strictEqual(suggestMeal(day + 23 * 3600e3), 'snack');

console.log('Alle Tests bestanden.');
