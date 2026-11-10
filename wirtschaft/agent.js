/* KI-Testfond (Haiku 5.5) — reine Logik, ohne Netzwerk im Kern.
 *
 * Der Agent bekommt pro Markttag eine Lage und gibt Orders zurück. Der Server
 * prüft jede Antwort gegen feste Grenzen; ungültige Antworten werden verworfen
 * und der Fond rechnet mit dem bisherigen Algorithmus weiter.
 *
 * Der API-Schlüssel kommt nur aus der Server-Umgebung (ANTHROPIC_API_KEY) und
 * wird nie an den Browser gesendet. Ohne Schlüssel ist der Fond ausgeschaltet. */

export const AGENT_MODELL = "claude-haiku-5-5";
export const AGENT_MAX_ANTEIL = 0.04;        // höchstens 4 % des Bestands je Tag
export const AGENT_MAX_ORDERS = 3;           // je Antwort höchstens drei Orders
export const AGENT_TIMEOUT_MS = 8000;

export const schluesselVorhanden = (env = process.env) => Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim());

/* Lage für den Agenten: nur Zahlen, keine Anweisungen aus dem Spiel. */
export function lageText({ tag, leitzins, inflation10, kurse, bestand, bargeld }) {
  const zeilen = Object.entries(kurse).map(([n, k]) => `- ${n}: ${k.toFixed(2)}`).join("\n");
  return [
    `Markttag ${tag}. Leitzins ${(leitzins * 100).toFixed(1)} %. Inflation (10 Tage) ${(inflation10 * 100).toFixed(1)} %.`,
    `Aktienkurse:\n${zeilen}`,
    `Dein Bestand: ${bestand} Stück, Bargeld ${bargeld.toFixed(0)}.`,
    `Antworte NUR mit JSON: {"orders":[{"firma":"<Name>","menge":<ganze Zahl>}]}. Menge positiv = kaufen, negativ = verkaufen. Höchstens ${AGENT_MAX_ORDERS} Orders.`,
  ].join("\n");
}

/* Prüft die Antwort des Agenten gegen Regeln. Gibt bereinigte Orders zurück oder null. */
export function orderPruefen(antwortText, { bestand, bargeld, kurse, anteilMax = AGENT_MAX_ANTEIL }) {
  let obj;
  try { obj = JSON.parse(antwortText); } catch { return null; }
  if (!obj || !Array.isArray(obj.orders)) return null;
  const gueltig = [];
  for (const o of obj.orders.slice(0, AGENT_MAX_ORDERS)) {
    if (typeof o?.firma !== "string" || !Number.isInteger(o.menge)) continue;
    if (!(o.firma in kurse)) continue;
    const kurs = kurse[o.firma];
    if (!(kurs > 0)) continue;
    // Kaufen: höchstens anteilMax des Bargelds je Tag. Verkaufen: höchstens anteilMax des Bestands je Tag.
    let menge = o.menge;
    if (menge > 0) menge = Math.min(menge, Math.floor(anteilMax * bargeld / kurs));
    if (menge < 0) menge = Math.max(menge, -Math.floor(anteilMax * (bestand[o.firma] || 0)));
    if (menge !== 0) gueltig.push({ firma: o.firma, menge });
  }
  return gueltig;
}

/* Ruft die Anthropic-API auf. Liefert den Text der Antwort oder null bei Fehler/Zeitüberschreitung. */
export async function agentFragen(lage, { apiKey, fetchFn = fetch, modell = AGENT_MODELL } = {}) {
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AGENT_TIMEOUT_MS);
  try {
    const r = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modell, max_tokens: 300,
        system: "Du handelst an einer Simulationsbörse. Antworte nur mit dem verlangten JSON.",
        messages: [{ role: "user", content: lage }] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.content?.find(c => c.type === "text")?.text ?? null;
  } catch { return null; }
  finally { clearTimeout(t); }
}
