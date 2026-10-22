/* Neuigkeiten für die Startseite ("Was ist neu").
 * Neue Einträge OBEN anfügen. `id` muss eindeutig sein und neuer als die
 * vorigen sortieren — daran merkt sich der Browser, was schon gesehen wurde
 * (localStorage cs_updates_gesehen) und zeigt sonst den Punkt am Knopf.
 * `art`: "neu" (neue Funktion), "besser" (Verbesserung), "fix" (Fehler behoben). */
window.UPDATES = [
  {
    id: "2026-10-22d", datum: "2026-10-22",
    titel: { de: "Strom, Shop-Design & Malprogramm", en: "Power, shop design & paint program" },
    punkte: [
      { art: "besser", de: "Strom und Elektronik: Startvorrat (60 Strom, 4 Elektronik), ein Stadtnetz springt bei Knappheit ein, die Stadt kauft weniger weg — Mangel im Früh- und Spätspiel sinkt deutlich.",
        en: "Power and electronics: starting stock (60 power, 4 electronics), a city grid steps in during shortages and the city buys less — far fewer shortages early and late." },
      { art: "neu", de: "Shop-Design: Software-Firmen gestalten ihre Shop-Website selbst (Schrift, Thema, Ecken, Kopf, Karten, Motiv, Effekte, Slogan). Mit jeder Version kommen neue Optionen.",
        en: "Shop design: software companies style their shop website (font, theme, corners, header, cards, motif, effects, slogan). Each version unlocks more options." },
      { art: "neu", de: "Malprogramm: Software-Firmen entwickeln es und verkaufen Lizenzen in ihrem eigenen Online-Shop. Käufer malen damit ihr Firmenlogo (größer mit jeder Version), sichtbar in Shop, Karte und Firmenliste.",
        en: "Paint program: software companies develop it and sell licences in their own online shop. Buyers paint their company logo (bigger with every version), shown in shops, map and company list." },
      { art: "besser", de: "Software-Firmen starten mit mehr Ziegeln für den eigenen Shop; Markenwert enthält Malprogramm-Einnahmen.",
        en: "Software companies start with more bricks for their own shop; brand value includes paint income." },
    ]
  },
  {
    id: "2026-10-22c", datum: "2026-10-22",
    titel: { de: "Neue Branche: Software", en: "New industry: software" },
    punkte: [
      { art: "besser", de: "Der Online-Marktplatz ist jetzt der einzige Laden: Marktstand, Kontor, Baustoffhandel, Grüner Laden, Autohaus und Waffenhandel sind abgeschafft. Er führt alle Waren, hat 3 Regale und bekommt mit jeder Ausbaustufe eins dazu.",
        en: "The online marketplace is now the only shop: market stall, trading house, builders merchant, green store, car dealership and arms dealer are gone. It carries every good, has 3 shelves and gains one per upgrade." },
      { art: "neu", de: "Skill-Tree je Branche: Shop-Systeme spezialisieren sich (z. B. Agrar: Frische-Siegel → Gemüsekisten-Abo → Hof-zu-Haus). Ein Branchenbaum wirkt nur auf deren Waren. Eine zweite Branche geht erst ab Version 3 (doppelte Entwicklung + 2.000 $), eine dritte ab Version 5 (vierfach + 8.000 $). Bots wählen das System, das zu ihrer Branche passt.",
        en: "Skill tree per industry: shop systems specialise (e.g. farming: freshness seal → veg box subscription → farm-to-door). A tree only boosts that industry's goods. A second industry needs version 3 (double development + $2,000), a third version 5 (four times + $8,000). Bots pick the system that fits their industry." },
      { art: "besser", de: "Software-Firmen wachsen besser: Ihr System zählt als Markenwert zum Firmenwert (Einnahmen der letzten 10 Minuten × 2), die Gebühr darf bis 8 % gehen, Studio und Rechenzentrum brauchen weniger Strom, und ohne Elektronik entwickelt das Studio mit halbem Tempo weiter statt stillzustehen.",
        en: "Software companies grow better: their system counts as brand value towards company value (last 10 minutes of income × 2), fees may go up to 8 %, dev studio and data centre use less power, and without electronics the studio keeps developing at half speed instead of stopping." },
      { art: "besser", de: "Werbe-Abo deutlich teurer (60–400 $ je Marktplatz und Minute) — so teuer wie früher eine Dauerkampagne. Shop-Käufe zwischen Firmen kosten die halbe Börsengebühr als Handelssteuer an die Stadt.",
        en: "Ad subscription much pricier ($60–400 per marketplace per minute) — as much as a permanent campaign used to cost. Shop purchases between companies pay half the exchange fee as trade tax to the city." },
      { art: "neu", de: "Software-Firmen entwickeln im Entwicklerstudio ein Shop-System und betreiben es im Rechenzentrum. Sie verdienen an Einrichtung, Gebühr je Verkauf und Werbe-Abo.",
        en: "Software companies develop a shop system in their dev studio and run it in a data centre. They earn from set-up fees, a fee per sale and ad subscriptions." },
      { art: "neu", de: "Online-Marktplatz für jede Branche: drei Regale, mehr Kundschaft — verkauft aber erst mit installiertem Shop-System. Ohne Software-Firma gibt es das Stadtportal (5 % je Verkauf).",
        en: "Online marketplace for every industry: three shelves, more customers — but it only sells once a shop system is installed. Without a software company there is the city portal (5 % per sale)." },
      { art: "besser", de: "Im Sandbox-Modus kommt Werbung jetzt aus dem Werbemodul eines Shop-Systems statt aus der Werbeagentur.",
        en: "In sandbox mode, advertising now comes from a shop system's ad module instead of the ad agency." },
      { art: "neu", de: "Online-Shop zum Durchklicken: Jeder Marktplatz mit System hat ein Schaufenster mit seinen Produkten, Lagerbestand und Live-Bestellungen. Mitspieler kaufen dort direkt ein und bezahlen mit der Karte des Shop-Systems — samt Kartenterminal und Beleg.",
        en: "Browsable online shop: every marketplace with a system has a storefront with its products, stock and live orders. Other players buy there directly and pay with the shop system's card — complete with card terminal and receipt." },
      { art: "neu", de: "Bots bauen Online-Marktplätze, prüfen jede neue Software und wechseln, wenn sie besser ist. Zwei neue Software-Bots: Byteforge (KassenKlick) und Pixelwerk (ShopStern).",
        en: "Bots build online marketplaces, check every new software release and switch when it is better. Two new software bots: Byteforge (KassenKlick) and Pixelwerk (ShopStern)." }
    ]
  },
  {
    id: "2026-10-22a", datum: "2026-10-22",
    titel: { de: "Einzelaktien leichter handeln", en: "Trading single shares is easier" },
    punkte: [
      { art: "neu", de: "Teilkauf: Aus jedem Angebot lässt sich eine beliebige Anzahl kaufen, z. B. eine einzelne Aktie. Der Rest bleibt als Angebot stehen.",
        en: "Partial buys: take any number from an offer, e.g. a single share. The rest stays on the market." },
      { art: "besser", de: "Jedes Angebot zeigt den Preis je Aktie. Im Verkaufsformular setzt „Preis = Kurs × Aktien“ den Preis zum aktuellen Kurs.",
        en: "Every offer shows the price per share. In the sell form, “Price = price × shares” sets the price at the current share price." }
    ]
  },
  {
    id: "2026-10-21f", datum: "2026-10-21",
    titel: { de: "Aktien mit Kurs und Wert", en: "Shares with price and value" },
    punkte: [
      { art: "neu", de: "Jede Firma hat jetzt 100 Aktien statt vier 25-%-Blöcke. Gehandelt wird in beliebigen Stückzahlen.",
        en: "Every company now has 100 shares instead of four 25 % blocks. Trade any number of them." },
      { art: "neu", de: "Wert F und Kurs: F ist, was die Firma wirklich wert ist (Kasse, Lager, Anlagen, Ertrag). Der Kurs folgt F mit Verzögerung, schwankt und kann bei Flauten oder einer Panik fallen. Jeder Kauf hebt ihn, jeder Verkauf senkt ihn.",
        en: "Value F and price: F is what the company is really worth (cash, stock, assets, earnings). The price follows F with a delay, wobbles and can drop in slumps or a panic. Every purchase lifts it, every sale lowers it." },
      { art: "neu", de: "Kurswetten laufen auf den Aktienkurs.", en: "Stock bets now run on the share price." },
      { art: "neu", de: "Ausschüttung selbst festlegen: im Firmen-Panel automatisch nach Umsatz oder als fester Betrag.",
        en: "Set your own payout: in the company panel, automatic by revenue or a fixed amount." },
      { art: "neu", de: "Bauen kostet 30 Sekunden Bauzeit. Bis dahin ist das Gebäude eine Anlage in Arbeit — es produziert noch nicht, zählt aber schon voll zum Firmenwert. Bauen senkt den Wert der Firma nicht mehr.",
        en: "Building takes 30 seconds. Until then the building is an asset under construction — it does not produce yet but already counts fully towards company value. Building no longer lowers your company's value." },
      { art: "besser", de: "Steuer: Bau und Ausbau werden über 30 Minuten abgeschrieben, statt den Gewinn sofort zu senken.",
        en: "Tax: construction and upgrades are depreciated over 30 minutes instead of lowering profit immediately." },
      { art: "neu", de: "Branchen-ETFs: Je Branche ein Fonds. Dein Geld kauft echte Aktien der Firmen dieser Branche, der Anteilspreis folgt dem Fondswert.",
        en: "Industry ETFs: one fund per industry. Your money buys real shares of that industry's companies; the unit price follows the fund's value." },
      { art: "neu", de: "Das Finanzamt baut ein eigenes Portfolio aus Branchenfonds auf: Hat es Geld übrig, investiert es immer — unterbewertete Branchen bekommen mehr; liegt sie deutlich darüber, gibt es Anteile zurück — nur mit Geld, das nach den Stadtprojekten übrig ist.",
        en: "The tax office builds its own portfolio of industry funds: if an industry is well below value it buys its fund, if well above it returns units — only with money left after city projects." },
      { art: "besser", de: "Stadtbank zeigt Kurs, Wert je Aktie, Abstand dazu und das Marktgeschehen.",
        en: "The city bank shows price, value per share, the gap between them and market activity." }
    ]
  },
  {
    id: "2026-10-21e", datum: "2026-10-21",
    titel: { de: "Grundstock für die Stadt und schnelleres Laden", en: "City base fund and faster loading" },
    punkte: [
      { art: "besser", de: "Die Stadtkasse startet mit 20.000 $ Grundstock, den die Stadt nie ausgibt. Stadtprojekte und Prämien zahlt sie nur aus dem Geld darüber — ein Projekt löst also keinen Notstand mehr aus.",
        en: "The city treasury starts with a 20,000 $ base fund it never spends. City projects and bonuses are paid only from money above it — a project no longer triggers an emergency." },
      { art: "besser", de: "Stadtprojekte starten ab 30.000 $ in der Kasse. Die Prämie je Großauftrag ist jetzt 10 % des Überschusses, höchstens 1.500 $ — vorher fraß sie jeden Überschuss, und es kam nie ein Projekt zustande.",
        en: "City projects start at 30,000 $ in the treasury. The bonus per big order is now 10 % of the surplus, at most 1,500 $ — before, it ate every surplus and no project ever started." },
      { art: "fix", de: "Gestundete Steuern zählen jetzt als Schulden im Firmenwert.",
        en: "Deferred taxes now count as debt in company value." },
      { art: "fix", de: "Stadtprojekte verlangen nur noch Waren, die es in der Runde wirklich gibt, und nur so viel, wie lieferbar ist. Vorher scheiterten sie oft an einer Ware, die niemand herstellte.",
        en: "City projects now only ask for goods that actually exist in the round, and only as much as can be delivered. Before, they often failed on a good nobody produced." },
      { art: "fix", de: "Das Finanzamt zählt Geld, das die Bank gerade in Kurswetten gebunden hat, zur Lage der Stadt. Vorher stiegen die Steuern während jeder Wettrunde ohne echten Grund.",
        en: "The tax office now counts money the bank has tied up in running stock bets. Before, taxes rose during every betting round for no real reason." },
      { art: "besser", de: "Das Spiel lädt deutlich schneller: Dateien kommen komprimiert, und beim zweiten Besuch wird nur noch geprüft, ob sich etwas geändert hat.",
        en: "The game loads much faster: files are compressed, and on later visits the browser only checks whether anything changed." },
      { art: "besser", de: "Weniger Datenverkehr im Spiel: Der Server schickt nur noch, was sich wirklich geändert hat.",
        en: "Less in-game traffic: the server only sends what actually changed." }
    ]
  },
  {
    id: "2026-10-21d", datum: "2026-10-21",
    titel: { de: "Dynamische Steuersätze und Börsengebühr", en: "Dynamic tax rates and exchange fee" },
    punkte: [
      { art: "neu", de: "Die Steuersätze richten sich nach der Lage der Stadt: ab 20.000 $ normal, darunter +10 %, unter 3.000 $ Notstand mit +25 %.",
        en: "Tax rates follow the city's situation: normal from 20,000 $, +10 % below that, emergency (+25 %) below 3,000 $." },
      { art: "neu", de: "Börsengebühr: Bei jedem Verkauf an der Warenbörse zahlt der Verkäufer 20 % des Erlöses ans Finanzamt (22 % bei knapper Kasse, 25 % im Notstand).",
        en: "Exchange fee: on every sale at the commodity exchange the seller pays 20 % of the proceeds to the tax office (22 % when funds are tight, 25 % in an emergency)." },
      { art: "besser", de: "Das Finanzamt zeigt die aktuelle Steuerlage und erklärt, wann sich die Sätze ändern.",
        en: "The tax office shows the current tax situation and explains when rates change." }
    ]
  },
  {
    id: "2026-10-21c", datum: "2026-10-21",
    titel: { de: "Das Finanzamt öffnet", en: "The tax office opens" },
    punkte: [
      { art: "neu", de: "Finanzamt im Zentrum: 8 % Gewinnsteuer alle 10 Minuten, die ersten 1.000 $ Gewinn sind frei. Investitionen senken die Steuer.",
        en: "Tax office downtown: 8 % profit tax every 10 minutes, the first 1,000 $ are tax-free. Investments lower the tax." },
      { art: "neu", de: "Wettgewinne werden mit 10 % versteuert. 40 % der Steuern gehen an die Bankreserve, 60 % in die Stadtkasse.",
        en: "Betting profits are taxed at 10 %. 40 % of taxes go to the bank reserve, 60 % to the city treasury." },
      { art: "neu", de: "Großaufträge bekommen eine Prämie aus der Stadtkasse.", en: "Big orders get a bonus from the city treasury." },
      { art: "neu", de: "Stadtprojekte: Ab 25.000 $ in der Stadtkasse baut die Stadt Stadion, Krankenhaus & Co. — Spieler und Bots liefern, das fertige Gebäude steht danach in der Stadt.",
        en: "City projects: from 25,000 $ in the treasury the city builds a stadium, hospital and more — players and bots deliver, the finished building appears in town." }
    ]
  },
  {
    id: "2026-10-21b", datum: "2026-10-21",
    titel: { de: "Kurswetten in der Stadtbank", en: "Stock bets at the city bank" },
    punkte: [
      { art: "neu", de: "Long oder Short auf den Firmenwert der Mitspieler setzen — Runden mit 2 min Annahme und 5 min Laufzeit.",
        en: "Go long or short on other players' company value — rounds with 2 min betting and 5 min run time." },
      { art: "neu", de: "Verlierer zahlen in den Topf der Gewinner, 5 % Gebühr gehen an die Bank.",
        en: "Losers pay into the winners' pot, 5 % fee goes to the bank." },
      { art: "neu", de: "Die Bank ist Gegenpartei: Sie füllt die kleinere Seite aus einer Reserve von 20.000 $ pro Spielrunde auf.",
        en: "The bank takes the other side, topping up the smaller pot from a 20,000 $ reserve per game." },
      { art: "neu", de: "Keine Wetten auf die eigene Firma oder Firmen, an denen du 50 % oder mehr hältst.",
        en: "No bets on your own company or companies you hold 50 % or more of." },
      { art: "neu", de: "Diese Neuigkeiten-Spalte auf der Startseite.", en: "This news column on the start page." },
      { art: "besser", de: "Startbildschirm neu gestaltet: zwei klare Schritte, der Start-Knopf sofort sichtbar, alle Spielmodi im Überblick.",
        en: "Start screen redesigned: two clear steps, the start button visible right away, all game modes at a glance." },
      { art: "besser", de: "Neuer Endbildschirm mit Siegerpodest, deinem Platz, Endstand und Auszeichnungen — und „Karte ansehen“.",
        en: "New end screen with winners' podium, your placement, final standings and awards — plus “View map”." }
    ]
  },
  {
    id: "2026-10-21a", datum: "2026-10-21",
    titel: { de: "Neues Design und mehr Übersicht", en: "New design and a clearer interface" },
    punkte: [
      { art: "neu", de: "Lebende Höhenlinien-Karte als Hintergrund und ein neues Intro.",
        en: "Living contour-map background and a new intro." },
      { art: "neu", de: "Zwei Kartenstile: Vermessung (dunkel) und Kartenpapier (hell) — umschaltbar.",
        en: "Two map styles: Survey (dark) and Map paper (light) — switchable." },
      { art: "neu", de: "Neue Spielfläche: Industrie, Agrar und Stadt sehen jetzt klar verschieden aus.",
        en: "New playing field: industry, farmland and city now look clearly different." },
      { art: "neu", de: "Einstellungen für Grafik, Steuerung und Sound mit Qualitätsstufen.",
        en: "Settings for graphics, controls and sound with quality presets." },
      { art: "besser", de: "Gebäudekarte und Baumenü aufgeräumt, Aufgaben einklappbar, Kopfleiste mit Menü.",
        en: "Building card and build menu tidied up, collapsible quests, header menu." },
      { art: "besser", de: "Stadtbank mit Reitern Markt / Handeln / Depot, Angebote direkt an der Firma.",
        en: "City bank with Market / Trade / Portfolio tabs, offers shown at each company." },
      { art: "besser", de: "Firma-Panel und Lexikon übersichtlicher, Lexikon mit Suche.",
        en: "Company panel and glossary clearer, glossary with search." },
      { art: "besser", de: "Karte scrollt und zoomt deutlich flüssiger.", en: "Map scrolls and zooms much more smoothly." },
      { art: "fix", de: "Impressum und Datenschutz folgen dem gewählten Kartenstil.",
        en: "Imprint and privacy pages follow the chosen map style." }
    ]
  },
  {
    id: "2026-09-17a", datum: "2026-09-17",
    titel: { de: "Kartellwirtschaft", en: "Cartel economy" },
    punkte: [
      { art: "neu", de: "Neuer Spielmodus mit Familien statt Branchen — Auswahl für alle Spieler in der Lobby.",
        en: "New game mode with families instead of industries — picked by every player in the lobby." }
    ]
  }
];
