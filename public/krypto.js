/* ============================================================
 * Krypto-Börse im Stadtnetz
 * ------------------------------------------------------------
 * Jede Software-Firma mit Börse bekommt eine eigene Seite im Stadtnetz,
 * erreichbar unter NETZ.seite = "krypto:<firmaId>". Die Seite ist wie die
 * Warenbörse aufgebaut — links die Coins, in der Mitte Kurs und Verlauf,
 * daneben das Handelsformular, darunter Orderbuch und eigene Aufträge.
 * Gehandelt werden Coins, keine Aktien: Sie werden von Software-Firmen
 * ausgegeben und sind ungedeckt (siehe coins.js auf dem Server).
 * ============================================================ */

/* Kursverlauf je Coin, clientseitig gesammelt (alle 10 s ein Punkt, wie priceHist) */
const KR_HIST = {};
let krLetzterPunkt = 0;

function kryptoVerlauf(state) {
  if (!state?.krypto) return;
  if (state.tick === krLetzterPunkt) return;
  krLetzterPunkt = state.tick;
  if (state.tick % 10) return;
  for (const c of state.krypto.coins) {
    const h = (KR_HIST[c.id] ??= []);
    h.push(c.kurs);
    if (h.length > 90) h.shift();
  }
}

/* Von jedem Render aufgerufen: Verlauf sammeln und, wenn die Krypto-Seite
 * offen ist, neu zeichnen. Das Panel im Dock gibt es nicht mehr. */
function kryptoRendern(state) {
  kryptoVerlauf(state);
}

/* Bekanntheit in Worten und als Balken — der Wert selbst sagt Spielern nichts. */
const krHypeWort = h => h >= 0.55 ? t("im Trend") : h >= 0.2 ? t("bekannt") : h >= -0.1 ? t("kaum beachtet") : t("vergessen");
const krHypeBalken = h => { const n = Math.max(0, Math.min(5, Math.round((h + 0.35) / 0.31))); return "▮".repeat(n) + "▯".repeat(5 - n); };
const coinName = c => escapeHtml(rohText(c?.name || "—"));
const krBoerseVon = (state, id) => (state.krypto?.boersen || []).find(b => b.firmaId === id);
const krCoinVon = (state, id) => (state.krypto?.coins || []).find(c => c.id === id);
const krListet = (state, boerseId, coin) => coin.firmaId === boerseId ||
  (state.krypto?.vertraege || []).some(v => v.boerseId === boerseId && v.coinId === coin.id);
/* Coins, die diese Börse führt: der eigene plus alle mit Vertrag */
const krCoins = (state, boerseId) => (state.krypto?.coins || []).filter(c => krListet(state, boerseId, c));

/* Die Seite einer Börse. Wird aus netzZeichnen aufgerufen, wenn
 * NETZ.seite mit "krypto:" beginnt. */
