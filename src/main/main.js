const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerSaveBlocker, safeStorage, screen, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { PandoraApi } = require('./pandora');

const ICON = path.join(__dirname, 'icon.png');
const api = new PandoraApi();

let win = null;
let tray = null;
let quitting = false;
let blockerId = null;
let nowPlaying = { title: '', artist: '', playing: false };

/* ---------- credentials ---------- */

const credsFile = () => path.join(app.getPath('userData'), 'credentials.bin');

async function saveCreds(username, password) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return;
  // Without a keyring Linux falls back to a hard-coded key, which protects nothing: don't pretend to.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return;
  const blob = await safeStorage.encryptStringAsync(JSON.stringify({ username, password }));
  fs.writeFileSync(credsFile(), blob, { mode: 0o600 });
}

async function loadCreds() {
  try {
    const { result } = await safeStorage.decryptStringAsync(fs.readFileSync(credsFile()));
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/* ---------- window behaviour (kept in a file so it's known before the page loads) ---------- */

const behaviorFile = () => path.join(app.getPath('userData'), 'behavior.json');
const BEHAVIOR_DEFAULTS = { closeAction: 'minimize', startMinimized: false, launchAtLogin: false, autoUpdate: true };
let behavior = { ...BEHAVIOR_DEFAULTS };

function loadBehavior() {
  try {
    behavior = { ...BEHAVIOR_DEFAULTS, ...JSON.parse(fs.readFileSync(behaviorFile(), 'utf8')) };
  } catch {}
}

const CLOSE_ACTIONS = ['minimize', 'tray', 'quit'];

function setBehavior(input) {
  if (!input || typeof input !== 'object') return;
  const next = {};
  if (CLOSE_ACTIONS.includes(input.closeAction)) next.closeAction = input.closeAction;
  for (const k of ['startMinimized', 'launchAtLogin', 'autoUpdate']) if (typeof input[k] === 'boolean') next[k] = input[k];
  const launchChanged = 'launchAtLogin' in next && next.launchAtLogin !== behavior.launchAtLogin;
  behavior = { ...BEHAVIOR_DEFAULTS, ...behavior, ...next };
  fs.writeFileSync(behaviorFile(), JSON.stringify(behavior));
  if (launchChanged) applyLaunchAtLogin();
  syncTray();
}

// Electron's login-item API doesn't cover Linux, so write the freedesktop autostart entry ourselves.
function applyLaunchAtLogin() {
  if (process.platform === 'linux') {
    const file = path.join(os.homedir(), '.config', 'autostart', 'pandora-desktop.desktop');
    if (behavior.launchAtLogin) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, [
        '[Desktop Entry]', 'Type=Application', 'Name=Pandora', 'Comment=Pandora desktop client',
        `Exec="${process.execPath}" --hidden`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', '',
      ].join('\n'));
    } else {
      fs.rmSync(file, { force: true });
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: behavior.launchAtLogin, args: ['--hidden'] });
  }
}

/* ---------- window size and position ---------- */

const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const { x, y, width, height } = s;
    if (![width, height].every(Number.isFinite)) return null;
    // Only reuse the position if that spot is still on a connected screen.
    const onScreen = Number.isFinite(x) && Number.isFinite(y) && screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return x + 80 > b.x && x + 80 < b.x + b.width && y + 40 > b.y && y + 40 < b.y + b.height;
    });
    return { width, height, ...(onScreen ? { x, y } : {}), maximized: !!s.maximized };
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const maximized = win.isMaximized();
  const b = maximized ? (windowBounds || win.getBounds()) : win.getBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized })); } catch {}
}

let windowBounds = null; // last normal (not maximised) bounds
let saveTimer;
const queueSaveWindowState = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWindowState, 400); };

/* ---------- IPC ---------- */

// Every handler resolves to { ok, data } or { ok:false, error } so the renderer never sees a rejected IPC.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code };
    }
  });
}

handle('auth:saved', async () => {
  const c = await loadCreds();
  if (!c) return null;
  await api.login(c.username, c.password);
  return { username: c.username };
});
handle('auth:login', async (username, password) => {
  await api.login(username, password);
  await saveCreds(username, password);
  return { username };
});
handle('auth:logout', async () => {
  api.reset();
  api.saved = null;
  fs.rmSync(credsFile(), { force: true });
});
handle('stations:list', () => api.getStations());
handle('stations:create', (token) => api.createStation(token));
handle('stations:delete', (token) => api.deleteStation(token));
handle('playlist:get', (token, quality) => api.getPlaylist(token, quality));
handle('music:search', (text) => api.search(text));
handle('station:detail', (token) => api.getStationDetail(token));
handle('station:addSeed', (station, music) => api.addSeed(station, music));
handle('station:removeSeed', (seedId) => api.removeSeed(seedId));
handle('station:rename', (token, name) => api.renameStation(token, name));
handle('track:unrate', (feedbackId) => api.removeRating(feedbackId));
handle('track:rate', (station, track, up) => api.rate(station, track, up));

