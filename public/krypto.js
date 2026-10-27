/* Krypto-Börse im Spiel: Teil der eigenen Stadtnetz-Seite der Software-Firma. Liest state.krypto und me.kryptoKonto
 * aus dem Snapshot, sendet Befehle über act() (siehe app.js). */
let kryptoSig = "";
const kryptoEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kryptoFmt = (n, d = 2) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

function kryptoRendern(state, me, myId) {
  const body = document.getElementById("kryptobody");
  if (!body || !state?.krypto || !me || !myId) return;
  const K = state.krypto, name = pid => state.players?.[pid]?.name ?? "—";
  const meinStand = state.players?.[myId];
  const software = (meinStand?.industries || [meinStand?.industry]).includes("software");
  const konten = me.kryptoKonto || {};
  const meineBoerse = K.boersen.find(b => b.firmaId === myId);
  const meinCoin = K.coins.find(c => c.firmaId === myId);
  /* Handelsbörse: eigene, falls Konto da, sonst die erste mit Konto */
  const handelBoerse = (konten[myId] && meineBoerse) ? myId : Object.keys(konten)[0] || null;
  const boersenMitKonto = K.boersen.filter(b => konten[b.firmaId]);
  const gelisteteCoins = K.coins.filter(c => handelBoerse && (c.firmaId === handelBoerse || K.vertraege.some(v => v.boerseId === handelBoerse && v.coinId === c.firmaId)));
  const coin = K.coins.find(c => c.firmaId === (body.dataset.coin || gelisteteCoins[0]?.firmaId)) || gelisteteCoins[0] || null;
  const meineOrders = K.orders.filter(o => o.playerId === myId);
  body.dataset.boerse = handelBoerse || "";
  body.dataset.coin = coin?.firmaId || "";
  const sig = JSON.stringify([K, konten, handelBoerse, coin?.firmaId]);
  if (sig === kryptoSig && body.childElementCount) return;
  if (body.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  kryptoSig = sig;

  if (!software) {
    body.innerHTML = `<p class="note">Die Krypto-Börse gehört Software-Firmen mit Website. Du spielst eine andere Branche.</p>`;
    return;
  }

  const boerseTeil = meineBoerse
    ? `<div class="kr-zeile"><span>Gebühr deiner Börse</span><b>${kryptoFmt(meineBoerse.gebuehr * 100, 1)} %</b></div>
       <div class="kr-form"><input id="kr-gebuehr" type="number" min="0" max="5" step="0.1" value="${kryptoFmt(meineBoerse.gebuehr * 100, 1)}"><button data-kr="boerse">Gebühr setzen</button></div>`
    : `<p class="note">Du hast noch keine Börse. Sie braucht eine Website im Stadtnetz, die online ist.</p>
       <div class="kr-form"><input id="kr-gebuehr" type="number" min="0" max="5" step="0.1" value="2"><span>% Gebühr</span><button data-kr="boerse">Börse eröffnen</button></div>`;

  const coinTeil = meinCoin
    ? `<div class="kr-zeile"><span>Dein Coin</span><b>${kryptoFmt(meinCoin.kurs)} $</b></div>
       <p class="note">Fundament ${kryptoFmt(meinCoin.fundament)} $ · ausgegeben ${meinCoin.minted} von 100</p>
       <div class="kr-form"><input id="kr-menge" type="number" min="1" max="${100 - meinCoin.minted}" value="10"><button data-kr="ausgeben" ${meinCoin.minted >= 100 ? "disabled" : ""}>Coins ausgeben</button></div>`
    : meineBoerse ? `<div class="kr-form"><input id="kr-menge" type="number" min="1" max="100" value="50"><button data-kr="ausgeben">Coins ausgeben</button></div>` : "";

  const kontoTeil = !handelBoerse || !konten[handelBoerse]
    ? (meineBoerse ? `<div class="kr-form"><button data-kr="konto" data-boerse="${myId}">Konto bei meiner Börse eröffnen</button></div>` : "")
    : (() => {
        const k = konten[handelBoerse];
        const coinsIm = Object.entries(k.coins || {}).filter(([, n]) => n > 0)
          .map(([cid, n]) => `${kryptoEsc(name(cid))}: ${n}`).join(" · ") || "keine";
        return `<div class="kr-zeile"><span>Konto bei ${kryptoEsc(name(handelBoerse))}</span><b>${kryptoFmt(k.cash)} $</b></div>
          <p class="note">Coins: ${coinsIm}</p>
          <div class="kr-form"><input id="kr-betrag" type="number" min="1" value="500"><button data-kr="einzahlen" data-boerse="${handelBoerse}">Einzahlen</button><button data-kr="auszahlen" data-boerse="${handelBoerse}">Auszahlen</button></div>`;
      })();

  const handelTeil = handelBoerse && konten[handelBoerse] && coin
    ? `<h3>Handel auf ${kryptoEsc(name(handelBoerse))}</h3>
       <div class="kr-form">
         <select id="kr-coin">${gelisteteCoins.map(c => `<option value="${c.firmaId}" ${c.firmaId === coin.firmaId ? "selected" : ""}>${kryptoEsc(name(c.firmaId))} · ${kryptoFmt(c.kurs)} $</option>`).join("")}</select>
         <select id="kr-seite"><option value="buy">Kaufen</option><option value="sell">Verkaufen</option></select>
       </div>
       <div class="kr-form"><input id="kr-qty" type="number" min="1" value="5"><input id="kr-price" type="number" step="0.01" min="0.01" value="${kryptoFmt(coin.kurs)}"><button data-kr="order">Auftrag einstellen</button></div>`
    : "";

  const orderTeil = meineOrders.length
    ? `<h3>Offene Aufträge</h3>` + meineOrders.map(o => `<div class="kr-zeile"><span>${o.side === "buy" ? "Kauf" : "Verkauf"} ${o.qty} × ${kryptoFmt(o.price)} $ (${kryptoEsc(name(o.coinId))})</span><button data-kr="storno" data-order="${o.id}">Zurücknehmen</button></div>`).join("")
    : "";

  const vertragTeil = handelBoerse && meineBoerse && handelBoerse === myId
    ? `<h3>Verträge</h3>` +
      K.coins.filter(c => c.firmaId !== myId).map(c => {
        const v = K.vertraege.some(x => x.boerseId === myId && x.coinId === c.firmaId);
        return `<div class="kr-zeile"><span>${kryptoEsc(name(c.firmaId))}</span>${v
          ? `<button data-kr="kuendigen" data-coin="${c.firmaId}">Kündigen</button>`
          : `<button data-kr="vertrag" data-coin="${c.firmaId}">Vertrag schließen</button>`}</div>`;
      }).join("") || `<p class="note">Keine fremden Coins am Markt.</p>`
    : "";

  const boersenTeil = K.boersen.length
    ? `<h3>Alle Börsen</h3>` + K.boersen.map(b => `<div class="kr-zeile"><span>${kryptoEsc(name(b.firmaId))}</span><b>${kryptoFmt(b.gebuehr * 100, 1)} % Gebühr</b></div>`).join("")
    : "";

  body.innerHTML = `
    <section class="kr-block"><h3>Deine Börse</h3>${boerseTeil}</section>
    ${coinTeil ? `<section class="kr-block"><h3>Dein Coin</h3>${coinTeil}</section>` : ""}
    ${kontoTeil ? `<section class="kr-block"><h3>Konto</h3>${kontoTeil}</section>` : ""}
    ${handelTeil ? `<section class="kr-block">${handelTeil}</section>` : ""}
    ${orderTeil ? `<section class="kr-block">${orderTeil}</section>` : ""}
    ${vertragTeil ? `<section class="kr-block">${vertragTeil}</section>` : ""}
    <section class="kr-block">${boersenTeil}</section>`;
}

document.addEventListener("click", e => {
  const b = e.target.closest("#kryptobody [data-kr]"); if (!b) return;
  const v = id => document.getElementById(id)?.value;
  const boerse = b.dataset.boerse || null;
  switch (b.dataset.kr) {
    case "boerse": return act("coinBoerse", { gebuehr: +v("kr-gebuehr") / 100 });
    case "ausgeben": return act("coinAusgeben", { menge: +v("kr-menge") });
    case "konto": return act("coinKonto", { boerseId: boerse, aktion: "eröffnen" });
    case "einzahlen": return act("coinKonto", { boerseId: boerse, aktion: "einzahlen", betrag: +v("kr-betrag") });
    case "auszahlen": return act("coinKonto", { boerseId: boerse, aktion: "auszahlen", betrag: +v("kr-betrag") });
    case "order": return act("coinOrder", { boerseId: document.getElementById("kryptobody").dataset.boerse, coinId: v("kr-coin"), side: v("kr-seite"), qty: +v("kr-qty"), price: +v("kr-price") });
    case "storno": return act("coinCancel", { orderId: b.dataset.order });
    case "vertrag": return act("coinVertrag", { coinId: b.dataset.coin });
    case "kuendigen": return act("coinVertrag", { coinId: b.dataset.coin, kuendigen: true });
  }
});
