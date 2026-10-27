/* ============================================================
 * Dashboard der Software-Firma
 * ------------------------------------------------------------
 * Eine eigene Seite im Stadtnetz unter NETZ.seite = "dash:<firmaId>",
 * die nur die Firma selbst sieht. Sie führt an einer Stelle zusammen,
 * was sonst über die Börsenseite verstreut ist: Kennzahlen des eigenen
 * Coins, Gebühr, Ausgabe, die Verträge in beide Richtungen und die
 * offenen Aufträge auf der eigenen Börse.
 * ============================================================ */

/* Verträge in beide Richtungen: was ich liste und wer mich listet */
const dsMeineListung = (state, myId) => (state.krypto?.vertraege || []).filter(v => v.boerseId === myId && v.aktiv !== false);
const dsFremdeListung = (state, myId) => (state.krypto?.vertraege || []).filter(v =>
  (state.krypto?.coins || []).some(c => c.id === v.coinId && c.firmaId === myId) && v.aktiv !== false);

function dashboardSeite(fenster, state, me, myId) {
  const pid = NETZ.seite.slice(5);
  const b = (state.krypto?.boersen || []).find(x => x.firmaId === pid);
  const firma = state.players?.[pid];
  /* Das Dashboard ist privat. Fremde landen auf der Börsenseite. */
  if (!firma || pid !== myId) return netzOeffnen(b ? "krypto:" + pid : null);
  const farbe = firma.color || "#7c3aed";
  fenster.querySelector(".sfBrowser").style.setProperty("--sys", farbe);
  fenster.querySelector(".sfHinweis").hidden = true;

  const offline = b && b.online === false;
  const banner = fenster.querySelector(".sfBanner");
  banner.hidden = !offline;
  if (offline) netzSetze(".sfBanner", `<b>⚠</b><span>${t("Börse gerade offline")} — ${t("das Rechenzentrum der Firma läuft nicht.")}</span>`, "dsOff" + pid);

  const name = p => String(p).startsWith("buerger") ? t("Stadtbewohner") : escapeHtml(rohText(state.players?.[p]?.name || "—"));
  const eigene = (state.krypto?.coins || []).filter(c => c.firmaId === pid);
  const coin = eigene[0] || null;
  const coinName = c => escapeHtml(rohText(c?.name || "—"));
  const coinVon = id => (state.krypto?.coins || []).find(c => c.id === id);
  const orders = (state.krypto?.orders || []).filter(o => o.boerseId === pid);
  const konto = me?.kryptoKonto?.[pid] || null;

  netzSetze(".sfUrl", `🔒 ${shopSlug(firma.name)}.cs/dashboard`, "dsUrl" + pid);
  netzSetze(".sfKopf", `<div class="sfMarke">${logoHtml(pid, "sfLogo", farbe)}<div><b>${name(pid)} ${t("Dashboard")}</b><small>${t("Nur für dich")} · ${b ? `${b.online === false ? t("Börse gerade offline") : t("Börse läuft")} · ${t("Gebühr")} ${(b.gebuehr * 100).toFixed(1)} %` : t("Noch keine Krypto-Börse")}</small></div></div>`,
    "dsKopf" + pid + (b ? b.gebuehr + "" + b.online : "x"));

  /* ---- Ohne Börse: hier wird sie eröffnet ---- */
  if (!b) {
    netzSetze(".netzInhalt", `<div class="dsLeer">
        <h3>${t("Noch keine Krypto-Börse")}</h3>
        <p>${t("Als Software-Firma kannst du eine eigene Börse betreiben. Sie braucht eine Website und einen Platz in deinem Rechenzentrum, und sie ist deine einzige Einnahme aus dem Coin-Handel.")}</p>
        <div class="krBoxForm"><input id="dsNeuGebuehr" type="number" min="0" max="5" step="0.1" value="2.0"><span>%</span><button type="button" class="buyb" data-dsneu>${t("Krypto-Börse eröffnen")}</button></div>
      </div>`, "dsLeer" + pid);
    netzSetze(".sfFuss", `${logoHtml(pid, "sfFussLogo", farbe)}<span>${t("Dein Dashboard")} · ${t("nur du siehst diese Seite")}</span>`, "dsFuss" + pid);
    return;
  }

  /* ---- Kennzahlen ---- */
  const kennzahlen = `<section class="dsKennzahlen">
      <div><small>${coin ? coinName(coin) : t("Kurs")}</small><b class="mono">${coin ? fp(coin.kurs) : "—"}</b><span>${coin ? `${t("Fundament")} ${fp(coin.fundament)}` : t("noch kein Coin")}</span></div>
      <div><small>${t("Deine Coins")}</small><b class="mono">${eigene.length}</b><span>${eigene.reduce((a, c) => a + c.minted, 0)} ${t("Stück ausgegeben")}</span></div>
      <div><small>${t("Gebühreneinnahmen")}</small><b class="mono">${fmt(b.einnahmen || 0)}</b><span>${t("seit Eröffnung")}</span></div>
      <div><small>${t("Handelsvolumen")}</small><b class="mono">${fmt(b.volumen || 0)}</b><span>${coin?.trades || 0} ${t("Abschlüsse")}</span></div>
      <div><small>${t("Konten")}</small><b class="mono">${b.konten || 0}</b><span>${t("Kunden auf deiner Börse")}</span></div>
      <div><small>${t("Rechenzentrum")}</small><b class="mono">${b.plaetze || 0}</b><span>${t("Stufen aktiv")} · ${b.online === false ? t("Börse offline") : t("Börse online")}</span></div>
    </section>`;

  const verlauf = coin ? `<section class="dsChart">${verlaufChart(KR_HIST[coin.id], t("Kursverlauf von") + " " + coinName(coin), fp, 620, 110)}</section>` : "";

  /* ---- Coin und Gebühr steuern ---- */
  const steuerung = `<section class="dsBloecke">
      <div class="krBox"><small>${t("Handelsgebühr")}</small>
        <div class="krBoxForm"><input id="dsGebuehr" type="number" min="0" max="5" step="0.1" value="${(b.gebuehr * 100).toFixed(1)}"><span>%</span><button type="button" class="mini" data-dsgebuehr>${t("Setzen")}</button></div>
        <span>${t("Sie trägt das Fundament deines Coins. Bei fremden Coins behältst du 30 %.")}</span></div>
      <div class="krBox"><small>${t("Neuen Coin auflegen")}</small>
        <div class="krBoxForm"><input id="dsNeuName" maxlength="16" placeholder="${t("Name")}"><input id="dsAusgabe" type="number" min="1" max="100" step="1" value="20"><button type="button" class="mini" data-dsausgeben ${eigene.length >= 5 ? "disabled" : ""}>${t("Auflegen")}</button></div>
        <span>${eigene.length ? `${eigene.length} ${t("von")} 5 ${t("Coins aufgelegt")}` : t("Mit dem ersten Coin geht es los.")}</span></div>
      <div class="krBox"><small>${t("Dein Konto")}</small>
        <div class="krBoxForm"><b class="mono">${konto ? fmt(konto.cash) : "—"}</b></div>
        <span>${konto ? `${t("Guthaben auf der eigenen Börse")} · ${konto.coins?.[pid] || 0} ${t("eigene Coins im Depot")}` : t("Du hast noch kein Konto auf deiner eigenen Börse.")}</span></div>
    </section>`;

  const meineCoins = `<section class="dsTabelle">
      <div class="dsTabelleKopf"><b>${t("Deine Coins")}</b><small>${eigene.length} ${t("von")} 5</small></div>
      ${eigene.length ? eigene.map(c => `<div class="dsZeile"><span class="dsWer">${coinName(c)}</span>
        <span class="mono">${fp(c.kurs)}</span>
        <span class="dsStatus">${c.minted} ${t("von")} 100 · ${c.trades || 0} ${t("Abschlüsse")}</span>
        <button type="button" class="mini" data-dsnach="${c.id}" ${c.minted >= 100 ? "disabled" : ""}>${t("10 nachlegen")}</button></div>`).join("")
        : `<div class="bwLeer">${t("Noch kein Coin aufgelegt.")}</div>`}
    </section>`;

  /* ---- Verträge: was ich liste ---- */
  const fremdeCoins = (state.krypto?.coins || []).filter(c => c.firmaId !== pid);
  const listeIch = `<section class="dsTabelle">
      <div class="dsTabelleKopf"><b>${t("Fremde Coins auf deiner Börse")}</b><small>${t("du behältst 30 % der Gebühr")}</small></div>
      ${fremdeCoins.length ? fremdeCoins.map(c => {
        const hat = dsMeineListung(state, pid).some(v => v.coinId === c.id);
        return `<div class="dsZeile"><span class="dsWer">${logoHtml(c.firmaId, "dsLogo", state.players?.[c.firmaId]?.color)}${coinName(c)} <small>${name(c.firmaId)}</small></span>
          <span class="mono">${fp(c.kurs)}</span>
          <span class="dsStatus">${hat ? `<em class="dsJa">${t("gelistet")}</em>` : `<em class="dsNein">${t("nicht gelistet")}</em>`}</span>
          ${hat ? `<button type="button" class="mini" data-dskuend="${c.id}">${t("Kündigen")}</button>`
                : `<button type="button" class="buyb" data-dsvertrag="${c.id}">${t("Vertrag schließen")}</button>`}</div>`;
      }).join("") : `<div class="bwLeer">${t("Keine andere Firma hat bisher einen Coin.")}</div>`}
    </section>`;

  /* ---- Verträge: wer mich listet ---- */
  const listenMich = dsFremdeListung(state, pid);
  const beiAnderen = `<section class="dsTabelle">
      <div class="dsTabelleKopf"><b>${t("Dein Coin bei anderen Börsen")}</b><small>${t("davon gehen 70 % der Gebühr an dich")}</small></div>
      ${listenMich.length ? listenMich.map(v => {
        const fb = (state.krypto?.boersen || []).find(x => x.firmaId === v.boerseId);
        return `<div class="dsZeile"><span class="dsWer">${logoHtml(v.boerseId, "dsLogo", state.players?.[v.boerseId]?.color)}${name(v.boerseId)} <small>${coinName(coinVon(v.coinId))}</small></span>
          <span class="mono">${fb ? `${(fb.gebuehr * 100).toFixed(1)} %` : "—"}</span>
          <span class="dsStatus">${fb?.online === false ? `<em class="dsNein">${t("offline")}</em>` : `<em class="dsJa">${t("online")}</em>`}</span>
          <button type="button" class="mini" data-dsauf="${v.boerseId}">${t("Ansehen")}</button></div>`;
      }).join("") : `<div class="bwLeer">${t("Noch listet keine andere Börse deinen Coin. Andere Firmen schließen den Vertrag auf ihrem eigenen Dashboard.")}</div>`}
      <span class="dsHinweis">${t("Einen Vertrag schließt immer die gastgebende Börse. Beide Seiten können jederzeit kündigen.")}</span>
    </section>`;

  /* ---- Offene Aufträge auf der eigenen Börse ---- */
  const auftraege = `<section class="dsTabelle">
      <div class="dsTabelleKopf"><b>${t("Offene Aufträge auf deiner Börse")}</b><small>${orders.length} ${t("Stück")}</small></div>
      ${orders.length ? orders.slice(0, 12).map(o =>
        `<div class="dsZeile"><span class="dsWer">${o.side === "buy" ? `<em class="dsJa">${t("Kauf")}</em>` : `<em class="dsNein">${t("Verkauf")}</em>`} ${coinName(coinVon(o.coinId))}</span>
          <span class="mono">${o.qty}× ${fp(o.price)}</span>
          <span class="dsStatus">${name(o.playerId)}</span>
          ${o.playerId === myId ? `<button type="button" class="mini" data-dsstorno="${o.id}">${t("Storno")}</button>` : "<span></span>"}</div>`).join("")
        : `<div class="bwLeer">${t("Gerade liegt kein Auftrag im Buch.")}</div>`}
    </section>`;

  const zurBoerse = `<div class="dsAktion"><button type="button" class="sfKaufen" data-dsauf="${pid}">${t("Zur eigenen Krypto-Börse")} →</button></div>`;

  const tippt = document.activeElement && fenster.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  if (!tippt) netzSetze(".netzInhalt", `<div class="dsLayout">${kennzahlen}${verlauf}${steuerung}${meineCoins}${listeIch}${beiAnderen}${auftraege}${zurBoerse}</div>`, "dsHaupt");
  netzSetze(".sfFuss", `${logoHtml(pid, "sfFussLogo", farbe)}<span>${t("Dein Dashboard")} · ${t("nur du siehst diese Seite")}</span>`, "dsFuss" + pid);
}

