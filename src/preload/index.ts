import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserAPI } from '../shared/types';
const api: BrowserAPI = {
  onFocusAddress: (callback) => {
    ipcRenderer.on('browser:focus-address', () => callback());
  },
  command: (command) => ipcRenderer.invoke('browser:command', command),
  onTitle: (callback) => {
    ipcRenderer.on('browser:title', (_event, title) => callback(title));
  },
  onState: (callback) => {
    ipcRenderer.on('browser:state', (_event, state) => callback(state));
  },
};
contextBridge.exposeInMainWorld('browser', api);
