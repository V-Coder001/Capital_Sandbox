/* ============================================================
 * Capital Sandbox — Desktop-Hülle (Electron)
 * ============================================================
 * Dieselbe Idee wie gateway.js: server.js bleibt unverändert und bekommt einen
 * eigenen echten Node-Prozess. Nur startet den hier nicht ein Server für fremde
 * Gruppen, sondern die App auf dem Rechner des Spielers — auf einem freien
 * Port, der nur auf 127.0.0.1 hört.
 *
 * Damit läuft das Spiel ohne Internet, ohne Cold Start und ohne die
 * Paketgrößen-Grenzen der Portale: volle Auflösung, Intro und Musik inklusive.
 *
 * Start zum Entwickeln:  npm run desktop
 * Pakete bauen:          npm run desktop:build
 */
import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import { spawn } from "child_process";
import net from "net";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* Muss vor dem ersten getPath("userData") stehen: ohne das hiesse der
 * Spielordner beim Entwickeln "Electron" und im fertigen Programm anders —
 * zwei getrennte Bestenlisten, je nachdem wie man startet. */
app.setName("Capital Sandbox");
const WURZEL = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
const DATEN = app.getPath("userData");          // schreibbar, anders als das App-Paket
const FENSTER_DATEI = path.join(DATEN, "fenster.json");

let serverProzess = null;
let fenster = null;
let beendetAbsichtlich = false;

/* ---------- Port suchen ----------
 * Wörtlich dieselbe Hilfsfunktion wie im Gateway: einmal auf Port 0 lauschen
 * lassen, den vergebenen Port merken, wieder schließen. Ein fester Port (3000)
 * wäre schlecht — der ist auf Entwicklerrechnern oft belegt. */
function freierPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/* Warten, bis der Spielserver wirklich antwortet — sonst zeigt das Fenster für
 * einen Moment eine Fehlerseite, statt direkt das Spiel. */
function wartenBisBereit(port, versucheUebrig = 150) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/invite", timeout: 800 }, res => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (--versucheUebrig <= 0) return reject(new Error("Der Spielserver wurde nicht rechtzeitig bereit."));
        setTimeout(tick, 200);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

async function serverStarten() {
  const port = await freierPort();
  /* ELECTRON_RUN_AS_NODE ist hier entscheidend: process.execPath ist die
   * Electron-Binary. Ohne die Variable würde sie ein zweites Fenster öffnen
   * statt server.js als reines Node-Programm auszuführen. */
  serverProzess = spawn(process.execPath, [path.join(WURZEL, "server.js")], {
    cwd: DATEN,                 // das App-Paket selbst ist nur lesbar
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      CS_DATEN: DATEN,
      CS_DESKTOP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProzess.stdout.on("data", d => process.stdout.write(`[Server] ${d}`));
  serverProzess.stderr.on("data", d => process.stderr.write(`[Server] ${d}`));
  serverProzess.on("exit", code => {
    serverProzess = null;
    if (beendetAbsichtlich) return;
    dialog.showErrorBox("Capital Sandbox",
      `Der Spielserver hat sich unerwartet beendet (Code ${code}). Bitte die App neu starten.`);
    app.quit();
  });
  await wartenBisBereit(port);
  return port;
}

function serverBeenden() {
  beendetAbsichtlich = true;
  if (serverProzess) { try { serverProzess.kill(); } catch {} serverProzess = null; }
}

/* ---------- Fenstergröße über Sitzungen hinweg behalten ---------- */
function fensterZustand() {
  try {
    const z = JSON.parse(fs.readFileSync(FENSTER_DATEI, "utf8"));
    if (Number.isFinite(z.width) && Number.isFinite(z.height)) return z;
  } catch {}
  return { width: 1440, height: 900 };
}
function fensterZustandSichern() {
  if (!fenster || fenster.isDestroyed()) return;
  const { width, height, x, y } = fenster.getNormalBounds();
  try {
    fs.writeFileSync(FENSTER_DATEI, JSON.stringify({ width, height, x, y, maximiert: fenster.isMaximized() }));
  } catch {}
}

function menueBauen() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "Spiel",
      submenu: [
        { label: "Neu laden", accelerator: "CmdOrCtrl+R", click: () => fenster?.reload() },
        { label: "Vollbild", accelerator: process.platform === "darwin" ? "Ctrl+Cmd+F" : "F11",
          click: () => fenster?.setFullScreen(!fenster.isFullScreen()) },
        { type: "separator" },
        { label: "Spielordner öffnen", click: () => shell.openPath(DATEN) },
        { label: "Entwicklerwerkzeuge", accelerator: process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: () => fenster?.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit", label: "Beenden" },
      ],
    },
    { role: "editMenu", label: "Bearbeiten" },
    { label: "Ansicht", submenu: [
      { role: "zoomIn", label: "Größer" }, { role: "zoomOut", label: "Kleiner" },
      { role: "resetZoom", label: "Normalgröße" },
    ] },
  ]));
}

async function fensterBauen() {
  const z = fensterZustand();
  fenster = new BrowserWindow({
    width: z.width, height: z.height, x: z.x, y: z.y,
    minWidth: 1024, minHeight: 640,
    backgroundColor: "#0b1120",
    show: false,
    title: "Capital Sandbox",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // der 1-Sekunden-Tick darf im Hintergrund nicht einschlafen
    },
  });
  if (z.maximiert) fenster.maximize();
  fenster.once("ready-to-show", () => fenster.show());
  fenster.on("close", fensterZustandSichern);
  fenster.on("closed", () => { fenster = null; });

  /* Links aus dem Spiel (Impressum, Datenschutz, GitHub) gehören in den
   * Systembrowser, nicht in das Spielfenster. */
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  let port;
  try {
    port = await serverStarten();
  } catch (e) {
    dialog.showErrorBox("Capital Sandbox", `Der Spielserver konnte nicht gestartet werden:\n\n${e.message}`);
    app.quit();
    return;
  }
  await fenster.loadURL(`http://127.0.0.1:${port}/`);
}

/* Zwei Instanzen hätten zwei Server und zwei Runden — und der Spieler würde
 * sich fragen, warum seine Firma verschwunden ist. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (fenster) { if (fenster.isMinimized()) fenster.restore(); fenster.focus(); }
  });
  app.whenReady().then(() => {
    menueBauen();
    fensterBauen();
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) fensterBauen(); });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { fensterZustandSichern(); serverBeenden(); });
  process.on("exit", serverBeenden);
}
