const $ = (id) => document.getElementById(id);
const audio = $('audio');

/* ---------- storage & settings ---------- */

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const DEFAULTS = {
  quality: 'high',
  resume: false,
  thumbsDownSkips: true,
  notify: false,
  accent: '#3b6bff',
  tint: true,
  sort: 'pandora',
  cardSize: 'medium',
  historyLen: 20,
  confirmDelete: true,
  shortcuts: true,
  closeAction: 'minimize',
  startMinimized: false,
  launchAtLogin: false,
  autoUpdate: true,
};
const settings = { ...DEFAULTS, ...store.get('settings', {}) };

const SCHEMA = [
  { title: 'Playback', rows: [
    { key: 'quality', label: 'Audio quality', desc: 'Applies to songs queued from now on.', type: 'seg',
      options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] },
    { key: 'resume', label: 'Resume on launch', desc: 'Start your last station when the app opens.', type: 'toggle' },
    { key: 'thumbsDownSkips', label: 'Thumbs down skips', desc: 'Skip the song right after thumbing it down.', type: 'toggle' },
    { key: 'notify', label: 'Song notifications', desc: 'Show a desktop notification when the song changes.', type: 'toggle' },
  ] },
  { title: 'Stations', rows: [
    { key: 'sort', label: 'Sort stations', desc: 'Pinned stations always come first.', type: 'seg',
      options: [['pandora', 'Pandora'], ['az', 'A–Z'], ['recent', 'Recent']] },
    { key: 'historyLen', label: 'History length', desc: 'Songs kept in each station’s history.', type: 'seg',
      options: [[10, '10'], [20, '20'], [50, '50']] },
    { key: 'confirmDelete', label: 'Confirm before deleting', desc: 'Ask first when removing a station.', type: 'toggle' },
  ] },
  { title: 'Appearance', rows: [
    { key: 'accent', label: 'Accent colour', type: 'swatches',
      options: ['#3b6bff', '#8b5cf6', '#22c55e', '#ec4899', '#f97316', '#ef4444'] },
    { key: 'tint', label: 'Album colour backdrop', desc: 'Tint the page with the current album’s colour.', type: 'toggle' },
    { key: 'cardSize', label: 'Station card size', type: 'seg',
      options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  ] },
  { title: 'System', rows: [
    { key: 'closeAction', label: 'When closing the window', desc: 'Music keeps playing in the background unless you quit. Tray needs a system tray (not shown on some Linux desktops).', type: 'seg',
      options: [['minimize', 'Minimize'], ['tray', 'Tray'], ['quit', 'Quit']] },
    { key: 'startMinimized', label: 'Start minimized', desc: 'Open in the background. With Tray, no window appears until you open it.', type: 'toggle' },
    { key: 'launchAtLogin', label: 'Launch at login', desc: 'Start Pandora when you sign in to your computer.', type: 'toggle' },
  ] },
  { title: 'Updates', rows: [
    { key: 'autoUpdate', label: 'Update automatically', desc: 'Check GitHub for new versions and install them when you quit.', type: 'toggle' },
    { type: 'update' },
  ] },
  { title: 'Keyboard', rows: [
    { key: 'shortcuts', label: 'Keyboard shortcuts', type: 'toggle' },
    { type: 'keys', keys: [['Space', 'Play / pause'], ['→', 'Skip'], ['↑', 'Thumbs up'], ['↓', 'Thumbs down'],
      ['M', 'Mute'], ['/', 'Search']] },
  ] },
];

const CARD_MIN = { small: '140px', medium: '176px', large: '224px' };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty('--accent', settings.accent);
  root.setProperty('--accent-2', `color-mix(in srgb, ${settings.accent} 72%, white)`);
  root.setProperty('--card-min', CARD_MIN[settings.cardSize]);
  if (!settings.tint) root.setProperty('--tint', hexToRgb(settings.accent));
  store.set('settings', settings);
  window.pandora.setBehavior({
    closeAction: settings.closeAction, startMinimized: settings.startMinimized, launchAtLogin: settings.launchAtLogin,
    autoUpdate: settings.autoUpdate,
  });
}

