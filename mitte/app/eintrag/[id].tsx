import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BellyMap } from '../../components/BellyMap';
import { VasSlider } from '../../components/VasSlider';
import { Card, Chip, Muted, PrimaryButton, Row, SectionTitle } from '../../components/ui';
import { deletePainEntry, getPainEntry, updatePainEntry } from '../../src/db';
import { dateLong, timeShort } from '../../src/dates';
import { radius, spacing, useTheme } from '../../src/theme';
import { DURATION_LABELS, PAIN_TYPES, PAIN_TYPE_LABELS } from '../../src/types';
import type { Duration, Location, PainEntry, PainType } from '../../src/types';

const DURATIONS: Duration[] = ['now', '1-3h', 'morning', 'all_day'];

export default function EntryDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<PainEntry | null>(null);

  useEffect(() => {
    getPainEntry(Number(id)).then(setEntry);
  }, [id]);

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: spacing.md }}>
        <Muted>Eintrag wird geladen …</Muted>
      </View>
    );
  }

  const patch = (p: Partial<PainEntry>) => setEntry({ ...entry, ...p });

  const toggleLocation = (l: Location) =>
    patch({
      locations: entry.locations.includes(l)
        ? entry.locations.filter((x) => x !== l)
        : [...entry.locations, l],
    });

  const toggleType = (p: PainType) =>
    patch({
      types: entry.types.includes(p) ? entry.types.filter((x) => x !== p) : [...entry.types, p],
    });

  const remove = () => {
    Alert.alert('Eintrag löschen?', 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await deletePainEntry(entry.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      <Text style={{ fontSize: 15, color: t.textMuted }}>
        {dateLong(entry.timestamp)} · {timeShort(entry.timestamp)}
      </Text>

      <Card>
        <SectionTitle>Wo?</SectionTitle>
        <BellyMap selected={entry.locations} onToggle={toggleLocation} />
      </Card>

      <Card>
        <SectionTitle>Wie fühlte es sich an?</SectionTitle>
        <Row>
          {PAIN_TYPES.map((p) => (
            <Chip
              key={p}
              label={PAIN_TYPE_LABELS[p]}
              selected={entry.types.includes(p)}
              onPress={() => toggleType(p)}
            />
          ))}
        </Row>
      </Card>

      <Card>
        <SectionTitle>Wie stark?</SectionTitle>
        <VasSlider value={entry.vas} onChange={(vas) => patch({ vas })} />
      </Card>

      <Card>
        <SectionTitle>Seit wann?</SectionTitle>
        <Row>
          {DURATIONS.map((d) => (
            <Chip
              key={d}
              label={DURATION_LABELS[d]}
              selected={entry.duration === d}
              onPress={() => patch({ duration: entry.duration === d ? null : d })}
            />
          ))}
        </Row>
      </Card>

      <Card>
        <SectionTitle>Notiz</SectionTitle>
        <TextInput
          value={entry.note ?? ''}
          onChangeText={(note) => patch({ note })}
          multiline
          placeholder="Optional"
          placeholderTextColor={t.textMuted}
          style={{
            minHeight: 70, fontSize: 16, color: t.text, backgroundColor: t.bg,
            borderRadius: radius - 6, padding: spacing.sm, textAlignVertical: 'top',
          }}
        />
      </Card>

      <PrimaryButton
        title="Änderungen speichern"
        onPress={async () => {
          await updatePainEntry(entry);
          router.back();
        }}
      />
      <Text
        onPress={remove}
        accessibilityRole="button"
        style={{ textAlign: 'center', color: t.painHigh, fontSize: 16, paddingVertical: spacing.md }}
      >
        Eintrag löschen
      </Text>
    </ScrollView>
  );
}
