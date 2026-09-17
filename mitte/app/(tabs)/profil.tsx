import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Card, Muted, Row, SectionTitle } from '../../components/ui';
import { customTiles, deleteCustomTile, wipeAllData } from '../../src/db';
import {
  cancelDailyReminder, cancelWeeklySummary, scheduleDailyReminder, scheduleWeeklySummary,
} from '../../src/notifications';
import { DEFAULT_SETTINGS, formatMinutes, loadSettings, saveSettings } from '../../src/settings';
import type { Settings } from '../../src/settings';
import { spacing, useTheme } from '../../src/theme';

export default function Profile() {
  const t = useTheme();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tiles, setTiles] = useState<{ id: number; label: string; kind: 'food' | 'drink' }[]>([]);

  const reloadTiles = async () => {
    const food = (await customTiles('food')).map((c) => ({ ...c, kind: 'food' as const }));
    const drink = (await customTiles('drink')).map((c) => ({ ...c, kind: 'drink' as const }));
    setTiles([...food, ...drink]);
  };

  useEffect(() => {
    loadSettings().then(setSettings);
    reloadTiles();
  }, []);

  const patch = async (p: Partial<Settings>) => setSettings(await saveSettings(p));

  const toggleReminder = async (enabled: boolean) => {
    await patch({ reminderEnabled: enabled });
    if (enabled) {
      const ok = await scheduleDailyReminder(settings.reminderMinutes);
      if (!ok) {
        Alert.alert('Keine Berechtigung', 'Erlaube Mitteilungen in den Systemeinstellungen.');
        await patch({ reminderEnabled: false });
      }
    } else {
      await cancelDailyReminder();
    }
  };

  const shiftReminder = async (deltaMinutes: number) => {
    const minutes = (settings.reminderMinutes + deltaMinutes + 24 * 60) % (24 * 60);
    await patch({ reminderMinutes: minutes });
    if (settings.reminderEnabled) await scheduleDailyReminder(minutes);
  };

  const toggleWeekly = async (enabled: boolean) => {
    await patch({ weeklySummaryEnabled: enabled });
    if (enabled) await scheduleWeeklySummary();
    else await cancelWeeklySummary();
  };

  const deleteEverything = () => {
    Alert.alert(
      'Alle Daten löschen?',
      'Alle Einträge, Kacheln und Hinweise werden vom Gerät entfernt. Das lässt sich nicht rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Endgültig löschen',
          style: 'destructive',
          onPress: async () => {
            await wipeAllData();
            await reloadTiles();
            Alert.alert('Gelöscht', 'Es sind keine Daten mehr gespeichert.');
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      <Card>
        <SectionTitle>Erinnerungen</SectionTitle>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 17, color: t.text }}>Täglich erinnern</Text>
          <Switch value={settings.reminderEnabled} onValueChange={toggleReminder} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md }}>
          <Text style={{ fontSize: 17, color: t.text, flex: 1 }}>Uhrzeit</Text>
          <Text
            onPress={() => shiftReminder(-30)}
            accessibilityRole="button"
            accessibilityLabel="30 Minuten früher"
            style={{ fontSize: 24, color: t.primary, paddingHorizontal: 14 }}
          >
            −
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '600', color: t.text }}>
            {formatMinutes(settings.reminderMinutes)}
          </Text>
          <Text
            onPress={() => shiftReminder(30)}
            accessibilityRole="button"
            accessibilityLabel="30 Minuten später"
            style={{ fontSize: 24, color: t.primary, paddingHorizontal: 14 }}
          >
            +
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between', marginTop: spacing.md,
          }}
        >
          <Text style={{ fontSize: 17, color: t.text, flex: 1 }}>
            Wochenübersicht sonntags 18 Uhr
          </Text>
          <Switch value={settings.weeklySummaryEnabled} onValueChange={toggleWeekly} />
        </View>
      </Card>

      <Card>
        <SectionTitle>Eigene Kacheln</SectionTitle>
        {tiles.length === 0 ? (
          <Muted>Noch keine. Du legst sie beim Eintragen von Essen & Trinken an.</Muted>
        ) : (
          <Row>
            {tiles.map((c) => (
              <Pressable
                key={`${c.kind}-${c.id}`}
                onPress={() =>
                  Alert.alert('Kachel löschen?', c.label, [
                    { text: 'Abbrechen', style: 'cancel' },
                    {
                      text: 'Löschen',
                      style: 'destructive',
                      onPress: async () => { await deleteCustomTile(c.id); await reloadTiles(); },
                    },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel={`${c.label} löschen`}
                style={{
                  paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999,
                  borderWidth: 1, borderColor: t.line,
                  marginRight: spacing.xs, marginBottom: spacing.xs,
                }}
              >
                <Text style={{ fontSize: 16, color: t.text }}>{c.label} ✕</Text>
              </Pressable>
            ))}
          </Row>
        )}
      </Card>

      <Card>
        <SectionTitle>Datenschutz</SectionTitle>
        <Muted>
          Alle Einträge liegen ausschließlich lokal auf diesem Gerät. Es gibt kein Konto, keinen
          Server und keine Analyse-SDKs. Du kannst alles jederzeit vollständig löschen.
        </Muted>
        <Text
          onPress={deleteEverything}
          accessibilityRole="button"
          style={{ color: t.painHigh, fontSize: 16, paddingVertical: spacing.md }}
        >
          Alle Daten löschen
        </Text>
      </Card>

      <Card>
        <SectionTitle>Über Mitte</SectionTitle>
        <Muted>
          Mitte ist ein Tagebuch zur Selbstbeobachtung. Die App stellt keine Diagnosen, empfiehlt
          keine Behandlungen und ersetzt keine ärztliche Beratung. Bei sehr starken oder
          ungewöhnlichen Beschwerden wende dich bitte an eine Ärztin oder einen Arzt – im Notfall 112.
        </Muted>
      </Card>
    </ScrollView>
  );
}
