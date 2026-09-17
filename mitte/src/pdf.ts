import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { dateLong, weekdayShort } from './dates';
import { summaryLabels } from './stats';
import type { WeeklySummary } from './stats';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function buildHtml(s: WeeklySummary): string {
  const labels = summaryLabels(s);
  const rows = s.days
    .map((d) => {
      const value = d.avgVas === null ? '–' : (d.avgVas / 10).toFixed(1);
      const max = d.maxVas === null ? '–' : (d.maxVas / 10).toFixed(1);
      return `<tr><td>${weekdayShort(d.dayStart)}, ${dateLong(d.dayStart)}</td>
        <td>${d.pain.length}</td><td>${value}</td><td>${max}</td><td>${d.waterGlasses}</td></tr>`;
    })
    .join('');

  const insights = s.insights.length
    ? `<ul>${s.insights.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '<p>Für belastbare Zusammenhänge reichen die Daten dieser Woche noch nicht.</p>';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, sans-serif; color: #2E2A27; padding: 32px; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin-top: 28px; }
  .muted { color: #7A7167; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #EDE5DB; }
  .note { margin-top: 32px; font-size: 12px; color: #7A7167; border-top: 1px solid #EDE5DB; padding-top: 12px; }
</style></head><body>
<h1>Mitte – Wochenübersicht</h1>
<p class="muted">Woche ab ${dateLong(s.weekStart)}</p>

<h2>Überblick</h2>
<p>Durchschnittliche Stärke: <strong>${s.avgVas === null ? '–' : (s.avgVas / 10).toFixed(1)} / 10</strong>
${s.deltaPrevWeek === null ? '' : ` (${s.deltaPrevWeek >= 0 ? '+' : '−'}${(Math.abs(s.deltaPrevWeek) / 10).toFixed(1)} zur Vorwoche)`}<br>
Häufigster Ort: ${labels.location ?? '–'}<br>
Häufigste Art: ${labels.type ?? '–'}<br>
Tageszeit mit den meisten Einträgen: ${s.busiestHour === null ? '–' : `${s.busiestHour}:00`}<br>
Wasser: ⌀ ${s.avgWater.toFixed(1)} Gläser pro Tag</p>

<h2>Tage</h2>
<table><tr><th>Tag</th><th>Einträge</th><th>⌀</th><th>Max</th><th>Wasser</th></tr>${rows}</table>

<h2>Was auffällt</h2>
${insights}

<p class="note">Erstellt mit Mitte. Diese Übersicht ist ein Selbstbeobachtungs-Tagebuch,
keine medizinische Auswertung und ersetzt keine ärztliche Beratung.</p>
</body></html>`;
}

/** Erzeugt das PDF und oeffnet den Teilen-Dialog. */
export async function shareWeeklyPdf(summary: WeeklySummary): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildHtml(summary) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}
