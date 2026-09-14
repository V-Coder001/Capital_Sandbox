// Kleine Helfer, die beide Seiten brauchen.
export async function hole(pfad, optionen) {
  const antwort = await fetch(pfad, { credentials: 'same-origin', ...optionen });
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

// Anmelde-Schleuse: zeigt ein Passwortfeld, bis die Rolle passt.
export async function anmeldung(huelle, { brauchtAdmin = false } = {}) {
  let rolle = (await hole('/api/ich').catch(() => ({ rolle: null }))).rolle;
  const passt = () => rolle && (!brauchtAdmin || rolle === 'admin');
  if (passt()) return rolle;

  huelle.innerHTML = `
    <h1>Geschichten</h1>
    <p class="unterzeile">${brauchtAdmin ? 'Erzähler-Passwort, bitte.' : 'Kurz anmelden, dann geht es los.'}</p>
    <form class="karte" id="anmeldeform">
      <label for="pw">Passwort</label>
      <input type="password" id="pw" autocomplete="current-password" autofocus>
      <p class="fehler" id="anmeldefehler"></p>
      <button type="submit">Anmelden</button>
    </form>`;

  return new Promise((fertig) => {
    const form = huelle.querySelector('#anmeldeform');
    const fehler = huelle.querySelector('#anmeldefehler');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fehler.textContent = '';
      try {
        const antwort = await hole('/api/anmelden', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ passwort: form.querySelector('#pw').value }),
        });
        rolle = antwort.rolle;
        if (!passt()) { fehler.textContent = 'Dieses Passwort darf hier nicht hochladen.'; return; }
        fertig(rolle);
      } catch (err) {
        fehler.textContent = err.message;
      }
    });
  });
}
