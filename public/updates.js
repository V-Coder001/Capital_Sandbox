/* Neuigkeiten für die Startseite ("Was ist neu").
 * Neue Einträge OBEN anfügen. `id` muss eindeutig sein und neuer als die
 * vorigen sortieren — daran merkt sich der Browser, was schon gesehen wurde
 * (localStorage cs_updates_gesehen) und zeigt sonst den Punkt am Knopf.
 * `art`: "neu" (neue Funktion), "besser" (Verbesserung), "fix" (Fehler behoben). */
window.UPDATES = [
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