/* ---------- state ---------- */

const state = {
  stations: [],
  station: null,
  queue: [],
  history: [],
  track: null,
  loading: false,
  liked: new Set(), // track ids thumbed up this session
  feedbackIds: {}, // track id -> Pandora feedback id, so a thumbs up can be undone
  pinned: store.get('pinned', []),
  lastPlayed: store.get('lastPlayed', {}),
  failures: 0,
  tuning: null, // station open on the tune page
  view: 'home',
};

const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  note: '<svg viewBox="0 0 24 24"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h5V3z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
  thumb: '<svg viewBox="0 0 24 24"><path d="M2 10h4v11H2zm6 11V10l4-8c1.7 0 3 1.3 3 3v3h5.2c1.3 0 2.2 1.2 1.9 2.4l-1.8 8A2 2 0 0 1 18.3 21z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M16 3l5 5-3 1-3.5 3.5.5 4.5-1.5 1.5-3.5-3.5L5 21l-1-1 4.5-5.5L5 11l1.5-1.5 4.5.5L14.5 6.5z"/></svg>',
  playSmall: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
};

/* ---------- helpers ---------- */

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}

function svgNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstChild;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function api(promise) {
  const r = await promise;
  if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
  return r.data;
}

const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

/** An <img> that walks through candidate URLs when one fails. */
function art(urls, cls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!list.length) return el('div', { className: `ph ${cls || ''}` }, svgNode(ICON.note));
  const img = el('img', { className: cls || '', loading: 'lazy', alt: '' });
  let i = 0;
  img.onerror = () => {
    if (++i < list.length) img.src = list[i];
    else img.replaceWith(el('div', { className: `ph ${cls || ''}` }, svgNode(ICON.note)));
  };
  img.src = list[0];
  return img;
}

function setArt(img, urls) {
  const list = (urls || []).filter(Boolean);
  let i = 0;
  img.onerror = () => {
    if (++i < list.length) img.src = list[i];
    else img.removeAttribute('src');
  };
  if (list.length) img.src = list[0];
  else img.removeAttribute('src');
}

/** Tints the backdrop with the album's average colour; falls back to the accent if the CDN blocks canvas reads. */
function tintFrom(urls) {
  const root = document.documentElement.style;
  const fallback = () => root.setProperty('--tint', hexToRgb(settings.accent));
  const url = (urls || [])[0];
  if (!settings.tint || !url) return fallback();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      root.setProperty('--tint', `${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`);
    } catch { fallback(); }
  };
  img.onerror = fallback;
  img.src = url;
}

/* ---------- views ---------- */

const VIEWS = ['home', 'search', 'now', 'settings', 'tune'];
let lastView = 'home';

function showView(name) {
  state.view = name;
  if (name !== 'search') lastView = name;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== name);
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('main').scrollTop = 0;
  if (name !== 'search' && $('searchInput').value) clearSearch();
}
document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const stationKind = (s) => (s.isQuickMix ? 'Shuffle' : s.isThumbprint ? 'Thumbprint' : 'Station');
const isPinned = (s) => state.pinned.includes(s.token);

function togglePin(s) {
  state.pinned = isPinned(s) ? state.pinned.filter((t) => t !== s.token) : [...state.pinned, s.token];
  store.set('pinned', state.pinned);
  renderStations();
}

/** Pinned stations first (in pin order), then the rest in the chosen sort order. */
function orderedStations() {
  const rest = state.stations.filter((s) => !isPinned(s));
  if (settings.sort === 'az') rest.sort((a, b) => a.name.localeCompare(b.name));
  else if (settings.sort === 'recent') rest.sort((a, b) => (state.lastPlayed[b.token] || 0) - (state.lastPlayed[a.token] || 0));
  const pinned = state.pinned.map((t) => state.stations.find((s) => s.token === t)).filter(Boolean);
  return { pinned, rest };
}

