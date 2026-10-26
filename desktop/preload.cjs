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
   * neu gebaut werden muss, wenn der Server einmal umzieht. */
  onlineServer: process.env.CS_ONLINE_SERVER || "https://capitalsandbox.io",
});
