import { contextBridge, ipcRenderer } from 'electron'

const handler = {
  send(channel, value) {
    ipcRenderer.send(channel, value)
  },
  invoke(channel, value) {
    return ipcRenderer.invoke(channel, value)
  },
  on(channel, callback) {
    const subscription = (_event, ...args) => callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
  off(channel, callback) {
    ipcRenderer.removeListener(channel, callback)
  },
  removeAll(channel) {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('ipc', handler)