function renderStations() {
  const { pinned, rest } = orderedStations();

  const list = $('stationList');
  list.replaceChildren();
  const item = (s) => {
    const btn = el('button', { className: 'st' + (state.station?.token === s.token ? ' playing' : '') },
      art(s.artUrl),
      el('div', {}, el('div', { className: 'st-name', textContent: s.name }), el('div', { className: 'st-kind', textContent: stationKind(s) })));
    btn.addEventListener('click', () => playStation(s));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (canTune(s)) openTune(s); });
    const pin = el('button', { className: 'pin' + (isPinned(s) ? ' on' : ''), title: isPinned(s) ? 'Unpin' : 'Pin to top' });
    pin.innerHTML = ICON.pin;
    pin.addEventListener('click', () => togglePin(s));
    return el('div', { className: 'st-wrap' }, btn, pin);
  };
  if (pinned.length) {
    list.append(el('div', { className: 'side-label', textContent: 'Pinned' }), ...pinned.map(item));
    list.append(el('div', { className: 'side-label', textContent: 'All stations' }));
  }
  list.append(...rest.map(item));

  const grid = $('stationGrid');
  grid.replaceChildren();
  for (const s of [...pinned, ...rest]) {
    const card = el('div', { className: 'card' },
      art(s.artUrl),
      el('div', { className: 'card-name', textContent: s.name }),
      el('div', { className: 'card-sub', textContent: stationKind(s) + (isPinned(s) ? ' • Pinned' : '') }));
    const fab = el('div', { className: 'fab' });
    fab.innerHTML = ICON.playSmall;
    const pin = el('button', { className: 'pin-card' + (isPinned(s) ? ' on' : ''), title: isPinned(s) ? 'Unpin' : 'Pin to top' });
    pin.innerHTML = ICON.pin;
    pin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(s); });
    card.append(fab, pin);
    if (!s.isQuickMix && !s.isThumbprint) {
      const del = el('button', { className: 'del', title: 'Delete station' });
      del.innerHTML = ICON.close;
      del.addEventListener('click', (e) => { e.stopPropagation(); removeStation(s); });
      card.append(del);
    }
    card.addEventListener('click', () => playStation(s));
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); if (canTune(s)) openTune(s); });
    grid.append(card);
  }
}

async function loadStations() {
  state.stations = await api(window.pandora.stations());
  // Shuffle/Thumbprint first, like Pandora does, then the rest as returned.
  state.stations.sort((a, b) => (b.isQuickMix - a.isQuickMix) || (b.isThumbprint - a.isThumbprint));
  state.pinned = state.pinned.filter((t) => state.stations.some((s) => s.token === t));
  renderStations();
}

async function removeStation(s) {
  if (settings.confirmDelete && !confirm(`Delete station "${s.name}"?`)) return;
  try {
    await api(window.pandora.deleteStation(s.token));
    if (state.station?.token === s.token) stopPlayback();
    await loadStations();
    toast('Station deleted');
  } catch (e) { toast(e.message); }
}

function trackRow(t, liked, onRemove, removeTitle) {
  const row = el('div', { className: 'row' },
    art(t.artUrls),
    el('div', { className: 't-text' },
      el('div', { className: 't-title', textContent: t.title }),
      el('div', { className: 't-sub', textContent: [t.artist, t.album].filter(Boolean).join(' • ') })));
  if (liked) { const m = el('div', { className: 't-mark', title: 'Thumbs up' }); m.innerHTML = ICON.thumb; row.append(m); }
  if (onRemove) {
    const x = el('button', { className: 't-x', title: removeTitle || 'Remove' });
    x.innerHTML = ICON.close;
    x.addEventListener('click', onRemove);
    row.append(x);
  }
  return row;
}

const isLiked = (t) => !!t && (state.liked.has(t.id) || t.rating === 1);

