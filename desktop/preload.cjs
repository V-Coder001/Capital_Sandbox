/* Die einzige Brücke zwischen Spielfenster und Desktop-Hülle.
 *
 * Absichtlich winzig und ohne Node-Zugriff: der Client soll nur WISSEN, dass er
 * in der Desktop-App läuft (für den Online-Weg im Startbildschirm und später
 * das höhere Grafik-Preset) — er soll nichts auf dem Rechner tun können.
 *
 * CommonJS, weil ein Preload-Skript in Electron kein ES-Modul sein darf.
 *
 * Die Werte kommen über additionalArguments aus main.js, nicht über require():
 * Ein Preload-Skript läuft seit Electron 20 in der Sandbox, und dort ist
 * require() auf eine Handvoll eingebauter Module beschränkt. Ein
 * require("../package.json") wirft dann — und zwar lautlos, weil ein
 * gescheitertes Preload nur dazu führt, dass window.CS_DESKTOP fehlt. Beim
 * Entwickeln fiel das nicht auf: dort setzt npm die Variable
 * npm_package_version, der Aufruf lief also gar nicht erst. Erst im gebauten
 * Programm fehlte plötzlich der Knopf "Online-Runde erstellen". */
const { contextBridge } = require("electron");

const arg = (name, falls = "") => {
  const treffer = process.argv.find(a => a.startsWith(`--cs-${name}=`));
  return treffer ? treffer.slice(`--cs-${name}=`.length) : falls;
};

contextBridge.exposeInMainWorld("CS_DESKTOP", {
  version: arg("version"),
  plattform: process.platform,
  /* Adresse für Online-Runden. Die Hülle gibt sie vor, damit die App nicht
   * neu gebaut werden muss, wenn der Server einmal umzieht. */
  onlineServer: arg("online"),
});
