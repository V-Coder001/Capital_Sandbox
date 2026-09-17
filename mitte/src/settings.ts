import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  onboarded: boolean;
  consentHealthData: boolean;
  reminderEnabled: boolean;
  /** Minuten seit Mitternacht. */
  reminderMinutes: number;
  weeklySummaryEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  consentHealthData: false,
  reminderEnabled: false,
  reminderMinutes: 20 * 60,
  weeklySummaryEnabled: true,
};

const KEY = 'mitte.settings.v1';

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function resetSettings(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export function formatMinutes(m: number): string {
  return `${`${Math.floor(m / 60)}`.padStart(2, '0')}:${`${m % 60}`.padStart(2, '0')}`;
}