function renderNow() {
  const t = state.track;
  $('nowEmpty').classList.toggle('hidden', !!t);
  $('nowBody').classList.toggle('hidden', !t);
  if (!t) return;

  const s = state.station;
  $('stationArt').replaceChildren(art(s.artUrl));
  $('stationName').textContent = s.name;
  $('tuneBtn').classList.toggle('hidden', !canTune(s));
  $('stationMeta').textContent = `${stationKind(s)}${isPinned(s) ? ' • Pinned' : ''} • ${state.history.length + 1} songs this session`;

  setArt($('heroArt'), t.artUrls);
  $('heroTitle').textContent = t.title;
  $('heroArtist').textContent = t.artist;
  $('heroAlbum').textContent = t.album;
  const rating = $('heroRating');
  rating.replaceChildren();
  if (isLiked(t)) { rating.append(svgNode(ICON.thumb), 'You thumbed this up'); }

  const up = state.queue.map((q) => trackRow(q));
  $('upNext').replaceChildren(...(up.length ? up : [el('div', { className: 'none', textContent: 'Loading more songs…' })]));
  const hist = state.history.map((h) => trackRow(h, isLiked(h)));
  $('history').replaceChildren(...(hist.length ? hist : [el('div', { className: 'none', textContent: 'Songs you’ve heard will show up here.' })]));
}

function renderBar() {
  const t = state.track;
  $('barTitle').textContent = t ? t.title : 'Nothing playing';
  $('barArtist').textContent = t ? t.artist : '';
  setArt($('barArt'), t?.artUrls);
  $('upBtn').classList.toggle('on', isLiked(t));
  $('upBtn').disabled = $('downBtn').disabled = $('skipBtn').disabled = !t;
  document.title = t ? `${t.title} • ${t.artist}` : 'Pandora';
}

/* ---------- playback ---------- */

const historyKey = (s) => `history:${s.token}`;

function saveHistory() {
  if (state.station) store.set(historyKey(state.station), state.history.slice(0, settings.historyLen));
}

async function fillQueue() {
  if (state.loading || !state.station) return;
  state.loading = true;
  const station = state.station;
  try {
    const tracks = await api(window.pandora.playlist(station.token, settings.quality));
    if (state.station === station) state.queue.push(...tracks);
  } finally {
    state.loading = false;
  }
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  Object.assign(state, { station: null, track: null, queue: [], history: [] });
  pushNowPlaying();
  renderBar();
  renderNow();
  renderStations();
}

async function playStation(s) {
  state.station = s;
  state.queue = [];
  state.history = store.get(historyKey(s), []);
  state.track = null;
  state.failures = 0;
  state.lastPlayed[s.token] = Date.now();
  store.set('lastPlayed', state.lastPlayed);
  store.set('lastStation', s.token);
  renderStations();
  try {
    await fillQueue();
    await next(false);
    showView('now');
  } catch (e) { toast(e.message); }
}

async function next(record = true) {
  if (!state.station) return;
  if (state.queue.length === 0) await fillQueue();
  const t = state.queue.shift();
  if (!t) { toast('Pandora has nothing more to play right now'); return; }
  if (record && state.track) {
    state.history.unshift(state.track);
    state.history = state.history.slice(0, settings.historyLen);
    saveHistory();
  }
  state.track = t;
  audio.src = t.audioUrl;
  audio.play().catch((e) => { if (e.name !== 'AbortError') toast(`Couldn’t start playback: ${e.message}`); });
  renderBar();
  renderNow();
  tintFrom(t.artUrls);
  updateMediaSession();
  notifyTrack(t);
  pushNowPlaying();
  if (state.queue.length < 2) fillQueue().then(renderNow).catch(() => {});
}

function notifyTrack(t) {
  if (!settings.notify || !('Notification' in window)) return;
  try { new Notification(t.title, { body: `${t.artist} • ${t.album}`, icon: t.artUrls[0], silent: true }); } catch {}
}

async function skip() {
  try { await next(); } catch (e) { toast(e.message); }
}