function kryptoSeite(fenster, state, me, myId) {
  const bId = NETZ.seite.slice(7);
  const b = krBoerseVon(state, bId), firma = state.players?.[bId];
  if (!b || !firma) return netzOeffnen(null);
  const farbe = firma.color || "#7c3aed";
  fenster.querySelector(".sfBrowser").style.setProperty("--sys", farbe);
  /* Stromausfall im Rechenzentrum: die Börse ist dann nicht erreichbar. */
  const offline = b.online === false;
  const banner = fenster.querySelector(".sfBanner");
  banner.hidden = !offline;
  if (offline) netzSetze(".sfBanner", `<b>⚠</b><span>${t("Börse gerade offline")} — ${t("das Rechenzentrum der Firma läuft nicht.")}</span>`, "krOff" + bId);
  fenster.querySelector(".sfHinweis").hidden = true;

  const coins = krCoins(state, bId);
  if (!NETZ.krCoin || !coins.some(c => c.id === NETZ.krCoin)) NETZ.krCoin = coins[0]?.id || null;
  const coin = coins.find(c => c.id === NETZ.krCoin) || null;
  const konto = me?.kryptoKonto?.[bId] || null;
  const meins = bId === myId;
  const name = pid => String(pid).startsWith("buerger") ? t("Stadtbewohner") : escapeHtml(rohText(state.players?.[pid]?.name || "—"));

  netzSetze(".sfUrl", `🔒 ${shopSlug(firma.name)}-coins.cs${coin ? "/" + shopSlug(coin.name) : ""}`, "krUrl" + bId + NETZ.krCoin);
  netzSetze(".sfKopf", `<div class="sfMarke">${logoHtml(bId, "sfLogo", farbe)}<div><b>${name(bId)} ${t("Coins")}</b><small>${t("Krypto-Börse")} · ${t("Gebühr")} ${(b.gebuehr * 100).toFixed(1)} % · ${coins.length} ${t("Coins gelistet")}</small></div></div>`,
    "krKopf" + bId + b.gebuehr + coins.length);

  /* ---- Linke Spalte: gelistete Coins ---- */
  const liste = coins.map(c => {
    const h = KR_HIST[c.id] || [], tr = h.length > 1 && h[0] ? (c.kurs / h[0] - 1) * 100 : 0;
    const offen = (state.krypto.orders || []).filter(o => o.coinId === c.id && o.boerseId === bId).length;
    return `<button type="button" class="bwZeile${c.id === NETZ.krCoin ? " on" : ""}" data-krcoin="${c.id}">
      <span class="bwName">${coinName(c)}${c.trend ? ` <em class="krTrend">${t("Trend")}</em>` : ""}${c.firmaId === bId ? "" : ` <em class="krFremd">${t("Vertrag")}</em>`}</span>
      <b class="mono">${fp(c.kurs)}</b>
      <span class="bwTrend">${Math.abs(tr) < 0.5 ? "" : `<span style="color:${tr > 0 ? "var(--up)" : "var(--down)"};font-size:11px">${tr > 0 ? "+" : ""}${tr.toFixed(0)} %</span>`}</span>
      <span class="bwAnz">${offen || ""}</span></button>`;
  }).join("") || `<div class="bwLeer">${t("Noch kein Coin gelistet.")}</div>`;

  /* ---- Orderbuch des gewählten Coins auf dieser Börse ---- */
  const buch = coin ? (state.krypto.orders || []).filter(o => o.coinId === coin.id && o.boerseId === bId) : [];
  const angebote = buch.filter(o => o.side === "sell" && o.playerId !== myId).sort((x, y) => x.price - y.price);
  const gesuche = buch.filter(o => o.side === "buy" && o.playerId !== myId).sort((x, y) => y.price - x.price);
  const meine = (state.krypto.orders || []).filter(o => o.playerId === myId && o.boerseId === bId);
  const bestand = konto?.coins?.[coin?.id] || 0;
  const seite = NETZ.krSeite || "buy";

  /* ---- Konto: ohne Konto kein Handel ---- */
  const kontoTeil = konto
    ? `<section class="krKonto">
         <div class="krKontoWerte">
           <div><small>${t("Guthaben auf dem Konto")}</small><b class="mono">${fmt(konto.cash)}</b></div>
           <div><small>${t("Dein Bestand")}</small><b class="mono">${bestand} ${coin ? coinName(coin) : ""}</b></div>
         </div>
         <div class="krKontoForm">
           <input id="krBetrag" type="number" min="1" step="100" value="${NETZ.krBetrag || 500}" aria-label="${t("Betrag")}">
           <button type="button" class="mini" data-krein>${t("Einzahlen")}</button>
           <button type="button" class="mini" data-kraus>${t("Auszahlen")}</button>
         </div>
       </section>`
    : `<section class="krKonto krKontoLeer">
         <div><b>${t("Kein Konto bei dieser Börse")}</b><small>${t("Ein Konto gilt für eine Börse. Geld und Coins liegen darin, nicht in deiner Kasse.")}</small></div>
         <button type="button" class="buyb" data-krkonto>${t("Konto eröffnen")}</button>
       </section>`;

  /* ---- Detail, Formular, Buch ---- */
  const detail = coin ? `<section class="bwDetail">
      <div class="bwDetailKopf">
        <div><span class="bwKat">${coin.firmaId === bId ? t("Eigener Coin") : t("Über Vertrag gelistet")}</span><h3>${coinName(coin)}</h3><small class="krVon">${t("von")} ${name(coin.firmaId)}</small></div>
        <div class="bwPreis"><b class="mono">${fp(coin.kurs)}</b><span>${t("Kurs")}</span></div>
      </div>
      <div class="bwKennzahlen">
        <div><small>${t("Fundament")}</small><b class="mono">${fp(coin.fundament)}</b><span>${t("aus Börsengebühren")}</span></div>
        <div><small>${t("Bestes Angebot")}</small><b class="mono">${angebote[0] ? fp(angebote[0].price) : "—"}</b><span>${angebote[0] ? `${angebote[0].qty}× ${t("verfügbar")}` : t("niemand verkauft")}</span></div>
        <div><small>${t("Bestes Gesuch")}</small><b class="mono">${gesuche[0] ? fp(gesuche[0].price) : "—"}</b><span>${gesuche[0] ? `${gesuche[0].qty}× ${t("gesucht")}` : t("niemand sucht")}</span></div>
        <div><small>${t("Ausgegeben")}</small><b class="mono">${coin.minted}</b><span>${t("von")} 100</span></div>
        <div><small>${t("Bekanntheit")}</small><b class="mono">${krHypeWort(coin.hype)}</b><span>${krHypeBalken(coin.hype)}</span></div>
      </div>
      <div class="bwChart">${verlaufChart(KR_HIST[coin.id], t("Kursverlauf"))}</div>
    </section>` : `<section class="bwDetail"><div class="bwLeer">${t("Diese Börse führt noch keinen Coin.")}</div></section>`;

  const form = coin ? `${kontoTeil}<section class="bwForm">
      <div class="bwSeiten"><button type="button" class="${seite === "buy" ? "on kauf" : ""}" data-krseite="buy">${t("Kaufen")}</button><button type="button" class="${seite === "sell" ? "on verkauf" : ""}" data-krseite="sell">${t("Verkaufen")}</button></div>
      <label><span>${t("Menge")}</span><input id="krMenge" type="number" min="1" step="1" value="${NETZ.krMenge || 5}"></label>
      <label><span>${t("Preis je Coin")}</span><input id="krPreis" type="number" min="0.01" step="0.01" value="${NETZ.krPreis ?? (Math.round(coin.kurs * 100) / 100)}"></label>
      <button type="button" class="${seite === "buy" ? "buyb" : "sellb"} bwSenden" data-krsenden ${konto && !offline ? "" : "disabled"}>${offline ? t("Börse gerade offline") : seite === "buy" ? t("Kauforder platzieren") : t("Verkaufsorder platzieren")}</button>
      <small>${seite === "buy"
        ? `${t("Der Kauf kostet zusätzlich")} ${(b.gebuehr * 100).toFixed(1)} % ${t("Gebühr. Sie geht an die Börse — bei fremden Coins behält sie 30 %, der Rest geht an die Firma des Coins.")}`
        : t("Liegt ein Gesuch zu diesem Preis oder höher, wird sofort verkauft. Sonst bleibt die Order stehen; die Coins liegen so lange fest.")}</small>
    </section>` : "";

  const zeile = o => `<div class="bwOrder"><span class="mono"><b>${o.qty}×</b> ${fp(o.price)}</span><span class="bwWer">${name(o.playerId)}</span><button type="button" class="mini" data-krpreis="${o.price}">${t("Preis übernehmen")}</button></div>`;
  const buchTeil = coin ? `<div class="bwBuch">
      <section><div class="bwBuchKopf verkauf"><b>${t("Angebote")}</b><small>${t("jemand verkauft — du kaufst")}</small></div>${angebote.map(zeile).join("") || `<div class="bwLeer">${t("Keine Angebote")}</div>`}</section>
      <section><div class="bwBuchKopf kauf"><b>${t("Gesuche")}</b><small>${t("jemand kauft — du verkaufst")}</small></div>${gesuche.map(zeile).join("") || `<div class="bwLeer">${t("Keine Gesuche")}</div>`}</section>
    </div>` : "";

  const meineTeil = meine.length ? `<section class="bwMeine"><b>${t("Meine Aufträge")}</b>${meine.map(o =>
    `<div class="bwOrder"><span class="${o.side === "buy" ? "bwK" : "bwV"}">${o.side === "buy" ? t("Kauf") : t("Verkauf")}</span><span class="mono"><b>${o.qty}×</b> ${coinName((state.krypto.coins || []).find(c => c.id === o.coinId))} · ${fp(o.price)}</span><button type="button" class="mini" data-krstorno="${o.id}">${t("Storno")}</button></div>`).join("")}</section>` : "";

  /* ---- Verwaltung: nur für die Firma, der die Börse gehört ---- */
  const eigene = (state.krypto.coins || []).filter(c => c.firmaId === bId);
  const fremde = (state.krypto.coins || []).filter(c => c.firmaId !== bId);
  const verwaltung = meins ? `<section class="krVerwaltung">
      <div class="krVerwaltungKopf"><b>${t("Deine Börse verwalten")}</b><small>${t("nur du siehst diesen Bereich")}</small></div>
      <div class="krVerwaltungGrid">
        <div class="krBox"><small>${t("Handelsgebühr")}</small>
          <div class="krBoxForm"><input id="krGebuehr" type="number" min="0" max="5" step="0.1" value="${(b.gebuehr * 100).toFixed(1)}"><span>%</span><button type="button" class="mini" data-krgebuehr>${t("Setzen")}</button></div>
          <span>${t("Sie ist deine einzige Einnahme und trägt das Fundament deines Coins.")}</span></div>
        <div class="krBox"><small>${t("Neuen Coin auflegen")}</small>
          <div class="krBoxForm"><input id="krNeuName" maxlength="16" placeholder="${t("Name")}"><input id="krAusgabe" type="number" min="1" max="100" step="1" value="20"><button type="button" class="mini" data-krausgeben>${t("Auflegen")}</button></div>
          <span>${eigene.length ? `${eigene.length} ${t("von")} 5 ${t("Coins aufgelegt")} · ${t("Mehr Stück eines bestehenden Coins gibst du in der Liste darunter aus.")}` : t("Dein erster Coin. Der Name steht auf der Börse.")} ${t("Ausgegebene Stück gehen sofort als Angebot ins Buch.")}</span></div>
      </div>
      <div class="krVertraege"><small>${t("Deine Coins")}</small>
        ${eigene.length ? eigene.map(c => `<div class="krVertrag"><span>${coinName(c)} <small>${krHypeWort(c.hype)} · ${c.minted} ${t("von")} 100</small></span><b class="mono">${fp(c.kurs)}</b>
          <button type="button" class="mini" data-krwerben="${c.id}" ${c.werbungFrei ? "disabled" : ""}>${c.werbungFrei ? `${c.werbungFrei} s` : `${t("Bewerben")} ${fmt(state.krypto.werbung?.kosten || 0)}`}</button>
          <button type="button" class="mini" data-krnach="${c.id}" ${c.minted >= 100 ? "disabled" : ""}>${t("10 nachlegen")}</button></div>`).join("")
          : `<div class="bwLeer">${t("Noch kein eigener Coin.")}</div>`}
      </div>
      <div class="krVertraege"><small>${t("Fremde Coins auf deiner Börse")}</small>
        ${fremde.length ? fremde.map(c => { const hat = krListet(state, bId, c);
          return `<div class="krVertrag"><span>${coinName(c)} <small>${name(c.firmaId)}</small></span><b class="mono">${fp(c.kurs)}</b>${hat
            ? `<button type="button" class="mini" data-krkuend="${c.id}">${t("Kündigen")}</button>`
            : `<button type="button" class="mini" data-krvertrag="${c.id}">${t("Vertrag schließen")}</button>`}</div>`; }).join("")
          : `<div class="bwLeer">${t("Keine andere Firma hat einen Coin.")}</div>`}
        <span>${t("Für fremde Coins behältst du 30 % der Gebühr, der Rest geht an die Firma des Coins. Verträge sind jederzeit kündbar.")}</span>
      </div>
    </section>` : "";

  /* Während man tippt, nicht neu aufbauen — sonst springt der Fokus */
  const tippt = document.activeElement && fenster.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  netzSetze(".netzInhalt", `<div class="bwLayout"><aside class="bwListe"><div class="bwListeKopf"><b>${t("Coins")}</b><small>${t("Kurs · Trend · Orders")}</small></div><div class="bwListeInhalt"></div></aside><div class="bwHaupt"></div></div>`, "krLayout");
  { const el = fenster.querySelector(".bwListeInhalt"), y = el?.scrollTop || 0;
    netzSetze(".bwListeInhalt", liste, "krListe" + bId + NETZ.krCoin + JSON.stringify(coins.map(c => c.kurs)));
    if (el) el.scrollTop = y; }
  if (!tippt) netzSetze(".bwHaupt", detail + form + buchTeil + meineTeil + verwaltung, "krHaupt");
  netzSetze(".sfFuss", `${logoHtml(bId, "sfFussLogo", farbe)}<span>${t("Diese Börse betreibt")} <b>${name(bId)}</b> · ${t("Coins sind ungedeckt — ihr Wert kommt allein aus dem Handel.")}</span>`, "krFuss" + bId);
}

