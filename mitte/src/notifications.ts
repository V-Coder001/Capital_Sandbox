import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const DAILY_ID = 'mitte-daily';
const WEEKLY_ID = 'mitte-weekly';

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function cancel(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Nicht geplant - nichts zu tun.
  }
}

/** Taegliche Erinnerung zur gewaehlten Uhrzeit. minutes = Minuten seit Mitternacht. */
export async function scheduleDailyReminder(minutes: number): Promise<boolean> {
  if (!(await ensurePermission())) return false;
  await cancel(DAILY_ID);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Erinnerungen',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_ID,
    content: { title: 'Mitte', body: 'Wie war dein Bauch heute?' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
    },
  });
  return true;
}

export async function cancelDailyReminder(): Promise<void> {
  await cancel(DAILY_ID);
}

/** Wochenzusammenfassung: sonntags 18 Uhr. */
export async function scheduleWeeklySummary(): Promise<boolean> {
  if (!(await ensurePermission())) return false;
  await cancel(WEEKLY_ID);
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_ID,
    content: { title: 'Deine Woche', body: 'Deine Wochenübersicht ist fertig.' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // 1 = Sonntag
      hour: 18,
      minute: 0,
    },
  });
  return true;
}

export async function cancelWeeklySummary(): Promise<void> {
  await cancel(WEEKLY_ID);
}