async function rate(positive) {
  const t = state.track;
  if (!t) return;
  try {
    if (positive && state.liked.has(t.id) && state.feedbackIds[t.id]) {
      await api(window.pandora.unrate(state.feedbackIds[t.id]));
      state.liked.delete(t.id);
      delete state.feedbackIds[t.id];
      toast('Thumbs up removed');
      renderBar();
      renderNow();
      return;
    }
    const feedbackId = await api(window.pandora.rate(t.stationToken, t.id, positive));
    if (feedbackId) state.feedbackIds[t.id] = feedbackId;
    if (positive) {
      state.liked.add(t.id);
      toast('Thumbs up. We’ll play more like this.');
      renderBar();
      renderNow();
    } else if (settings.thumbsDownSkips) {
      toast('Got it. Skipping and playing less like this.');
      await skip();
    } else {
      toast('Got it. We’ll play less like this.');
    }
  } catch (e) { toast(e.message); }
}

function togglePlay() {
  if (!state.track) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

$('playBtn').addEventListener('click', togglePlay);
$('skipBtn').addEventListener('click', skip);
$('upBtn').addEventListener('click', () => rate(true));
$('downBtn').addEventListener('click', () => rate(false));
$('replayBtn').addEventListener('click', () => { audio.currentTime = 0; });
$('refreshBtn').addEventListener('click', () => loadStations().catch((e) => toast(e.message)));

audio.addEventListener('play', syncPlayIcon);
audio.addEventListener('pause', syncPlayIcon);
audio.addEventListener('playing', () => { state.failures = 0; });
audio.addEventListener('ended', skip);
audio.addEventListener('error', () => {
  if (!state.track) return;
  const err = audio.error;
  const names = { 1: 'aborted', 2: 'network error', 3: 'could not decode', 4: 'format or URL not supported' };
  console.error('audio error', err, state.track.audioUrl);
  state.failures++;
  if (state.failures >= 3) {
    audio.pause();
    toast(`Playback keeps failing (${names[err?.code] || 'unknown error'}). Stopped.`);
    return;
  }
  toast(`Stream failed (${names[err?.code] || 'unknown'}), trying the next song`);
  skip();
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration;
  $('curTime').textContent = fmt(audio.currentTime);
  $('durTime').textContent = fmt(d);
  $('seekFill').style.width = d ? `${(audio.currentTime / d) * 100}%` : '0';
});

function pushNowPlaying() {
  const t = state.track;
  window.pandora.nowPlaying({ title: t?.title || '', artist: t?.artist || '', playing: !!t && !audio.paused });
}

window.pandora.onCommand((cmd) => {
  if (cmd === 'toggle') togglePlay();
  else if (cmd === 'next') skip();
  else if (cmd === 'like') rate(true);
});

function syncPlayIcon() {
  $('playIcon').innerHTML = audio.paused ? ICON.play : ICON.pause;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  pushNowPlaying();
}

/** A draggable progress/volume bar. */
function bindBar(bar, onValue) {
  const at = (e) => {
    const r = bar.getBoundingClientRect();
    onValue(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    at(e);
    const move = (ev) => at(ev);
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
  });
}
function setVolume(p, save = true) {
  audio.volume = p;
  $('volFill').style.width = `${p * 100}%`;
  if (save) store.set('volume', p);
}
bindBar($('seekBar'), (p) => { if (audio.duration) audio.currentTime = p * audio.duration; });
bindBar($('volBar'), (p) => { audio.muted = false; setVolume(p); });
setVolume(store.get('volume', 0.8), false);
document.querySelector('.vol-icon').addEventListener('click', toggleMute);

function toggleMute() {
  audio.muted = !audio.muted;
  $('volFill').style.width = audio.muted ? '0' : `${audio.volume * 100}%`;
}

// Media keys and the OS "now playing" widget (MPRIS on Linux, SMTC on Windows).
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.track) return;
  const t = state.track;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist, album: t.album,
    artwork: t.artUrls.slice(0, 1).map((src) => ({ src, sizes: '500x500' })),
  });
}
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', skip);
}