/* ---- Klicks auf der Krypto-Seite ---- */
document.addEventListener("click", e => {
  if (!NETZ.offen || !String(NETZ.seite || "").startsWith("krypto:")) return;
  const bId = NETZ.seite.slice(7);
  const wert = id => +document.getElementById(id)?.value || 0;
  const neu = () => { NETZ.sig = {}; netzZeichnen(); };
  const schick = (ev, daten, ok) => socket.emit(ev, daten, r => {
    if (r?.error) return toast(r.error, true);
    if (ok) toast(ok);
    NETZ.sig = {}; render(store.get());
  });

  const c = e.target.closest("[data-krcoin]");
  if (c) { NETZ.krCoin = c.dataset.krcoin; NETZ.krPreis = null; return neu(); }
  const s = e.target.closest("[data-krseite]");
  if (s) { NETZ.krSeite = s.dataset.krseite; return neu(); }
  const pr = e.target.closest("[data-krpreis]");
  if (pr) { NETZ.krPreis = +pr.dataset.krpreis; return neu(); }
  if (e.target.closest("[data-krkonto]")) return schick("coinKonto", { boerseId: bId, aktion: "eröffnen" }, t("Konto eröffnet"));
  if (e.target.closest("[data-krein]")) { NETZ.krBetrag = wert("krBetrag"); return schick("coinKonto", { boerseId: bId, aktion: "einzahlen", betrag: NETZ.krBetrag }, t("Eingezahlt")); }
  if (e.target.closest("[data-kraus]")) { NETZ.krBetrag = wert("krBetrag"); return schick("coinKonto", { boerseId: bId, aktion: "auszahlen", betrag: NETZ.krBetrag }, t("Ausgezahlt")); }
  if (e.target.closest("[data-krsenden]")) {
    NETZ.krMenge = wert("krMenge"); NETZ.krPreis = wert("krPreis");
    return schick("coinOrder", { boerseId: bId, coinId: NETZ.krCoin, side: NETZ.krSeite || "buy", qty: NETZ.krMenge, price: NETZ.krPreis }, t("Auftrag eingestellt"));
  }
  const st = e.target.closest("[data-krstorno]");
  if (st) return schick("coinCancel", { orderId: st.dataset.krstorno }, t("Auftrag zurückgenommen"));
  if (e.target.closest("[data-krgebuehr]")) return schick("coinBoerse", { gebuehr: wert("krGebuehr") / 100 }, t("Gebühr gesetzt"));
  if (e.target.closest("[data-krausgeben]")) return schick("coinAusgeben", { menge: wert("krAusgabe"), name: document.getElementById("krNeuName")?.value }, t("Coin aufgelegt"));
  const wrb = e.target.closest("[data-krwerben]");
  if (wrb) return schick("coinWerbung", { coinId: wrb.dataset.krwerben }, t("Kampagne läuft"));
  const nach = e.target.closest("[data-krnach]");
  if (nach) return schick("coinAusgeben", { menge: 10, coinId: nach.dataset.krnach }, t("Coins nachgelegt"));
  const vt = e.target.closest("[data-krvertrag]");
  if (vt) return schick("coinVertrag", { coinId: vt.dataset.krvertrag }, t("Vertrag geschlossen"));
  const kd = e.target.closest("[data-krkuend]");
  if (kd) return schick("coinVertrag", { coinId: kd.dataset.krkuend, kuendigen: true }, t("Vertrag gekündigt"));
});

/* Eine Software-Firma ohne Börse eröffnet sie auf ihrer eigenen Seite. */
document.addEventListener("click", e => {
  if (!e.target.closest("[data-krneu]")) return;
  const g = +document.getElementById("krNeuGebuehr")?.value || 2;
  socket.emit("coinBoerse", { gebuehr: g / 100 }, r => {
    if (r?.error) return toast(r.error, true);
    toast(t("Krypto-Börse eröffnet"));
    NETZ.sig = {}; render(store.get());
  });
});
