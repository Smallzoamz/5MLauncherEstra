const { contextBridge, ipcRenderer } = require('electron');

// Expose only fixed window commands; never expose ipcRenderer or a generic channel.
contextBridge.exposeInMainWorld('estraWindow', Object.freeze({
  minimize: () => ipcRenderer.send('estra:window-minimize'),
  hideToTray: () => ipcRenderer.send('estra:window-hide'),
  toggleMaximize: () => ipcRenderer.send('estra:window-maximize'),
  close: () => ipcRenderer.send('estra:window-close'),
  setLatestCity: state => ipcRenderer.send('estra:latest-city', { name: state?.name, enabled: state?.enabled }),
  onLaunchLatest: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('estra:launch-latest', listener);
    return () => ipcRenderer.removeListener('estra:launch-latest', listener);
  },
  onGameStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('estra:game-status', listener);
    return () => ipcRenderer.removeListener('estra:game-status', listener);
  }
}));