ipcMain.on('app:behavior', (_e, next) => setBehavior(next));
ipcMain.on('app:nowPlaying', (_e, info) => {
  if (!info || typeof info !== 'object') return;
  nowPlaying = { title: String(info.title || '').slice(0, 200), artist: String(info.artist || '').slice(0, 200), playing: !!info.playing };
  info = nowPlaying;
  // Keep the system awake while music plays so a hidden window isn't suspended.
  if (info.playing && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!info.playing && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  syncTray();
});

const sendCommand = (cmd) => win?.webContents.send('app:command', cmd);

/* ---------- updates (GitHub Releases) ---------- */

let updateStatus = { state: 'idle', version: app.getVersion() };

function setUpdateStatus(next) {
  updateStatus = { ...updateStatus, ...next };
  win?.webContents.send('app:update', updateStatus);
}

function setupUpdater() {
  if (!app.isPackaged) return; // nothing to update when running from source
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppExit = true;
  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => setUpdateStatus({ state: 'downloading', latest: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'current', checked: Date.now() }));
  autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdateStatus({ state: 'ready', latest: i.version }));
  autoUpdater.on('error', (e) => setUpdateStatus({ state: 'error', message: e.message }));
}

function checkForUpdates() {
  if (!app.isPackaged) return setUpdateStatus({ state: 'dev' });
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.on('update:check', checkForUpdates);
ipcMain.on('update:install', () => { quitting = true; autoUpdater.quitAndInstall(); });
ipcMain.handle('update:status', () => updateStatus);

/* ---------- window & tray ---------- */

function showWindow() {
  if (!win) return createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function syncTray() {
  if (!tray) return;
  const label = nowPlaying.title ? `${nowPlaying.title} • ${nowPlaying.artist}` : 'Nothing playing';
  tray.setToolTip(`Pandora\n${label}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nowPlaying.title ? label.slice(0, 60) : 'Pandora', enabled: false },
    { type: 'separator' },
    { label: nowPlaying.playing ? 'Pause' : 'Play', click: () => sendCommand('toggle') },
    { label: 'Skip', click: () => sendCommand('next') },
    { label: 'Thumbs up', click: () => sendCommand('like') },
    { type: 'separator' },
    { label: 'Show Pandora', click: showWindow },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 24, height: 24 });
  tray = new Tray(img);
  tray.on('click', () => (win && win.isVisible() && !win.isMinimized() ? win.hide() : showWindow()));
  syncTray();
}

// Chromium underlines misspellings by itself, but offers nothing to fix them with unless the app
// builds the right-click menu: suggestions, "Add to dictionary", and the usual edit actions.
function setupSpellcheck(contents) {
  const ses = contents.session;
  ses.setSpellCheckerEnabled(true);
  const wanted = [app.getLocale(), 'en-US'].filter(Boolean);
  const available = ses.availableSpellCheckerLanguages;
  const langs = wanted.filter((l, i) => available.includes(l) && wanted.indexOf(l) === i);
  if (langs.length) ses.setSpellCheckerLanguages(langs);

  contents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => contents.replaceMisspelling(word) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ type: 'separator' });
      items.push({ label: 'Add to dictionary', click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      const f = params.editFlags;
      items.push(
        { label: 'Cut', role: 'cut', enabled: f.canCut },
        { label: 'Copy', role: 'copy', enabled: f.canCopy },
        { label: 'Paste', role: 'paste', enabled: f.canPaste },
        { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll },
      );
    } else if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

const isWebUrl = (url) => /^https?:\/\//i.test(url);

function createWindow(hidden) {
  const saved = loadWindowState();
  win = new BrowserWindow({
    width: saved?.width ?? 1240,
    height: saved?.height ?? 800,
    ...(saved && 'x' in saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 380,
    minHeight: 300,
    show: !hidden,
    backgroundColor: '#0b0b0f',
    title: 'Pandora',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false, // keep the queue and progress running while hidden
    },
  });
  win.removeMenu();
  setupSpellcheck(win.webContents);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (saved?.maximized) win.maximize();
  windowBounds = win.getBounds();
  for (const ev of ['resize', 'move']) {
    win.on(ev, () => {
      if (!win.isMaximized() && !win.isMinimized()) windowBounds = win.getBounds();
      queueSaveWindowState();
    });
  }
  win.on('maximize', queueSaveWindowState);
  win.on('unmaximize', queueSaveWindowState);

  // The app never navigates away from its own page; links open in the browser, and only web links at that.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) win.reload();
  });

  // Closing doesn't have to stop the music: minimise to the taskbar or hide to the tray instead.
  win.on('close', (e) => {
    if (quitting || behavior.closeAction === 'quit') return;
    e.preventDefault();
    if (behavior.closeAction === 'tray') win.hide();
    else win.minimize();
  });
  win.on('closed', () => { win = null; });
}

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId('io.github.madmaxx636.pandora-desktop');
    // The page only ever needs desktop notifications; refuse everything else (camera, location, ...).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'notifications'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
    loadBehavior();
    const launchedHidden = process.argv.includes('--hidden');
    // Starting hidden only makes sense with a tray to bring the window back from.
    const hidden = (launchedHidden || behavior.startMinimized) && behavior.closeAction === 'tray';
    createTray();
    createWindow(hidden);
    setupUpdater();
    // Check shortly after launch, then every few hours while the app stays open in the background.
    const maybeCheck = () => { if (behavior.autoUpdate) checkForUpdates(); };
    setTimeout(maybeCheck, 8000);
    setInterval(maybeCheck, 6 * 60 * 60 * 1000);
    if ((launchedHidden || behavior.startMinimized) && !hidden) win.once('ready-to-show', () => win.minimize());
  });

  app.on('before-quit', () => { quitting = true; saveWindowState(); });
  app.on('window-all-closed', () => app.quit());
}
