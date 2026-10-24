/* Neuigkeiten für die Startseite ("Was ist neu").
 * Neue Einträge OBEN anfügen. `id` muss eindeutig sein und neuer als die
 * vorigen sortieren — daran merkt sich der Browser, was schon gesehen wurde
 * (localStorage cs_updates_gesehen) und zeigt sonst den Punkt am Knopf.
 * `art`: "neu" (neue Funktion), "besser" (Verbesserung), "fix" (Fehler behoben). */
window.UPDATES = [
  {
    id: "2026-10-24b", datum: "2026-10-24",
    titel: { de: "Arbeitskräfte: Jedes Gebäude braucht Arbeiter", en: "Workforce: every building needs workers" },
    punkte: [
      { art: "neu", de: "Im Sandkasten braucht jedes Gebäude Arbeiter aus der Stadt — je teurer, desto mehr (eine Farm 5, ein Stahlwerk 24), jede Ausbaustufe 50 % mehr. Mit 3 von 5 Arbeitern läuft es zu 60 %, unter 25 % steht es still. Pausierte Gebäude geben ihre Leute frei.",
        en: "In sandbox mode every building needs workers from the city — the pricier, the more (a farm 5, a steel mill 24), 50 % more per upgrade. With 3 of 5 workers it runs at 60 %, below 25 % it stops. Paused buildings release their staff." },
      { art: "neu", de: "Löhne: Jede Firma wählt Spar-, Tarif- oder Spitzenlohn (4/6/9 $ je Arbeiter und Minute). Sind Arbeiter knapp, gehen sie zuerst zum besten Lohn. Eine Senkung greift erst nach 60 s Kündigungsfrist.",
        en: "Wages: each company picks low, standard or top wage (4/6/9 $ per worker and minute). When workers are scarce they go to the best payer first. A cut only takes effect after a 60 s notice period." },
      { art: "neu", de: "Vom Lohn gehen 15 % Lohnsteuer und 15 % Miete an die Stadt, 20 % sparen die Bewohner im Bürgerdepot. Arbeitslose bekommen Stütze aus der Stadtkasse.",
        en: "Of each wage, 15 % wage tax and 15 % rent go to the city and residents save 20 % in the citizens' depot. The unemployed receive benefits from the city treasury." },
      { art: "besser", de: "Die Stadt wächst mit der Wirtschaft: Neue Bewohner ziehen nur zu, wenn Stellen offen sind. Viele Arbeitslose senken die Zufriedenheit.",
        en: "The city grows with the economy: new residents only move in when jobs are open. High unemployment lowers satisfaction." },
      { art: "neu", de: "Belegschaft auf der Gebäudekarte, Löhne im Firma-Panel, Arbeitsmarkt in der Stadtübersicht. Endbildschirm und Bestenliste zeigen die Einwohner, dazu die Auszeichnung „Größter Arbeitgeber“.",
        en: "Staff on the building card, wages in the company panel, labour market in the city overview. End screen and leaderboard show the population, plus the “Largest employer” award." },
    ]
  },
  {
    id: "2026-10-24a", datum: "2026-10-24",
    titel: { de: "Die Stadt wächst: Einwohner und Wohnbau", en: "The city grows: residents and housing" },
    punkte: [
      { art: "neu", de: "Im Sandkasten hat die Stadt jetzt Einwohner. Sie wohnen im neuen Wohngebiet rund ums Zentrum, wo allein die Stadt baut: Siedlungshäuser, ab 800 Einwohnern Mietblöcke, ab 2.500 Wohntürme.",
        en: "In sandbox mode the city now has residents. They live in the new residential ring around the centre, where only the city builds: houses, apartment blocks from 800 residents, towers from 2,500." },
      { art: "neu", de: "Die Stadt baut aus der Stadtkasse, sobald weniger als 10 % der Wohnungen frei sind. Bewohner zahlen Miete an die Stadt — mehr Steuern und mehr Einwohner heißt schnelleres Wachstum.",
        en: "The city builds from its treasury whenever fewer than 10 % of homes are free. Residents pay rent to the city — more taxes and more residents mean faster growth." },
      { art: "neu", de: "Mehr Einwohner, mehr Kundschaft: Die Nachfrage in den Läden wächst mit der Einwohnerzahl (bis ×1,6).",
        en: "More residents, more customers: shop demand grows with the population (up to ×1.6)." },
      { art: "neu", de: "Zufriedenheit bestimmt, wie schnell Menschen zuziehen: Fehlen Strom, Wasser oder Lebensmittel im Handel, herrscht Steuernotstand, sinkt sie — fertige Stadtprojekte heben sie.",
        en: "Satisfaction sets how fast people move in: missing power, water or food in shops or a tax emergency lowers it — finished city projects raise it." },
      { art: "neu", de: "Einwohnerzahl in der Kopfleiste; ein Klick (oder auf das Wohngebiet) öffnet die Stadtübersicht im Finanzamt mit Verlauf, Wohnungen und Baustellen.",
        en: "Population in the header; a click (or on the residential area) opens the city overview in the tax office with history, homes and construction." },
      { art: "besser", de: "Bei Wohnungsnot hält das Finanzamt Geld für den Wohnbau zurück, statt alles in Fonds zu stecken. Wohnblöcke zählen zum Vermögen der Stadt.",
        en: "During a housing shortage the tax office keeps money back for housing instead of putting it all into funds. Housing counts towards the city's assets." },
    ]
  },
  {
    id: "2026-10-23b", datum: "2026-10-23",
    titel: { de: "Steuerungssoftware für Produktionsgebäude", en: "Control software for production buildings" },
    punkte: [
      { art: "neu", de: "Shop-Systeme laufen jetzt auch auf Produktionsgebäuden: Ernteplaner, Förderleitstand, Netzleitstelle, Fertigungsstraße, Buchungssystem und Feuerleitsystem bringen bis zu 10–15 % mehr Ausstoß bzw. 12 % weniger Rohstoffe. Die Wirkung hängt am Branchenbaum des Systems.",
        en: "Shop systems now also run production buildings: harvest planner, mining control, grid control, production line, booking system and fire control give up to 10–15 % more output or 12 % fewer inputs. The effect depends on the system's industry tree." },
      { art: "neu", de: "Software-Firmen legen ein Steuerungs-Abo je Gebäude und Minute fest. Gesteuerte Gebäude belegen Plätze im Rechenzentrum — fällt es aus, fehlt der Bonus bei allen Kunden.",
        en: "Software companies set a control subscription per building per minute. Controlled buildings take data-centre slots — if it fails, all customers lose the bonus." },
      { art: "besser", de: "Bots rechnen je Gebäude nach, ob sich die Steuerung lohnt, und Software-Bots passen ihr Abo an die Auslastung an.",
        en: "Bots work out per building whether control software pays off, and software bots adjust their subscription to demand." },
      { art: "neu", de: "Leitstand: Jedes gesteuerte Gebäude hat eine eigene Steuerungs-Oberfläche mit Live-Anzeigen (Ausstoß, Bonus, Lager, Rohstoff-Reichweite) und Alarm. Ab v2 Turbo (+30 % Ausstoß für 60 s), ab v3 Nachkauf mit einem Klick, ab v4 Auto-Turbo.",
        en: "Control room: every controlled building has its own interface with live gauges (output, bonus, stock, input range) and alarms. From v2 turbo (+30 % output for 60 s), from v3 one-click restocking, from v4 auto-turbo." },
      { art: "neu", de: "Software-Firmen gestalten ihren Leitstand wie die Shop-Website: Thema, Anzeigen (Balken, Zeiger, Ziffern, Ringe), Schrift, Effekte, Titel, Laufschrift und Leuchtfarbe — mit jeder Version mehr.",
        en: "Software companies design their control room like the shop website: theme, gauges (bars, needles, digits, rings), font, effects, title, ticker and glow colour — more with every version." },
      { art: "neu", de: "Werbenetz: Jede Firma kann bei einer Software-Firma Anzeigen buchen (3, 5 oder 10 Minuten). Sie laufen in allen Shops und Leitständen mit diesem System und bringen je Kunde des Systems 1,2 % mehr Preisspielraum (bis 12 % je Anzeige, 25 % insgesamt). Ein Werbeplatz je Version, höchstens drei.",
        en: "Ad network: any company can book ads with a software company (3, 5 or 10 minutes). They run in every shop and control room using that system and give 1.2 % more pricing room per customer of the system (up to 12 % per ad, 25 % in total). One ad slot per version, three at most." },
    ]
  },
  {
    id: "2026-10-23a", datum: "2026-10-23",
    titel: { de: "Bürgerdepot: Schwung für die Börse", en: "Citizens' depot: momentum for the exchange" },
    punkte: [
      { art: "neu", de: "Bürgerdepot: Die Stadtbewohner sparen. Je 1 $ Einkauf in den Online-Shops legen sie 40 ct zurück und kaufen damit jeden Markttag Branchenfonds und Aktien — bevorzugt unterbewertete Firmen mit guter Dividende. Bei Panik oder Überbewertung verkaufen sie. Das Depot wächst höchstens bis 30 % des Börsenwerts.",
        en: "Citizens' depot: city residents save. For every $1 spent in online shops they put aside 40 ¢ and buy sector funds and shares every market day — preferring undervalued companies with good dividends. They sell in a panic or when prices run too high. The depot grows to at most 30 % of total market value." },
      { art: "neu", de: "Fonds schütten aus: 80 % der Dividenden ihrer Aktien gehen alle 10 Minuten an die Anteilseigner. Ein Fonds hält jetzt bis zu 35 Aktien je Firma.",
        en: "Funds pay out: 80 % of the dividends on their shares go to unit holders every 10 minutes. A fund may now hold up to 35 shares per company." },
      { art: "besser", de: "Börsen-App neu: Über sie legen die Sparer an. Ohne App kommt nur die Hälfte ihrer Ersparnisse über die Stadtsparkasse an die Börse. Anbieter bekommen 1–1,5 % Provision, Lizenznehmer erhöhen die Reichweite und bekommen die Hälfte der Provision, die über sie läuft.",
        en: "Stock app reworked: savers invest through it. Without an app only half their savings reach the exchange via the city savings bank. Providers earn 1–1.5 % commission; licensees extend the reach and get half the commission that flows through them." },
      { art: "fix", de: "Die Bewohner der alten Börsen-App haben nie gehandelt (Kurs war intern ungültig).",
        en: "Residents of the old stock app never traded (the price was internally invalid)." },
      { art: "besser", de: "Bots legen Geld über ihrer Rücklage regelmäßig in Fonds an, nehmen Kaufanfragen von Fonds und Bürgerdepot zum fairen Kurs an und geben ab und zu kleine Aktienpakete aus.",
        en: "Bots regularly invest money above their reserve in funds, accept purchase requests from funds and the citizens' depot at a fair price and occasionally issue small share packages." },
    ]
  },
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
