/* Neuigkeiten für die Startseite ("Was ist neu").
 * Neue Einträge OBEN anfügen. `id` muss eindeutig sein und neuer als die
 * vorigen sortieren — daran merkt sich der Browser, was schon gesehen wurde
 * (localStorage cs_updates_gesehen) und zeigt sonst den Punkt am Knopf.
 * `art`: "neu" (neue Funktion), "besser" (Verbesserung), "fix" (Fehler behoben). */
window.UPDATES = [
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
      { art: "neu", de: "Das Finanzamt kauft Aktien, wenn ein Kurs deutlich unter dem Wert liegt, und verkauft, wenn er deutlich darüber liegt — aber nur mit Geld, das nach den Stadtprojekten übrig ist.",
        en: "The tax office buys shares when a price is well below value and sells when it is well above — but only with money left over after city projects." },
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
