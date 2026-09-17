export function startOfDay(d: Date | number = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function addDays(ts: number, n: number): number {
  const x = new Date(ts);
  x.setDate(x.getDate() + n);
  return x.getTime();
}

/** Montag 00:00 der Woche, in der ts liegt. */
export function startOfWeek(ts: number = Date.now()): number {
  const x = new Date(startOfDay(ts));
  const shift = (x.getDay() + 6) % 7;
  return addDays(x.getTime(), -shift);
}

export function isoDate(ts: number = Date.now()): string {
  const x = new Date(ts);
  const m = `${x.getMonth() + 1}`.padStart(2, '0');
  const d = `${x.getDate()}`.padStart(2, '0');
  return `${x.getFullYear()}-${m}-${d}`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function weekdayShort(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()];
}

export function timeShort(ts: number): string {
  const x = new Date(ts);
  return `${`${x.getHours()}`.padStart(2, '0')}:${`${x.getMinutes()}`.padStart(2, '0')}`;
}

export function dateLong(ts: number): string {
  return new Date(ts).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** Mahlzeit-Vorschlag nach Uhrzeit. */
export function suggestMeal(ts: number = Date.now()): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = new Date(ts).getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}