window.addEventListener('keydown', (e) => {
  if (!settings.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') clearSearch(); return; }
  const handled = {
    Space: togglePlay, ArrowRight: skip, ArrowUp: () => rate(true), ArrowDown: () => rate(false),
    KeyM: toggleMute, Slash: () => $('searchInput').focus(),
  }[e.code];
  if (handled) { e.preventDefault(); handled(); }
});

/* ---------- search ---------- */

let searchTimer;
function clearSearch() {
  $('searchInput').value = '';
  $('searchClear').classList.add('hidden');
  $('searchResults').replaceChildren();
  if (state.view === 'search') showView(lastView);
}
$('searchClear').addEventListener('click', clearSearch);
$('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const text = e.target.value.trim();
  $('searchClear').classList.toggle('hidden', !e.target.value);
  if (text.length < 2) { if (!text) clearSearch(); return; }
  searchTimer = setTimeout(() => runSearch(text), 300);
});

async function runSearch(text) {
  try {
    const r = await api(window.pandora.search(text));
    if ($('searchInput').value.trim() !== text) return;
    const out = $('searchResults');
    out.replaceChildren();
    const groups = [['Artists', r.artists], ['Songs', r.songs], ['Genres', r.genres]];
    for (const [label, hits] of groups) {
      if (!hits.length) continue;
      out.append(el('h3', { className: 'section-title', textContent: label }));
      for (const h of hits.slice(0, 8)) {
        const row = el('button', { className: 'result' },
          el('div', {}, el('div', { className: 'r-title', textContent: h.title }), el('div', { className: 'r-sub', textContent: h.subtitle })),
          el('span', { className: 'r-add', textContent: 'Create station' }));
        row.addEventListener('click', () => createStation(h));
        out.append(row);
      }
    }
    if (!out.childNodes.length) out.append(el('div', { className: 'empty', textContent: `No matches for “${text}”` }));
    for (const v of VIEWS) $(`view-${v}`).classList.toggle('hidden', v !== 'search');
    state.view = 'search';
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  } catch (e) { toast(e.message); }
}

async function createStation(hit) {
  try {
    await api(window.pandora.createStation(hit.token));
    await loadStations();
    clearSearch();
    const made = state.stations.find((s) => s.name.toLowerCase().includes(hit.title.toLowerCase()));
    toast(`Created ${hit.title}`);
    if (made) playStation(made); else showView('home');
  } catch (e) { toast(e.message); }
}

/* ---------- tune station ---------- */

const canTune = (s) => !!s && !s.isQuickMix && !s.isThumbprint;
let tuneFrom = 'home';
let tuneSearchTimer;

function openTune(s) {
  state.tuning = s;
  if (state.view !== 'tune') tuneFrom = state.view === 'search' ? lastView : state.view;
  showView('tune');
  $('tuneArt').replaceChildren(art(s.artUrl));
  $('tuneName').value = s.name;
  $('tuneSave').classList.add('hidden');
  $('tuneSearch').value = '';
  $('tuneResults').replaceChildren();
  for (const id of ['tuneSeeds', 'tuneUp', 'tuneDown']) $(id).replaceChildren(el('div', { className: 'none', textContent: 'Loading\u2026' }));
  refreshTune();
}

async function refreshTune() {
  const s = state.tuning;
  if (!s) return;
  try {
    const d = await api(window.pandora.stationDetail(s.token));
    if (state.tuning !== s) return;
    const list = (id, rows, empty) => $(id).replaceChildren(...(rows.length ? rows : [el('div', { className: 'none', textContent: empty })]));
    list('tuneSeeds', d.seeds.map((x) => trackRow(
      { title: x.name, artist: x.subtitle, album: '', artUrls: x.artUrl ? [x.artUrl] : [] }, false,
      () => tuneAction(() => window.pandora.removeSeed(x.id), `Removed ${x.name}`), 'Remove from station')), 'No seeds yet.');
    const thumbRows = (items, label) => items.map((f) => trackRow(f, false,
      () => tuneAction(() => window.pandora.unrate(f.id), 'Rating removed'), label));
    list('tuneUp', thumbRows(d.up, 'Remove thumbs up'), 'Songs you thumb up will show here.');
    list('tuneDown', thumbRows(d.down, 'Remove thumbs down'), 'Songs you thumb down will show here.');
  } catch (e) { toast(e.message); }
}

