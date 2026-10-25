/* Neuigkeiten für die Startseite ("Was ist neu").
 * Neue Einträge OBEN anfügen. `id` muss eindeutig sein und neuer als die
 * vorigen sortieren — daran merkt sich der Browser, was schon gesehen wurde
 * (localStorage cs_updates_gesehen) und zeigt sonst den Punkt am Knopf.
 * `art`: "neu" (neue Funktion), "besser" (Verbesserung), "fix" (Fehler behoben). */
window.UPDATES = [
  {
    id: "2026-10-25o", datum: "2026-10-25",
    titel: { de: "Mehr Auswahl im Website-Generator", en: "More choice in the website generator" },
    punkte: [
      { art: "neu", de: "Sieben Vorlagen statt drei (neu: Dunkel, Retro, Natur, Modern) und zwölf Farben.",
        en: "Seven templates instead of three (new: Dark, Retro, Nature, Modern) and twelve colours." },
      { art: "neu", de: "Feinschliff: Schrift (Modern, Serif, Rund, Kraftvoll, Handschrift, Pixel), Kopf (Verlauf, Flach, Zentriert, Groß), Ecken und ein Muster im Kopf (Punkte, Streifen, Wellen, Raster).",
        en: "Fine-tuning: font (Modern, Serif, Round, Bold, Handwriting, Pixel), header (Gradient, Flat, Centered, Large), corners and a header pattern (Dots, Stripes, Waves, Grid)." },
      { art: "neu", de: "Fünf neue Abschnitte: Zahlen, Team, Kontakt, Fragen zum Aufklappen und Neuigkeiten aus dem Stadtkurier — bis zu acht pro Seite. Dazu ein Knopf „Überrasch mich“.",
        en: "Five new sections: numbers, team, contact, expandable FAQ and news from the City Courier — up to eight per page. Plus a “Surprise me” button." },
    ]
  },
  {
    id: "2026-10-25n", datum: "2026-10-25",
    titel: { de: "Website-Generator und Software-Cockpit", en: "Website generator and software cockpit" },
    punkte: [
      { art: "neu", de: "Bestellt eine Firma eine Website, gestaltet die Software-Firma sie selbst im Website-Generator: drei Vorlagen (Klar, Elegant, Bunt), acht Farben, Titel, Slogan und bis zu sechs Abschnitte in eigener Reihenfolge — Produkte, Betriebe, Direktkauf, Bewertungen, Über uns, Aktie und Galerie. Rechts läuft die Vorschau live mit.",
        en: "When a company orders a website, the software company designs it itself in the website generator: three templates (Clean, Elegant, Colourful), eight colours, title, slogan and up to six sections in any order — products, facilities, direct purchase, reviews, about us, share and gallery. A live preview runs alongside." },
      { art: "neu", de: "Die Einrichtung ist jetzt ein Honorar: Der Kunde zahlt bei der Bestellung, die Software-Firma bekommt es bei Lieferung. Nach 5 Minuten ohne Design geht die Standard-Vorlage online, dann gibt es nur das halbe Honorar. Bots liefern nach einer knappen Minute.",
        en: "The setup fee is now a commission: the client pays on ordering, the software company receives it on delivery. After 5 minutes without a design the standard template goes online and only half the fee is paid. Bots deliver after just under a minute." },
      { art: "neu", de: "Gute Websites wirken stärker: Mehr Abschnitte, ein Slogan und ein Text „Über uns“ heben die Qualität bis 100 % — und damit die Reichweite des Kunden. Die Standard-Vorlage schafft 80 %.",
        en: "Good websites work better: more sections, a slogan and an “About us” text raise the quality up to 100 % — and with it the client's reach. The standard template reaches 80 %." },
      { art: "besser", de: "Software-Firmen starten im neuen Reiter „Übersicht“: Einnahmen, Kunden, EP und Strom auf einen Blick, offene Website-Aufträge mit Frist und Honorar, alle Produkte als Kacheln mit dem nächsten Schritt und Hinweise, was gerade fehlt.",
        en: "Software companies now start in the new “Overview” tab: revenue, customers, DP and power at a glance, open website orders with deadline and fee, all products as tiles with the next step, and hints about what is missing." },
    ]
  },
  {
    id: "2026-10-25m", datum: "2026-10-25",
    titel: { de: "Neues Tutorial für jede Branche", en: "New tutorial for every industry" },
    punkte: [
      { art: "besser", de: "Jede Branche hat jetzt ihren eigenen Rundgang mit 9 bis 11 Schritten: erst bauen und verkaufen, dann das, was nur diese Branche ausmacht — Hofladen und Frühstück (Agrar), Wohnbau-Aufträge (Rohstoff), Grundbedarf der Stadt (Versorger), Ausbau mit Elektronik (Technik), Gäste, Sterne und Feste (Touristik), Shop-System, Statusseite und Bürger-App (Software), Ausschreibungen (Rüstung). Dazu für alle Stadt und Arbeiter, das Stadtnetz und ein Vermögensziel.",
        en: "Every industry now has its own walkthrough with 9 to 11 steps: first build and sell, then what makes that industry special — farm shop and breakfast (agriculture), housing orders (raw materials), the city's basic needs (utilities), upgrading with electronics (tech), guests, stars and festivals (tourism), shop system, status page and citizen app (software), tenders (defence). Plus city and workers, the city network and a net-worth goal for everyone." },
      { art: "besser", de: "Schritte haken sich selbst ab, sobald du die Handlung wirklich machst, und sagen, worauf sie warten. Geht etwas gerade nicht, kannst du einen Schritt „auslassen“.",
        en: "Steps tick themselves off once you actually do the action and say what they are waiting for. If something isn't possible right now, you can “skip” a step." },
    ]
  },
  {
    id: "2026-10-25l", datum: "2026-10-25",
    titel: { de: "Anleihenmarkt im Stadtnetz", en: "Bond market in the city network" },
    punkte: [
      { art: "besser", de: "Anleihen haben eine eigene Website: anleihen.cs im Stadtnetz. Anleihen am Markt als Karten mit Rating, Zins, Laufzeit und Zinsen bis zum Ende (Stadtanleihen zuerst), deine Anlagen und Schulden, ein Formular mit Vorschau zum Ausgeben sowie Zwangsversteigerungen und Vertragsangebote. Der Dock-Knopf „Finanzen“ entfällt im Sandkasten.",
        en: "Bonds have their own website: anleihen.cs in the city network. Bonds on the market as cards with rating, interest, term and interest until maturity (city bonds first), your investments and debts, an issue form with preview, plus foreclosure auctions and contract offers. The “Finance” dock button is gone in the sandbox." },
    ]
  },
  {
    id: "2026-10-25k", datum: "2026-10-25",
    titel: { de: "Stadtbank im Stadtnetz", en: "City bank in the city network" },
    punkte: [
      { art: "besser", de: "Die Stadtbank ist jetzt das Finanzportal bank.cs im Stadtnetz: Marktübersicht mit grün und rot eingefärbten Kacheln für Stadtindex, Branchen-Fonds und die größten Firmen, großer Verlauf, Analysen aus dem Stadtkurier und Anzeigen von Firmen. Unter „Aktien“ findest du jede Firma per Suche mit Detailseite; „Handeln & Depot“ ist die gewohnte Bank. Das Bankgebäude im Zentrum führt dorthin.",
        en: "The city bank is now the finance portal bank.cs in the city network: market overview with green and red tiles for the city index, industry funds and the largest companies, a large chart, analyses from the City Courier and company ads. Under “Shares” you find every company by search with a detail page; “Trading & portfolio” is the familiar bank. The bank building in the centre leads there." },
    ]
  },
  {
    id: "2026-10-25j", datum: "2026-10-25",
    titel: { de: "Stadtkurier im Stadtnetz", en: "City Courier in the city network" },
    punkte: [
      { art: "neu", de: "Die Nachrichtenzentrale ist weg — ihr Platz im Zentrum ist ein freier Bauplatz. Die Nachrichten stehen jetzt als Stadtkurier im Stadtnetz: Marktbericht alle zwei Minuten, dazu Börse, Stadt und Firmen, mit Aufmacher, Ressorts, Kursen und Archiv. Großaufträge und Ausschreibungen laufen als rote Eilmeldung.",
        en: "The news centre is gone — its spot in the centre is a free building plot. The news now lives as the City Courier in the city network: market report every two minutes plus exchange, city and companies, with lead story, sections, prices and archive. Group orders and tenders run as a red breaking-news banner." },
      { art: "neu", de: "Die Warenbörse ist jetzt die Website boerse.cs im Stadtnetz: links alle Waren nach Gruppen mit Kurs und Trend, rechts die gewählte Ware mit Kursverlauf, bestem Angebot und Gesuch, einem Formular mit Kaufen/Verkaufen-Umschalter und dem Orderbuch in zwei Spalten. Der Dock-Knopf „Börse“ entfällt im Sandkasten.",
        en: "The goods exchange is now the website boerse.cs in the city network: goods by group with price and trend on the left, the selected good with price chart, best offer and bid, a buy/sell form and the order book in two columns on the right. The “Exchange” dock button is gone in the sandbox." },
      { art: "besser", de: "Neue Stadtnetz-Startseite: großer Suchkopf mit den Zahlen der Stadt, Branchen-Filter, Firmenkarten mit Titelband und Schlagwörtern, „Läuft gerade“, „Neu im Stadtnetz“ und Rechenzentren in der Seitenleiste. Ein Punkt am Stadtnetz-Knopf zeigt eine neue Ausgabe.",
        en: "New city-network home page: large search header with city figures, industry filter, company cards with banner and tags, “Happening now”, “New in the city network” and data centres in the sidebar. A dot on the city-network button marks a new issue." },
    ]
  },
  {
    id: "2026-10-25i", datum: "2026-10-25",
    titel: { de: "Sandkasten ohne Mafia-Waren", en: "Sandbox without mafia goods" },
    punkte: [
      { art: "fix", de: "Schwarzgebrannter, Falschgeld, Goldbarren und Schmuggelzigaretten gehören zur Kartellwirtschaft. Im Sandkasten tauchen sie nicht mehr in Großaufträgen, im Kursticker, in den Warenlisten und im Marktbericht auf; die Familien-Gebäude fehlen im Lexikon.",
        en: "Moonshine, counterfeit money, gold bars and contraband cigarettes belong to the cartel economy. In the sandbox they no longer appear in group orders, the price ticker, goods lists or the market report; the family buildings are gone from the lexicon." },
    ]
  },
  {
    id: "2026-10-25h", datum: "2026-10-25",
    titel: { de: "Stadtnetz und Firmen-Websites", en: "City network and company websites" },
    punkte: [
      { art: "neu", de: "Stadtnetz (Knopf unten): Startseite mit allen Firmen-Websites, sortiert nach Besuchern, Suche, laufenden Festen, Ausschreibungen und Aktionen sowie den Anzeigen aus dem Werbenetz. Wer keine Website hat, steht nicht drin.",
        en: "City network (button at the bottom): home page with every company website sorted by visitors, search, running festivals, tenders and campaigns plus ads from the ad network. Companies without a website are not listed." },
      { art: "neu", de: "Jede bestellte Website ist jetzt eine echte Seite mit Betrieben, Produkten, Shop und Aktie. Das Branchenportal macht sie zum Laden: Hofladen (Agrar), Großhandel (Technik), Baustoff-Portal (Rohstoff, +5 % auf Wohnbau-Lieferungen), Kundenportal (Versorger) — Mitspieler kaufen dort sofort zum Ø-Kurs plus 5 %.",
        en: "Every ordered website is now a real page with venues, products, shop and shares. The industry portal turns it into a shop: farm shop (agriculture), wholesale (tech), building-materials portal (raw materials, +5 % on housing deliveries), customer portal (utilities) — other players buy instantly at average price plus 5 %." },
      { art: "neu", de: "Rüstung bekommt das Ausschreibungsportal: Gebote zählen 5 % günstiger, jede Lieferung bringt 15 % mehr, und Ausschreibungen kommen häufiger (alle 2½ statt 4 Minuten). Mit dem Modul „Aktionen“ startet jede Branche ihre eigene Aktion (5 Minuten +25 % Reichweite).",
        en: "Defence gets the tender portal: bids count 5 % cheaper, every delivery pays 15 % more, and tenders come more often (every 2½ instead of 4 minutes). With the “Campaigns” module every industry starts its own campaign (+25 % reach for 5 minutes)." },
    ]
  },
  {
    id: "2026-10-25g", datum: "2026-10-25",
    titel: { de: "Rechenzentren mit Statusseite und Websites von der Software-Branche", en: "Data centres with status pages and websites from the software industry" },
    punkte: [
      { art: "neu", de: "Jede Software-Firma hat eine Statusseite (status.cs/…): Verfügbarkeit der letzten 30 Minuten, Rechenzentren mit Auslastung und alles, was darauf läuft. Zu öffnen über die Gebäudekarte eines Rechenzentrums oder im Software-Panel.",
        en: "Every software company has a status page (status.cs/…): availability over the last 30 minutes, data centres with utilisation and everything that runs on them. Open it from a data centre's building card or in the software panel." },
      { art: "neu", de: "Hosting direkt auf der Seite: Shop-System und Steuerung installierst du dort auf deinen eigenen Gebäuden. Als Inhaber stellst du Preise mit −/+ ein, baust aus und verteilst deine Plätze auf Shops, Apps und Websites.",
        en: "Hosting right on the page: install the shop system and control software on your own buildings there. As the owner you set prices with −/+, expand and split your capacity between shops, apps and websites." },
      { art: "neu", de: "Website-Baukasten: Software-Firmen entwickeln Grundseite, Branchenportal und Aktionen. Andere Firmen bestellen eine Website und bekommen +5 bis +15 % Reichweite — schneller verkaufen, mehr Gäste, mehr Grundbedarf. Ohne Anbieter gibt es die teure Grundseite des Stadtportals.",
        en: "Website builder: software companies develop a basic site, industry portal and campaigns. Other companies order a website and get +5 to +15 % reach — faster sales, more guests, more basic needs. Without a provider there is the city portal's expensive basic site." },
    ]
  },
  {
    id: "2026-10-25f", datum: "2026-10-25",
    titel: { de: "Buchungsseiten für Hotels", en: "Booking pages for hotels" },
    punkte: [
      { art: "neu", de: "Jede Touristik-Firma hat eine Buchungsseite im Stil der Shop-Seiten: ihre Häuser mit Sternen, Zimmerpreis und Frühstück, Gästebewertungen und Live-Zahlen. Zu öffnen über „Hotels der Stadt“ im Touristik-Panel oder über die Gebäudekarte.",
        en: "Every tourism company has a booking page styled like the shop pages: its venues with stars, room price and breakfast, guest reviews and live figures. Open it from “Hotels in the city” in the tourism panel or from the building card." },
      { art: "neu", de: "Auf der eigenen Buchungsseite stellst du Zimmerpreis (mit +/−), Renovierung und Stadtfeste direkt ein; „Auf der Karte zeigen“ springt zum Haus.",
        en: "On your own booking page you set the room price (with +/−), renovation and city festivals directly; “Show on map” jumps to the venue." },
    ]
  },
  {
    id: "2026-10-25e", datum: "2026-10-25",
    titel: { de: "Touristik: Gäste, Sterne und Stadtfeste", en: "Tourism: guests, stars and city festivals" },
    punkte: [
      { art: "neu", de: "Gäste: Jede Minute kommen Gäste in die Stadt — mehr, je größer und zufriedener sie ist. Sie wählen ein Hotel nach Bewertung und Zimmerpreis und zahlen direkt an die Touristik-Firma. Wer zu teuer ist, verliert Gäste an andere Urlaubsorte. Ersetzt den Grundbedarf an Übernachtungen.",
        en: "Guests: every minute guests come to the city — more the bigger and happier it is. They pick a hotel by rating and room price and pay the tourism company directly. Too expensive loses guests to other destinations. Replaces the basic need for lodging." },
      { art: "neu", de: "Sterne: Strandhotels lassen sich von 2 auf bis zu 5 Sterne renovieren (1.500 / 3.000 / 5.000 $). Mehr Sterne bringen mehr Gäste oder höhere Preise. Ab 3 Sternen erwarten die Gäste Frühstück: Obst, Honig, Saft oder Gebäck aus dem Lager.",
        en: "Stars: beach hotels can be renovated from 2 up to 5 stars (1,500 / 3,000 / 5,000 $). More stars bring more guests or higher prices. From 3 stars guests expect breakfast: fruit, honey, juice or pastries from stock." },
      { art: "neu", de: "Stadtfeste: Strandfest, Konzert oder Festival locken 5 bis 8 Minuten lang 60 bis 150 % mehr Gäste, machen die Bewohner zufriedener, und beim Festival kaufen sie mehr in den Läden. Der Veranstalter bekommt den größten Teil der Gäste.",
        en: "City festivals: a beach party, concert or festival draws 60 to 150 % more guests for 5 to 8 minutes, makes residents happier, and during a festival they buy more in shops. The organiser gets the biggest share of guests." },
      { art: "neu", de: "Neues Touristik-Panel (Knopf unten, sobald dir ein Campingplatz oder Strandhotel gehört): Gäste, Bewertung, Zimmerpreis, Renovieren, Feste und alle Hotels der Stadt.",
        en: "New tourism panel (button at the bottom once you own a campground or beach hotel): guests, rating, room price, renovation, festivals and all hotels in the city." },
    ]
  },
  {
    id: "2026-10-25d", datum: "2026-10-25",
    titel: { de: "Ein Modus, faire Branchen, Zeitlimit und Hinweise", en: "One mode, fair industries, time limit and hints" },
    punkte: [
      { art: "besser", de: "Vorerst wird nur der Sandkasten gespielt. Planwirtschaft, Einsteiger, Race Day und Kartell sind gesperrt.",
        en: "For now only sandbox is played. Planned economy, beginner, Race Day and cartel are locked." },
      { art: "neu", de: "Grundbedarf der Bewohner: Je 100 Einwohner kauft die Stadt jede Minute Strom, Wasser und Übernachtungen bei den Firmen (mindestens 70 % des Grundpreises). Versorger und Touristik wachsen jetzt mit der Stadt.",
        en: "Residents' basic needs: per 100 residents the city buys power, water and lodging from companies every minute (at least 70 % of base price). Utilities and tourism now grow with the city." },
      { art: "besser", de: "Balancing: Bürger-Apps höchstens 0,50 $ je Nutzer, Nutzerquote 35/50/70 %, Markenwert der Software-Firmen fünffach. Strandhotel braucht 40 % weniger Wasser und Strom. In großen Städten zog Software sonst allen davon.",
        en: "Balancing: citizen apps at most 0.50 $ per user, adoption 35/50/70 %, software brand value five times. Beach hotels need 40 % less water and power. Software otherwise ran away in large cities." },
      { art: "neu", de: "Zeitlimit im Warteraum (30, 45, 60 oder 90 Minuten): Ist die Zeit um, gewinnt das höchste Vermögen. Die Restzeit läuft oben neben dem Ziel mit. Die Zeitangaben beim Vermögensziel stimmen wieder.",
        en: "Time limit in the lobby (30, 45, 60 or 90 minutes): when time is up the highest net worth wins. The remaining time runs next to the goal. The duration hints for the net-worth goal are accurate again." },
      { art: "neu", de: "Hinweise im Spiel: Jedes System wird kurz erklärt, wenn es zum ersten Mal wichtig wird — Stadt, Arbeiter, Löhne, Baumaterial, Versorgung, Finanzamt, Stadtanleihen, Aktien. Abschaltbar unter Einstellungen → Steuerung.",
        en: "In-game hints: each system is briefly explained when it first matters — city, workers, wages, building materials, supply, tax office, city bonds, shares. Can be switched off under Settings → Controls." },
      { art: "fix", de: "Firmennamen mit „&“ erscheinen in Meldungen, im Warteraum und bei den Rennen wieder richtig (vorher „&amp;“).",
        en: "Company names with “&” show correctly again in notices, the lobby and races (previously “&amp;”)." },
    ]
  },
  {
    id: "2026-10-25c", datum: "2026-10-25",
    titel: { de: "Flüssigeres Spiel: Glas-Effekt, automatische Grafik, Bildraten-Anzeige", en: "Smoother game: glass effect, automatic graphics, frame-rate display" },
    punkte: [
      { art: "besser", de: "Neue Grafik-Einstellung „Glas-Effekt“: die Unschärfe hinter Leisten und Fenstern lässt sich abschalten. Sie muss bei jedem Kartenbild neu berechnet werden und ist auf Retina-Bildschirmen und schwächeren Rechnern einer der größten Bremsklötze. Bei Qualität Mittel und Niedrig ist sie jetzt aus.",
        en: "New graphics setting “Glass effect”: the blur behind bars and windows can be switched off. It has to be recalculated for every map frame and is one of the biggest slowdowns on Retina screens and weaker computers. It is now off at medium and low quality." },
      { art: "neu", de: "„Automatisch anpassen“ (an): Ruckelt das Spiel länger unter etwa 40 Bilder pro Sekunde, schaltet es die Grafik stufenweise herunter — erst Glas, dann Auflösung, dann Wolken und Hintergrund — und sagt Bescheid.",
        en: "“Adjust automatically” (on): if the game stays below about 40 frames per second, graphics are lowered step by step — first glass, then resolution, then clouds and background — with a notice." },
      { art: "neu", de: "„Bildrate anzeigen“: kleine Anzeige unten links mit Bildern pro Sekunde und Hängern.",
        en: "“Show frame rate”: a small display bottom left with frames per second and hitches." },
      { art: "besser", de: "Die Karte zeichnet nur noch, was im Bild ist. Hineingezoomt halbiert das die Zeichenzeit.",
        en: "The map only draws what is on screen. When zoomed in this halves the drawing time." },
    ]
  },
  {
    id: "2026-10-25c", datum: "2026-10-25",
    titel: { de: "Rüstungsaufträge: Ausschreibungen von Polizei, Stadtwache und Co.", en: "Arms contracts: tenders from the police, city guard and more" },
    punkte: [
      { art: "neu", de: "Polizei, Stadtwache, Schützenverein und Grenzschutz schreiben regelmäßig Lieferungen aus. Rüstungsfirmen bieten 60 s lang verdeckt in Prozent des Listenpreises (80–140 %), das günstigste Gebot bekommt den Zuschlag. Zu finden im Firma-Fenster.",
        en: "The police, city guard, shooting club and border guard regularly put deliveries out to tender. Arms companies bid secretly for 60 s as a percentage of the list price (80–140 %); the cheapest bid wins. Found in the company window." },
      { art: "neu", de: "Der Gewinner liefert innerhalb von 5 Minuten und wird je Lieferung bezahlt. Fehlt am Ende etwas, kostet das 20 % des fehlenden Werts als Vertragsstrafe und 25 Punkte Lieferruf. Mit schlechtem Ruf muss man günstiger bieten, vollständige Lieferungen bringen Ruf zurück.",
        en: "The winner delivers within 5 minutes and is paid per delivery. Anything missing at the end costs 20 % of its value as a penalty and 25 points of delivery reputation. With a poor reputation you have to bid lower; complete deliveries restore it." },
      { art: "besser", de: "Touristik: Campingplätze bringen 20 % mehr Übernachtungen, und viel Absatz drückt den Kurs weniger.",
        en: "Tourism: campgrounds produce 20 % more overnight stays, and high sales push down the price less." },
      { art: "fix", de: "Bots verkaufen in Geldnot eigene Aktien nur noch bis genau 50 %. Bisher ging ein ganzes 25er-Paket raus, und sie fielen von 51 % auf 26 % Eigenanteil.",
        en: "Bots short of money now sell their own shares only down to exactly 50 %. Previously a whole package of 25 went, dropping them from 51 % to 26 % ownership." },
      { art: "fix", de: "Die Touristik hält genug Wasser und Strom für ihre Strandhotels vor und baut über vier Gebäude hinaus. Der Ölförderer baut keine weiteren Pumpen, solange sich unverkauftes Öl stapelt.",
        en: "Tourism keeps enough water and power for its beach hotels and builds beyond four buildings. The oil producer stops building pumps while unsold oil piles up." },
    ]
  },
  {
    id: "2026-10-25b", datum: "2026-10-25",
    titel: { de: "Balancing: Die Rüstung ist zurück im Geschäft", en: "Balancing: the arms industry is back in business" },
    punkte: [
      { art: "besser", de: "Das Stadtnetz bietet jetzt auch Erz und Stahl als Notversorgung an (25 % über Grundpreis, begrenzt nachgefüllt). Bisher stand die Rüstungskette oft eine halbe Runde ohne Stahl still.",
        en: "The city grid now also offers ore and steel as emergency supply (25 % above base price, limited refill). Until now the arms chain often stood idle without steel for half a round." },
      { art: "besser", de: "Rüstungsgüter haben einen größeren Stadtmarkt: Viel Absatz drückt den Kurs von Munition, Pistolen und Panzern weniger stark.",
        en: "Armaments have a larger city market: high sales push down the price of ammunition, pistols and tanks less." },
      { art: "besser", de: "Waffenschmiede und Panzerwerk produzieren knapp 20 % mehr. Die Werke brauchen weniger Personal: Munitionsfabrik 4, Waffenschmiede 10, Panzerwerk 16 Arbeiter.",
        en: "Gunsmith and tank works produce almost 20 % more. The plants need fewer staff: ammunition factory 4, gunsmith 10, tank works 16 workers." },
      { art: "fix", de: "Rüstungs-Bot: verkauft seine Munition an die Stadt, statt sie zu horten, kauft Stahl, Elektronik und Diesel, sobald die Werke stehen, und baut das Panzerwerk, bevor er ausbaut. Auch die Touristik verkauft ihre Übernachtungen jetzt sofort im Laden.",
        en: "Arms bot: sells its ammunition to the city instead of hoarding it, buys steel, electronics and diesel once its plants stand, and builds the tank works before upgrading. Tourism now also sells its overnight stays in the shop right away." },
      { art: "fix", de: "Bots verkaufen zugekaufte Zutaten nicht mehr mit Verlust weiter und geben sie nicht an Stadtprojekte ab. Baumaterial für das nächste eigene Gebäude behalten sie.",
        en: "Bots no longer resell purchased ingredients at a loss or hand them to city projects. They keep the building materials for their next own building." },
      { art: "fix", de: "Bots bedienen Kaufgebote anderer Firmen vor den Stadtkunden. Ziegel kamen so bisher kaum an der Börse an, und viele Bauten blieben aus.",
        en: "Bots serve other companies' buy orders before city customers. Until now bricks rarely reached the exchange and many buildings were never built." },
      { art: "fix", de: "Bots passen ihre Regalpreise dem Kurs an, erhöhen den Lohn auch mit knapper Kasse, wenn ihnen fast alle Arbeiter fehlen, und geben in Geldnot keine Aktienmehrheit mehr ab.",
        en: "Bots adjust their shelf prices to the market, raise wages even when cash is tight if they are short of almost all workers, and no longer give up their majority stake when short of money." },
    ]
  },
  {
    id: "2026-10-25a", datum: "2026-10-25",
    titel: { de: "Balancing: Software kann vorne mitspielen", en: "Balancing: software can compete for the top" },
    punkte: [
      { art: "besser", de: "Das Stadtportal kostet jetzt 8 % statt 5 % je Verkauf. Eigene Shop-Systeme der Software-Firmen werden dadurch attraktiver, und sie können mehr verlangen.",
        en: "The city portal now costs 8 % instead of 5 % per sale. Software companies' own shop systems become more attractive and can charge more." },
      { art: "besser", de: "Markenwert der Software-Firmen: die Einnahmen der letzten 10 Minuten zählen achtfach (vorher zweifach) zum Firmenwert — ihr Wert steckt in laufenden Erträgen, nicht in Gebäuden.",
        en: "Software brand value: the last 10 minutes of income count eight times (previously twice) towards company value — its worth lies in recurring income, not buildings." },
      { art: "besser", de: "Bürger-Apps: Abo bis 1,00 $ je Nutzer und Minute (Start 0,50 $), bis 85 % der Einwohner nutzen Apps, 200 Nutzer je Rechenzentrums-Stufe.",
        en: "Citizen apps: subscription up to 1.00 $ per user and minute (start 0.50 $), up to 85 % of residents use apps, 200 users per data-centre level." },
      { art: "besser", de: "Weniger Personal und Strom: Rechenzentrum 4 Arbeiter und 0,2 Strom je Stufe, Entwicklerstudio 6 Arbeiter, Campingplatz 3, Strandhotel 5. Die Touristik litt besonders unter den Löhnen.",
        en: "Less staff and power: data centre 4 workers and 0.2 power per level, developer studio 6 workers, campground 3, beach hotel 5. Tourism suffered most from wages." },
      { art: "fix", de: "Software-Bots bauen jetzt Rechenzentren aus, wenn Kunden, App-Nutzer oder Abos an die Grenze stoßen, erhöhen ihre Gebühren schrittweise und unterbieten sich bei App-Preisen nicht mehr bis aufs Minimum. Bots ohne eigenen Laden bauen nichts mehr aus.",
        en: "Software bots now upgrade data centres when customers, app users or subscriptions hit the limit, raise their fees step by step and no longer undercut each other's app prices down to the minimum. Bots without their own shop no longer upgrade." },
    ]
  },
  {
    id: "2026-10-24d", datum: "2026-10-24",
    titel: { de: "Software für die Stadt: Bürger-Apps, Jobbörse, neues Software-Panel", en: "Software for the city: citizen apps, job board, new software panel" },
    punkte: [
      { art: "neu", de: "Bürger-Apps: Software-Firmen entwickeln eine App für die Einwohner. Bis zu 75 % der Bewohner nutzen Apps, sie wählen nach Qualität und Preis und zahlen ein Abo je Minute. Je Rechenzentrums-Stufe bedient eine Firma 150 Nutzer.",
        en: "Citizen apps: software companies develop an app for residents. Up to 75 % of residents use apps, choose by quality and price and pay a subscription per minute. Each data-centre level serves 150 users." },
      { art: "neu", de: "Jobbörse: Firmen abonnieren sie im Firma-Panel und bekommen bei knappen Arbeitern Vorrang — wie +0,3 bis +0,7 Lohnstufen, für eine Gebühr je Arbeiter. Je Rechenzentrums-Stufe des Anbieters 3 Abos.",
        en: "Job board: companies subscribe in the company panel and get priority when workers are scarce — like +0.3 to +0.7 wage levels, for a fee per worker. 3 subscriptions per data-centre level of the provider." },
      { art: "neu", de: "Nutzt mindestens die Hälfte der Einwohner eine Bürger-App, steigt die Zufriedenheit um 5 % (Digitale Stadt).",
        en: "If at least half the residents use a citizen app, satisfaction rises by 5 % (digital city)." },
      { art: "besser", de: "Software-Panel aufgeräumt: Reiter Markt, Mein System, Entwicklung, Design und Produkte statt einer langen Seite, oben alle eigenen Produkte auf einen Blick.",
        en: "Software panel tidied up: tabs Market, My system, Development, Design and Products instead of one long page, with all your products at a glance at the top." },
      { art: "besser", de: "Bots entwickeln Bürger-Apps und Jobbörsen, passen ihre App-Preise an und abonnieren Jobbörsen, wenn ihnen Leute fehlen.",
        en: "Bots develop citizen apps and job boards, adjust their app prices and subscribe to job boards when they are short of staff." },
    ]
  },
  {
    id: "2026-10-24c", datum: "2026-10-24",
    titel: { de: "Die Stadt kauft bei euch ein — Anleihen, Fachkräfte, Pendler", en: "The city buys from you — bonds, skilled workers, commuters" },
    punkte: [
      { art: "neu", de: "Wohnblöcke brauchen Baumaterial: Die Stadt bestellt Ziegel, Beton, Stahl und Elektronik und zahlt 15 % über Kurs. Liefern geht in der Stadtübersicht. Kommt nach 90 s nicht alles, kauft sie den Rest teurer anderswo.",
        en: "Housing needs building materials: the city orders bricks, concrete, steel and electronics and pays 15 % above market. Deliver in the city overview. If not everything arrives within 90 s, it buys the rest elsewhere at a higher price." },
      { art: "neu", de: "Stadtanleihen: Fehlt der Stadt bei Wohnungsnot das Geld, gibt sie Anleihen aus (2.000 $, 0,5 % je Minute, 15 min, höchstens 20.000 $ Schulden). Spieler und Bots zeichnen sie an der Stadtbank.",
        en: "City bonds: if the city lacks money during a housing shortage it issues bonds (2,000 $, 0.5 % per minute, 15 min, at most 20,000 $ debt). Players and bots buy them at the city bank." },
      { art: "neu", de: "Fachkräfte: Pharma-Labor, Entwicklerstudio und Chipfabrik brauchen zur Hälfte Fachkräfte. 10 % der Arbeitenden sind welche, die Stadtbibliothek bildet weitere 10 % aus.",
        en: "Skilled workers: pharma lab, developer studio and chip factory need half skilled workers. 10 % of the workforce are skilled, the city library trains another 10 %." },
      { art: "neu", de: "Steuerungssoftware spart ein Viertel der Arbeiter eines Gebäudes.",
        en: "Control software saves a quarter of a building's workers." },
      { art: "besser", de: "Bots passen ihre Löhne an, bauen bei Arbeitermangel seltener neu und liefern Baumaterial an die Stadt.",
        en: "Bots adjust their wages, build less when workers are scarce and deliver building materials to the city." },
      { art: "neu", de: "Die Einsteiger-Runde hat jetzt auch eine wachsende Stadt. Mehr Einwohner bringen mehr Pendler auf die Straßen. Neues Kapitel „Die Stadt wächst“ in der Spielanleitung, Lexikon-Gruppe „Stadt & Arbeit“ und ein Tutorial-Schritt.",
        en: "The beginner round now has a growing city too. More residents bring more commuters to the streets. New chapter “The city grows” in the manual, lexicon group “City & work” and a tutorial step." },
    ]
  },
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
