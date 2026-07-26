const { contextBridge, ipcRenderer } = require('electron')

function sendPoint(channel, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  ipcRenderer.send(channel, { x, y })
}

contextBridge.exposeInMainWorld('qwenAudioAgentDesktop', {
  dragStart: (x, y) => sendPoint('qwen-audio-agent:drag-start', x, y),
  dragMove: (x, y) => sendPoint('qwen-audio-agent:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('qwen-audio-agent:drag-end'),
  openSettings: () => ipcRenderer.send('qwen-audio-agent:open-settings'),
  loadSettings: () => ipcRenderer.invoke('qwen-audio-agent:settings-load'),
  saveSettings: settings => ipcRenderer.invoke(
    'qwen-audio-agent:settings-save',
    settings,
  ),
  quit: () => ipcRenderer.send('qwen-audio-agent:quit'),
})
