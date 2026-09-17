import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card, Chip, Muted, Row, SectionTitle } from '../../components/ui';
import { addDays, dateLong, startOfDay, timeShort } from '../../src/dates';
import { painEntriesBetween } from '../../src/db';
import { painColor, spacing, useTheme } from '../../src/theme';
import {
  LOCATION_LABELS, LOCATIONS, PAIN_TYPES, PAIN_TYPE_LABELS,
} from '../../src/types';
import type { Location, PainEntry, PainType } from '../../src/types';

const RANGE_DAYS = 30;

export default function History() {
  const t = useTheme();
  const [entries, setEntries] = useState<PainEntry[]>([]);
  const [locationFilter, setLocationFilter] = useState<Location | null>(null);
  const [typeFilter, setTypeFilter] = useState<PainType | null>(null);

  const load = useCallback(async () => {
    const from = addDays(startOfDay(), -(RANGE_DAYS - 1));
    setEntries(await painEntriesBetween(from, addDays(startOfDay(), 1)));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = entries.filter(
    (e) =>
      (!locationFilter || e.locations.includes(locationFilter)) &&
      (!typeFilter || e.types.includes(typeFilter)),
  );

  const byDay = new Map<number, PainEntry[]>();
  filtered.forEach((e) => {
    const day = startOfDay(e.timestamp);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      <Card>
        <SectionTitle>Filter</SectionTitle>
        <Row>
          {LOCATIONS.map((l) => (
            <Chip
              key={l}
              label={LOCATION_LABELS[l]}
              selected={locationFilter === l}
              onPress={() => setLocationFilter(locationFilter === l ? null : l)}
            />
          ))}
        </Row>
        <View style={{ height: spacing.sm }} />
        <Row>
          {PAIN_TYPES.map((p) => (
            <Chip
              key={p}
              label={PAIN_TYPE_LABELS[p]}
              selected={typeFilter === p}
              onPress={() => setTypeFilter(typeFilter === p ? null : p)}
            />
          ))}
        </Row>
      </Card>

      {byDay.size === 0 ? (
        <Card>
          <Muted>
            {entries.length === 0
              ? 'Noch keine Einträge in den letzten 30 Tagen.'
              : 'Keine Einträge passen zu diesem Filter.'}
          </Muted>
        </Card>
      ) : (
        [...byDay.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([day, list]) => (
            <Card key={day}>
              <SectionTitle>{dateLong(day)}</SectionTitle>
              {list.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => router.push(`/eintrag/${e.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${timeShort(e.timestamp)}, Stärke ${(e.vas / 10).toFixed(1)}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    gap: spacing.sm, paddingVertical: spacing.sm,
                  }}
                >
                  <View
                    style={{
                      width: 42, height: 42, borderRadius: 21,
                      backgroundColor: painColor(e.vas, t),
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: '#2E2A27' }}>
                      {(e.vas / 10).toFixed(0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: t.text }}>
                      {e.locations.map((l) => LOCATION_LABELS[l]).join(', ') || 'ganzer Bauch'}
                    </Text>
                    <Text style={{ fontSize: 14, color: t.textMuted }}>
                      {timeShort(e.timestamp)}
                      {e.types.length ? ` · ${e.types.map((p) => PAIN_TYPE_LABELS[p]).join(', ')}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: t.textMuted, fontSize: 20 }}>›</Text>
                </Pressable>
              ))}
            </Card>
          ))
      )}
    </ScrollView>
  );
}