/* ---- Klicks auf dem Dashboard ---- */
document.addEventListener("click", e => {
  if (!NETZ.offen || !String(NETZ.seite || "").startsWith("dash:")) return;
  const pid = NETZ.seite.slice(5);
  const wert = id => +document.getElementById(id)?.value || 0;
  const schick = (ev, daten, ok) => socket.emit(ev, daten, r => {
    if (r?.error) return toast(r.error, true);
    if (ok) toast(ok);
    NETZ.sig = {}; render(store.get());
  });

  const auf = e.target.closest("[data-dsauf]");
  if (auf) { netzOeffnen("krypto:" + auf.dataset.dsauf); return; }
  if (e.target.closest("[data-dsneu]")) return schick("coinBoerse", { gebuehr: wert("dsNeuGebuehr") / 100 }, t("Krypto-Börse eröffnet"));
  if (e.target.closest("[data-dsgebuehr]")) return schick("coinBoerse", { gebuehr: wert("dsGebuehr") / 100 }, t("Gebühr gesetzt"));
  if (e.target.closest("[data-dsausgeben]")) return schick("coinAusgeben", { menge: wert("dsAusgabe"), name: document.getElementById("dsNeuName")?.value }, t("Coin aufgelegt"));
  const nach = e.target.closest("[data-dsnach]");
  if (nach) return schick("coinAusgeben", { menge: 10, coinId: nach.dataset.dsnach }, t("Coins nachgelegt"));
  const vt = e.target.closest("[data-dsvertrag]");
  if (vt) return schick("coinVertrag", { coinId: vt.dataset.dsvertrag }, t("Vertrag geschlossen"));
  const kd = e.target.closest("[data-dskuend]");
  if (kd) return schick("coinVertrag", { coinId: kd.dataset.dskuend, kuendigen: true }, t("Vertrag gekündigt"));
  const st = e.target.closest("[data-dsstorno]");
  if (st) return schick("coinCancel", { orderId: st.dataset.dsstorno }, t("Auftrag zurückgenommen"));
});