/** Runs a change, refreshes the tune page, and refills the queue if the station is playing so it takes effect. */
async function tuneAction(fn, message) {
  try {
    await api(fn());
    toast(message);
    await refreshTune();
    if (state.station?.token === state.tuning?.token) { state.queue = []; fillQueue().then(renderNow).catch(() => {}); }
  } catch (e) { toast(e.message); }
}

$('tuneBtn').addEventListener('click', () => openTune(state.station));
$('tuneBack').addEventListener('click', () => showView(tuneFrom));

$('tuneName').addEventListener('input', () => {
  $('tuneSave').classList.toggle('hidden', $('tuneName').value.trim() === state.tuning.name || !$('tuneName').value.trim());
});
$('tuneName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('tuneSave').click(); });
$('tuneSave').addEventListener('click', async () => {
  const s = state.tuning;
  const name = $('tuneName').value.trim();
  try {
    await api(window.pandora.renameStation(s.token, name));
    s.name = name;
    if (state.station?.token === s.token) state.station.name = name;
    $('tuneSave').classList.add('hidden');
    renderStations();
    renderNow();
    toast('Station renamed');
  } catch (e) { toast(e.message); }
});

$('tuneSearch').addEventListener('input', (e) => {
  clearTimeout(tuneSearchTimer);
  const text = e.target.value.trim();
  if (text.length < 2) { $('tuneResults').replaceChildren(); return; }
  tuneSearchTimer = setTimeout(async () => {
    try {
      const r = await api(window.pandora.search(text));
      if ($('tuneSearch').value.trim() !== text) return;
      const hits = [...r.artists.slice(0, 4), ...r.songs.slice(0, 4), ...r.genres.slice(0, 2)];
      $('tuneResults').replaceChildren(...(hits.length ? hits.map((h) => {
        const row = el('button', { className: 'result' },
          el('div', {}, el('div', { className: 'r-title', textContent: h.title }), el('div', { className: 'r-sub', textContent: h.subtitle })),
          el('span', { className: 'r-add', textContent: 'Add to station' }));
        row.addEventListener('click', async () => {
          $('tuneSearch').value = '';
          $('tuneResults').replaceChildren();
          await tuneAction(() => window.pandora.addSeed(state.tuning.token, h.token), `Added ${h.title}`);
        });
        return row;
      }) : [el('div', { className: 'none', textContent: 'No matches' })]));
    } catch (err) { toast(err.message); }
  }, 300);
});

/* ---------- settings page ---------- */

function renderSettings() {
  const body = $('settingsBody');
  body.replaceChildren();
  const rerender = () => { applySettings(); renderSettings(); renderStations(); tintFrom(state.track?.artUrls); };

  for (const group of SCHEMA) {
    const card = el('div', { className: 'set-card' });
    for (const row of group.rows) {
      if (row.type === 'update') {
        card.append(updateRow());
        continue;
      }
      if (row.type === 'keys') {
        const keys = el('div', { className: 'keys' });
        for (const [k, d] of row.keys) keys.append(el('kbd', { textContent: k }), el('span', { textContent: d }));
        card.append(keys);
        continue;
      }
      const label = el('div', {}, el('div', { className: 'set-label', textContent: row.label }));
      if (row.desc) label.append(el('div', { className: 'set-desc', textContent: row.desc }));
      let control;
      if (row.type === 'toggle') {
        control = el('button', { className: 'switch' + (settings[row.key] ? ' on' : ''), role: 'switch' });
        control.addEventListener('click', () => { settings[row.key] = !settings[row.key]; rerender(); });
      } else if (row.type === 'seg') {
        control = el('div', { className: 'seg' });
        for (const [val, text] of row.options) {
          const b = el('button', { className: settings[row.key] === val ? 'on' : '', textContent: text });
          b.addEventListener('click', () => { settings[row.key] = val; rerender(); });
          control.append(b);
        }
      } else {
        control = el('div', { className: 'swatches' });
        for (const c of row.options) {
          const b = el('button', { className: 'swatch' + (settings[row.key] === c ? ' on' : ''), title: c });
          b.style.background = c;
          b.addEventListener('click', () => { settings[row.key] = c; rerender(); if (!settings.tint) tintFrom(); });
          control.append(b);
        }
      }
      card.append(el('div', { className: 'set-row' }, label, control));
    }
    body.append(el('div', { className: 'set-group' }, el('h3', { textContent: group.title }), card));
  }

  const action = (label, desc, btnText, fn, danger) => {
    const b = el('button', { className: 'set-btn' + (danger ? ' danger' : ''), textContent: btnText });
    b.addEventListener('click', fn);
    return el('div', { className: 'set-row' },
      el('div', {}, el('div', { className: 'set-label', textContent: label }), el('div', { className: 'set-desc', textContent: desc })), b);
  };
  body.append(el('div', { className: 'set-group' }, el('h3', { textContent: 'Library & account' }),
    el('div', { className: 'set-card' },
      action('Unpin all stations', `${state.pinned.length} pinned`, 'Unpin all', () => {
        state.pinned = []; store.set('pinned', []); renderStations(); renderSettings(); toast('Unpinned');
      }),
      action('Clear listening history', 'Removes the saved history for every station.', 'Clear', () => {
        for (const s of state.stations) store.set(historyKey(s), []);
        state.history = []; renderNow(); toast('History cleared');
      }),
      action('Reset settings', 'Restore every option above to its default.', 'Reset', () => {
        Object.assign(settings, DEFAULTS); applySettings(); renderSettings(); renderStations(); tintFrom(state.track?.artUrls);
      }),
      action('Log out', 'Forget your saved login on this computer.', 'Log out', logout, true))));
}

let updateInfo = { state: 'idle' };

function updateText(u) {
  switch (u.state) {
    case 'checking': return 'Checking for updates\u2026';
    case 'downloading': return `Downloading ${u.latest || 'update'}${u.percent ? ` (${u.percent}%)` : ''}\u2026`;
    case 'ready': return `Version ${u.latest} is ready to install.`;
    case 'current': return 'You\u2019re on the latest version.';
    case 'error': return `Update check failed: ${u.message || 'unknown error'}`;
    case 'dev': return 'Updates only work in the installed app.';
    default: return 'Not checked yet.';
  }
}

function updateRow() {
  const label = el('div', {}, el('div', { className: 'set-label', textContent: `Pandora ${updateInfo.version || ''}`.trim() }),
    el('div', { className: 'set-desc', id: 'updateText', textContent: updateText(updateInfo) }));
  const ready = updateInfo.state === 'ready';
  const b = el('button', { className: 'set-btn', textContent: ready ? 'Restart & install' : 'Check now', disabled: ['checking', 'downloading'].includes(updateInfo.state) });
  b.addEventListener('click', () => (ready ? window.pandora.installUpdate() : window.pandora.checkUpdates()));
  return el('div', { className: 'set-row' }, label, b);
}

window.pandora.onUpdate((u) => {
  const was = updateInfo.state;
  updateInfo = u;
  if (state.view === 'settings') renderSettings();
  if (u.state === 'ready' && was !== 'ready') toast(`Update ${u.latest} downloaded. Restart from Settings to install.`);
});
window.pandora.updateStatus().then((u) => { updateInfo = u; if (state.view === 'settings') renderSettings(); });

async function logout() {
  stopPlayback();
  await window.pandora.logout();
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
}

/* ---------- auth ---------- */

async function enterApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('greeting').textContent = greeting();
  await loadStations();
  renderBar();
  renderNow();
  renderSettings();
  const last = settings.resume && state.stations.find((s) => s.token === store.get('lastStation', null));
  if (last) playStation(last);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('loginError').textContent = '';
  try {
    await api(window.pandora.login($('email').value.trim(), $('password').value));
    $('password').value = '';
    await enterApp();
  } catch (err) {
    $('loginError').textContent = err.message || 'Login failed';
  } finally { btn.disabled = false; }
});

(async () => {
  applySettings();
  syncPlayIcon();
  const r = await window.pandora.savedLogin();
  if (r.ok && r.data) return enterApp();
  $('login').classList.remove('hidden');
})();
