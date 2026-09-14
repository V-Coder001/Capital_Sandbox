// Kleine Helfer, die beide Seiten brauchen.
export async function hole(pfad, optionen) {
  const antwort = await fetch(pfad, optionen);
  const text = await antwort.text();
  let daten = null;
  try { daten = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  if (!antwort.ok) throw new Error(daten?.fehler || `Fehler ${antwort.status}`);
  return daten;
}

export function dauer(sekunden) {
  if (!sekunden) return '';
  const m = Math.floor(sekunden / 60);
  const s = Math.floor(sekunden % 60);
  return `${m}:${String(s).padStart(2, '0')} min`;
}

export function datum(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}
