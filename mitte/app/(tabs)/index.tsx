import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card, Muted, Row, SectionTitle } from '../../components/ui';
import { BellyMap } from '../../components/BellyMap';
import { DayRing, WeekLine } from '../../components/Charts';
import {
  intakeBetween, painEntriesBetween, recommendationsFor, saveRecommendations, setRecommendationDone,
} from '../../src/db';
import { addDays, dateLong, isoDate, startOfDay } from '../../src/dates';
import { todaysRecommendations } from '../../src/recommendations';
import { lastSevenDays, loadDays, locationHeat } from '../../src/stats';
import { DRINK_CATEGORIES, FOOD_CATEGORIES } from '../../src/types';
import type { IntakeEntry, PainEntry, Recommendation } from '../../src/types';
import { radius, spacing, useTheme } from '../../src/theme';

const LABELS = new Map(
  [...FOOD_CATEGORIES, ...DRINK_CATEGORIES].map((c) => [c.key, c.label]),
);

export default function Today() {
  const t = useTheme();
  const [pain, setPain] = useState<PainEntry[]>([]);
  const [intake, setIntake] = useState<IntakeEntry[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [week, setWeek] = useState<{ dayStart: number; value: number | null }[]>([]);
  const [weekPain, setWeekPain] = useState<PainEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const dayStart = startOfDay();
    setPain(await painEntriesBetween(dayStart, addDays(dayStart, 1)));
    setIntake(await intakeBetween(dayStart, addDays(dayStart, 1)));

    await saveRecommendations(isoDate(), await todaysRecommendations());
    setRecs(await recommendationsFor(isoDate()));

    const days = await loadDays(lastSevenDays(), 7);
    setWeek(days.map((d) => ({ dayStart: d.dayStart, value: d.avgVas })));
    setWeekPain(days.flatMap((d) => d.pain));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const avgToday = pain.length
    ? Math.round(pain.reduce((s, p) => s + p.vas, 0) / pain.length)
    : null;
  const water = intake.filter((i) => i.category === 'water').reduce((s, i) => s + i.amount, 0);
  const otherIntake = intake.filter((i) => i.category !== 'water');

  const toggleRec = async (r: Recommendation) => {
    await setRecommendationDone(r.id, !r.done);
    setRecs(await recommendationsFor(isoDate()));
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 120, gap: spacing.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={t.primary}
          />
        }
      >
        <View>
          <Text style={{ fontSize: 15, color: t.textMuted }}>{dateLong(Date.now())}</Text>
          <Text style={{ fontSize: 28, fontWeight: '700', color: t.text }}>Wie geht es dir?</Text>
        </View>

        <Card>
          <DayRing value={avgToday} label="Ø heute" />
          <Text style={{ textAlign: 'center', color: t.textMuted, marginTop: spacing.sm }}>
            {pain.length === 0
              ? 'Noch kein Eintrag heute'
              : `${pain.length} ${pain.length === 1 ? 'Eintrag' : 'Einträge'} heute`}
          </Text>
        </Card>

        <Card>
          <SectionTitle>Letzte 7 Tage</SectionTitle>
          {weekPain.length === 0 ? (
            <Muted>Sobald du ein paar Tage einträgst, entsteht hier deine Linie.</Muted>
          ) : (
            <WeekLine points={week} onPressDay={() => router.push('/verlauf')} />
          )}
        </Card>

        <Card>
          <SectionTitle>Heute gegessen & getrunken</SectionTitle>
          <Row>
            <Pressable
              onPress={() => router.push('/essen')}
              accessibilityRole="button"
              accessibilityLabel={`Wasser: ${water} Gläser`}
              style={{
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                backgroundColor: t.primarySoft, marginRight: spacing.xs, marginBottom: spacing.xs,
              }}
            >
              <Text style={{ color: t.primary, fontSize: 16 }}>💧 {water} Gläser</Text>
            </Pressable>
            {otherIntake.length === 0 ? (
              <Muted>Noch nichts eingetragen.</Muted>
            ) : (
              otherIntake.map((i) => (
                <View
                  key={i.id}
                  style={{
                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                    borderWidth: 1, borderColor: t.line,
                    marginRight: spacing.xs, marginBottom: spacing.xs,
                  }}
                >
                  <Text style={{ color: t.text, fontSize: 15 }}>
                    {LABELS.get(i.category) ?? i.category}
                  </Text>
                </View>
              ))
            )}
          </Row>
        </Card>

        <Card>
          <SectionTitle>Für heute</SectionTitle>
          {recs.length === 0 ? (
            <Muted>Keine Hinweise für heute.</Muted>
          ) : (
            recs.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => toggleRec(r)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: r.done }}
                style={{
                  flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
                  paddingVertical: spacing.sm,
                }}
              >
                <Text style={{ fontSize: 18, color: r.done ? t.primary : t.textMuted }}>
                  {r.done ? '✓' : '○'}
                </Text>
                <Text
                  style={{
                    flex: 1, fontSize: 16, lineHeight: 23,
                    color: r.done ? t.textMuted : t.text,
                    textDecorationLine: r.done ? 'line-through' : 'none',
                  }}
                >
                  {r.text}
                </Text>
              </Pressable>
            ))
          )}
        </Card>

        <Card>
          <SectionTitle>Wo diese Woche</SectionTitle>
          {weekPain.length === 0 ? (
            <Muted>Die Heatmap füllt sich mit deinen Einträgen.</Muted>
          ) : (
            <BellyMap heat={locationHeat(weekPain)} />
          )}
        </Card>
      </ScrollView>

      <View style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, gap: spacing.sm }}>
        <Pressable
          onPress={() => router.push('/essen')}
          accessibilityRole="button"
          style={{
            backgroundColor: t.card, borderRadius: radius, paddingVertical: 14,
            alignItems: 'center', borderWidth: 1, borderColor: t.line,
          }}
        >
          <Text style={{ color: t.text, fontSize: 16 }}>Essen & Trinken</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/eintrag')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            backgroundColor: t.primary, opacity: pressed ? 0.85 : 1,
            borderRadius: radius, paddingVertical: 18, alignItems: 'center',
          })}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600' }}>+ Eintrag</Text>
        </Pressable>
      </View>
    </View>
  );
}
