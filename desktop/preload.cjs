/* Die einzige Brücke zwischen Spielfenster und Desktop-Hülle.
 *
 * Absichtlich winzig und ohne Node-Zugriff: der Client soll nur WISSEN, dass er
 * in der Desktop-App läuft (für das höhere Grafik-Preset und später den
 * Online-Modus) — er soll nichts auf dem Rechner tun können.
 *
 * CommonJS, weil ein Preload-Skript in Electron kein ES-Modul sein darf. */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("CS_DESKTOP", {
  version: process.env.npm_package_version || require("../package.json").version,
  plattform: process.platform,
  /* Adresse für Online-Runden. Die Hülle gibt sie vor, damit die App nicht
   * neu gebaut werden muss, wenn der Server einmal umzieht.
   *
   * Mit www., und das ist kein Schönheitsfehler: Die nackte Domain antwortet
   * mit 301 auf www. — ohne CORS-Köpfe, weil die Umleitung vor unserem Server
   * passiert. Der Browser bricht die Anfrage dann an der Umleitung ab, und die
   * App landete im Rückfall auf dem eigenen Rechner, obwohl der Server lief. */
  onlineServer: process.env.CS_ONLINE_SERVER || "https://www.capitalsandbox.io",
});
