import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BellyMap } from '../../components/BellyMap';
import { DayRing, WeekLine } from '../../components/Charts';
import { Card, Muted, PrimaryButton, SectionTitle } from '../../components/ui';
import { addDays, dateLong, startOfWeek } from '../../src/dates';
import { shareWeeklyPdf } from '../../src/pdf';
import { buildWeeklySummary, locationHeat, summaryLabels } from '../../src/stats';
import type { WeeklySummary } from '../../src/stats';
import { spacing, useTheme } from '../../src/theme';

export default function Week() {
  const t = useTheme();
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);

  const load = useCallback(async () => {
    setSummary(await buildWeeklySummary(addDays(startOfWeek(), offset * 7)));
  }, [offset]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!summary) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: spacing.md }}>
        <Muted>Wird berechnet …</Muted>
      </View>
    );
  }

  const labels = summaryLabels(summary);
  const allPain = summary.days.flatMap((d) => d.pain);
  const delta = summary.deltaPrevWeek;

  const share = async () => {
    try {
      await shareWeeklyPdf(summary);
    } catch {
      Alert.alert('Export fehlgeschlagen', 'Das PDF konnte nicht erstellt werden.');
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          onPress={() => setOffset((o) => o - 1)}
          accessibilityRole="button"
          accessibilityLabel="Vorherige Woche"
          style={{ fontSize: 22, color: t.primary, padding: 8 }}
        >
          ‹
        </Text>
        <Text style={{ fontSize: 15, color: t.textMuted }}>
          Woche ab {dateLong(summary.weekStart)}
        </Text>
        <Text
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
          accessibilityRole="button"
          accessibilityLabel="Nächste Woche"
          style={{ fontSize: 22, color: offset < 0 ? t.primary : t.line, padding: 8 }}
        >
          ›
        </Text>
      </View>

      <Card>
        <SectionTitle>Deine Woche in einer Zahl</SectionTitle>
        <DayRing value={summary.avgVas === null ? null : Math.round(summary.avgVas)} label="Ø Woche" />
        {delta !== null && (
          <Text style={{ textAlign: 'center', marginTop: spacing.sm, fontSize: 16, color: t.textMuted }}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {(Math.abs(delta) / 10).toFixed(1)} zur Vorwoche
          </Text>
        )}
        <View style={{ marginTop: spacing.md }}>
          <WeekLine points={summary.days.map((d) => ({ dayStart: d.dayStart, value: d.avgVas }))} />
        </View>
      </Card>

      <Card>
        <SectionTitle>Bester & schwerster Tag</SectionTitle>
        {summary.bestDay && summary.worstDay ? (
          <>
            <Text style={{ fontSize: 16, color: t.text, marginBottom: 4 }}>
              Am leichtesten: {dateLong(summary.bestDay.dayStart)} · {(summary.bestDay.avgVas! / 10).toFixed(1)}
            </Text>
            <Text style={{ fontSize: 16, color: t.text }}>
              Am schwersten: {dateLong(summary.worstDay.dayStart)} · {(summary.worstDay.avgVas! / 10).toFixed(1)}
            </Text>
          </>
        ) : (
          <Muted>Diese Woche gibt es noch keine Einträge.</Muted>
        )}
      </Card>

      <Card>
        <SectionTitle>Wo</SectionTitle>
        {allPain.length ? <BellyMap heat={locationHeat(allPain)} /> : <Muted>Keine Einträge.</Muted>}
      </Card>

      <Card>
        <SectionTitle>Wie und wann</SectionTitle>
        <Text style={{ fontSize: 16, color: t.text, marginBottom: 4 }}>
          Häufigste Art: {labels.type ?? '–'}
        </Text>
        <Text style={{ fontSize: 16, color: t.text, marginBottom: 4 }}>
          Häufigster Ort: {labels.location ?? '–'}
        </Text>
        <Text style={{ fontSize: 16, color: t.text }}>
          Meiste Einträge um: {summary.busiestHour === null ? '–' : `${summary.busiestHour}:00`}
        </Text>
      </Card>

      <Card>
        <SectionTitle>Was auffällt</SectionTitle>
        {summary.insights.length ? (
          summary.insights.map((i) => (
            <Text key={i} style={{ fontSize: 16, color: t.text, lineHeight: 23, marginBottom: spacing.sm }}>
              {i}
            </Text>
          ))
        ) : (
          <Muted>
            Für belastbare Zusammenhänge braucht Mitte mindestens drei Tage je Gruppe. Trag weiter ein.
          </Muted>
        )}
      </Card>

      <Card>
        <SectionTitle>Wasser & Empfehlungen</SectionTitle>
        <Text style={{ fontSize: 16, color: t.text, marginBottom: 4 }}>
          Ø {summary.avgWater.toFixed(1)} Gläser pro Tag
        </Text>
        <Text style={{ fontSize: 16, color: t.text }}>
          {summary.recommendationsDone} von {summary.recommendationsTotal} Hinweisen abgehakt
        </Text>
      </Card>

      <PrimaryButton title="Als PDF teilen" onPress={share} />
    </ScrollView>
  );
}
