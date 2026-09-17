import { useColorScheme } from 'react-native';

const light = {
  bg: '#FBF7F2',
  card: '#FFFFFF',
  primary: '#6F9C86',
  primarySoft: '#E4EDE8',
  accent: '#E8A87C',
  text: '#2E2A27',
  textMuted: '#7A7167',
  line: '#EDE5DB',
  painLow: '#A8C9B4',
  painMid: '#E9C98B',
  painHigh: '#E07A6B',
};

const dark: typeof light = {
  bg: '#1B1A19',
  card: '#262422',
  primary: '#86B39D',
  primarySoft: '#303934',
  accent: '#EDB48D',
  text: '#F2EDE7',
  textMuted: '#A29889',
  line: '#3A3733',
  painLow: '#8FB29C',
  painMid: '#CBAE79',
  painHigh: '#C46F62',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Mischt zwei Hex-Farben. t = 0 -> a, t = 1 -> b. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Farbe fuer einen VAS-Wert (0-100). Nie allein verwenden - Zahl immer mit anzeigen. */
export function painColor(vas: number, t: Theme): string {
  const v = Math.max(0, Math.min(100, vas)) / 100;
  return v <= 0.5 ? mix(t.painLow, t.painMid, v * 2) : mix(t.painMid, t.painHigh, (v - 0.5) * 2);
}

export const radius = 22;
export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };
