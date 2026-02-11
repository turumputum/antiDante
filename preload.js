const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkGstreamer: () => ipcRenderer.invoke('check-gstreamer'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  checkMulticast: (host, port) => ipcRenderer.invoke('check-multicast', host, port),
  startStream: (deviceId, cfg) => ipcRenderer.invoke('start-stream', deviceId, cfg),
  stopStream: (deviceId) => ipcRenderer.invoke('stop-stream', deviceId),
  getRunningStreams: () => ipcRenderer.invoke('get-running-streams'),
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),

  onStreamStatus: (cb) => ipcRenderer.on('stream-status', (_, data) => cb(data)),
  onStreamLog: (cb) => ipcRenderer.on('stream-log', (_, data) => cb(data)),
  onNetStats: (cb) => ipcRenderer.on('net-stats', (_, data) => cb(data)),
});
