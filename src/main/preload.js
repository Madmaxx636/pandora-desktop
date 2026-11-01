const { contextBridge, ipcRenderer, webFrame } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pandora', {
  savedLogin: call('auth:saved'),
  login: call('auth:login'),
  logout: call('auth:logout'),
  stations: call('stations:list'),
  createStation: call('stations:create'),
  deleteStation: call('stations:delete'),
  playlist: call('playlist:get'),
  search: call('music:search'),
  rate: call('track:rate'),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  setBehavior: (b) => ipcRenderer.send('app:behavior', b),
  nowPlaying: (info) => ipcRenderer.send('app:nowPlaying', info),
  checkUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdate: (cb) => ipcRenderer.on('app:update', (_e, s) => cb(s)),
  onCommand: (cb) => ipcRenderer.on('app:command', (_e, cmd) => cb(cmd)),
  unrate: call('track:unrate'),
  stationDetail: call('station:detail'),
  addSeed: call('station:addSeed'),
  removeSeed: call('station:removeSeed'),
  renameStation: call('station:rename'),
});
