import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Muted, PrimaryButton, SectionTitle } from '../components/ui';
import { formatMinutes, saveSettings } from '../src/settings';
import { scheduleDailyReminder, scheduleWeeklySummary } from '../src/notifications';
import { spacing, useTheme } from '../src/theme';

const PAGES = 3;

export default function Onboarding() {
  const t = useTheme();
  const [page, setPage] = useState(0);
  const [consent, setConsent] = useState(false);
  const [reminder, setReminder] = useState(true);
  const [minutes, setMinutes] = useState(20 * 60);

  const finish = async () => {
    await saveSettings({
      onboarded: true,
      consentHealthData: consent,
      reminderEnabled: reminder,
      reminderMinutes: minutes,
    });
    if (reminder) {
      await scheduleDailyReminder(minutes);
      await scheduleWeeklySummary();
    }
    router.replace('/');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: 80, gap: spacing.lg }}
    >
      {page === 0 && (
        <>
          <Text style={{ fontSize: 34, fontWeight: '700', color: t.text }}>Mitte</Text>
          <Muted>
            Ein ruhiges Tagebuch für deinen Bauch. Du hältst fest, wo und wie stark es wehtut und
            was du gegessen und getrunken hast. Nach einer Woche zeigt dir Mitte, was auffällt.
          </Muted>
          <Card>
            <SectionTitle>Ein Eintrag dauert unter 30 Sekunden</SectionTitle>
            <Muted>Ort antippen, Stärke wischen, speichern. Alles andere ist optional.</Muted>
          </Card>
        </>
      )}

      {page === 1 && (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: t.text }}>
            Kein Medizinprodukt
          </Text>
          <Muted>
            Mitte ist ein Tagebuch zur Selbstbeobachtung und ersetzt keine ärztliche Beratung.
            Die App stellt keine Diagnosen und gibt keine Behandlungsempfehlungen – nur allgemeine
            Alltagshinweise.
          </Muted>
          <Card>
            <SectionTitle>Deine Daten bleiben auf dem Gerät</SectionTitle>
            <Muted>
              Alle Einträge werden lokal gespeichert. Es gibt kein Konto und keinen Server.
              Du kannst sie jederzeit im Profil vollständig löschen.
            </Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.sm }}>
              <Switch value={consent} onValueChange={setConsent} />
              <Text style={{ flex: 1, fontSize: 15, color: t.text, lineHeight: 21 }}>
                Ich willige ein, dass Mitte meine Gesundheitsdaten lokal auf diesem Gerät speichert.
              </Text>
            </View>
          </Card>
        </>
      )}

      {page === 2 && (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: t.text }}>Erinnerung</Text>
          <Muted>Eine kurze Frage am Abend hilft, das Tagebuch durchzuhalten.</Muted>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, color: t.text }}>Täglich erinnern</Text>
              <Switch value={reminder} onValueChange={setReminder} />
            </View>
            {reminder && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }}>
                <Text style={{ fontSize: 17, color: t.text, flex: 1 }}>Uhrzeit</Text>
                <Text
                  onPress={() => setMinutes((m) => (m - 60 + 24 * 60) % (24 * 60))}
                  accessibilityRole="button"
                  accessibilityLabel="Eine Stunde früher"
                  style={{ fontSize: 24, color: t.primary, paddingHorizontal: 12 }}
                >
                  −
                </Text>
                <Text style={{ fontSize: 20, fontWeight: '600', color: t.text }}>
                  {formatMinutes(minutes)}
                </Text>
                <Text
                  onPress={() => setMinutes((m) => (m + 60) % (24 * 60))}
                  accessibilityRole="button"
                  accessibilityLabel="Eine Stunde später"
                  style={{ fontSize: 24, color: t.primary, paddingHorizontal: 12 }}
                >
                  +
                </Text>
              </View>
            )}
          </Card>
        </>
      )}

      <View style={{ marginTop: spacing.md }}>
        <PrimaryButton
          title={page === PAGES - 1 ? 'Los geht’s' : 'Weiter'}
          disabled={page === 1 && !consent}
          onPress={() => (page === PAGES - 1 ? finish() : setPage((p) => p + 1))}
        />
        {page === 1 && !consent ? (
          <Text style={{ marginTop: spacing.sm, fontSize: 14, color: t.textMuted, textAlign: 'center' }}>
            Ohne Einwilligung kann Mitte keine Einträge speichern.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
