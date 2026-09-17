import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { BellyMap } from '../components/BellyMap';
import { VasSlider } from '../components/VasSlider';
import { Card, Chip, Muted, PrimaryButton, Row, SectionTitle } from '../components/ui';
import { addPainEntry, lastPainEntry } from '../src/db';
import { SAFETY_NET, needsSafetyNet } from '../src/rules';
import { radius, spacing, useTheme } from '../src/theme';
import {
  DURATION_LABELS, LOCATIONS, PAIN_TYPES, PAIN_TYPE_LABELS,
} from '../src/types';
import type { Duration, Location, PainType } from '../src/types';

const DURATIONS: Duration[] = ['now', '1-3h', 'morning', 'all_day'];

export default function QuickEntry() {
  const t = useTheme();
  const [locations, setLocations] = useState<Location[]>([]);
  const [types, setTypes] = useState<PainType[]>([]);
  const [vas, setVas] = useState(30);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Die letzte Auswahl vorbelegen - Wiederholungen gehen so schneller.
  useEffect(() => {
    lastPainEntry().then((last) => {
      if (!last) return;
      setLocations(last.locations);
      setTypes(last.types);
    });
  }, []);

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const persist = async () => {
    setSaving(true);
    try {
      await addPainEntry({
        timestamp: Date.now(),
        locations,
        types,
        vas,
        duration,
        note: note.trim() ? note.trim() : null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (locations.length === 0) {
      Alert.alert('Wo tut es weh?', 'Tippe mindestens ein Feld auf der Bauchkarte an.');
      return;
    }
    // Sicherheitsnetz: muss bestaetigt werden, laesst sich aber nicht wegwischen.
    if (needsSafetyNet(vas, note)) {
      Alert.alert('Kurzer Hinweis', SAFETY_NET.text, [
        { text: 'Verstanden', onPress: persist },
      ], { cancelable: false });
      return;
    }
    persist();
  };

  const allSelected = locations.length === LOCATIONS.length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <SectionTitle>Wo?</SectionTitle>
        <BellyMap
          selected={locations}
          onToggle={(l) => toggle(locations, setLocations, l)}
        />
        <Row style={{ marginTop: spacing.sm }}>
          <Chip
            label="ganzer Bauch"
            selected={allSelected}
            onPress={() => setLocations(allSelected ? [] : [...LOCATIONS])}
          />
        </Row>
      </Card>

      <Card>
        <SectionTitle>Wie fühlt es sich an?</SectionTitle>
        <Row>
          {PAIN_TYPES.map((p) => (
            <Chip
              key={p}
              label={PAIN_TYPE_LABELS[p]}
              selected={types.includes(p)}
              onPress={() => toggle(types, setTypes, p)}
            />
          ))}
        </Row>
      </Card>

      <Card>
        <SectionTitle>Wie stark?</SectionTitle>
        <VasSlider value={vas} onChange={setVas} />
      </Card>

      <Card>
        <SectionTitle>Seit wann?</SectionTitle>
        <Row>
          {DURATIONS.map((d) => (
            <Chip
              key={d}
              label={DURATION_LABELS[d]}
              selected={duration === d}
              onPress={() => setDuration(duration === d ? null : d)}
            />
          ))}
        </Row>
        <Muted>Optional</Muted>
      </Card>

      <Card>
        <SectionTitle>Notiz</SectionTitle>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Optional – was war heute anders?"
          placeholderTextColor={t.textMuted}
          multiline
          style={{
            minHeight: 70, fontSize: 16, color: t.text,
            backgroundColor: t.bg, borderRadius: radius - 6, padding: spacing.sm,
            textAlignVertical: 'top',
          }}
        />
      </Card>

      <PrimaryButton title={saving ? 'Speichert …' : 'Speichern'} onPress={save} disabled={saving} />
    </ScrollView>
  );
}
