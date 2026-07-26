import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
} from 'electron'
import {
  chmodSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadRuntimeEnvironment } from '../../shared/runtime-environment.mjs'
import {
  desktopOrbUrl,
  isSafeExternalUrl,
  isSameOrigin,
  validateAppUrl,
} from './security.mjs'
import {
  readGatewayHealth,
} from '../../shared/gateway-client.mjs'
import {
  parseSettings,
  updateSettingsContent,
} from './settings-config.mjs'
import {
  startDesktopRendererServer,
} from './renderer-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const runtimeEnvironment = loadRuntimeEnvironment({
  root,
  prepareBackendRuntime: false,
  generateSecret: false,
})
const fallbackPage = resolve(here, 'orb-unavailable.html')
const fallbackUrl = pathToFileURL(fallbackPage).href
const settingsPage = resolve(here, 'settings.html')
const webRoot = resolve(root, 'web/dist')
let appOrigin = validateAppUrl(
  process.env.QWEN_AUDIO_AGENT_URL || 'http://127.0.0.1:3101',
)
const preloadPath = resolve(here, 'preload.cjs')

let mainWindow = null
let settingsWindow = null
let rendererServer = null
let dragState = null
let reconnectTimer = null
async function runtimeStatus(target = appOrigin) {
  const health = await readGatewayHealth(target)
  return {
    gatewayConnected: Boolean(health),
    realtimeProvider: health?.realtimeProvider || null,
    realtimeModel: health?.realtimeModel || null,
    voiceConfigured: health?.voiceConfigured === true,
    backend: health?.backend
      ? {
          protocol: health.backend.kind || health.backend.protocol || null,
          label: health.backend.label || null,
          baseUrl: health.backend.baseUrl || null,
          model: health.backend.model || null,
          connected: health.backend.ok === true,
        }
      : null,
  }
}

function isDesktopRendererUrl(value) {
  return Boolean(
    rendererServer
    && isSameOrigin(value, rendererServer.origin),
  )
}

function configurePermissions(window) {
  const electronSession = window.webContents.session
  electronSession.setPermissionCheckHandler((
    _webContents,
    permission,
    requestingOrigin,
    details,
  ) => {
    const origin = details?.securityOrigin || requestingOrigin
    return permission === 'media' && isDesktopRendererUrl(origin)
  })
  electronSession.setPermissionRequestHandler((
    webContents,
    permission,
    callback,
    details,
  ) => {
    const source = details?.requestingUrl
      || details?.securityOrigin
      || webContents.getURL()
    const mediaTypes = details?.mediaTypes || []
    const audioOnly = !mediaTypes.length
      || mediaTypes.every(type => type === 'audio')
    callback(
      permission === 'media'
      && audioOnly
      && isDesktopRendererUrl(source),
    )
  })
}

async function showUnavailable(window) {
  if (window.isDestroyed()) return
  await window.loadFile(fallbackPage, {
    query: { target: appOrigin },
  })
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    if (mainWindow === window && !window.isDestroyed()) {
      void loadQwenAudioAgent(window)
    }
  }, 3000)
}

async function loadQwenAudioAgent(window) {
  try {
    if (!rendererServer) throw new Error('desktop renderer is unavailable')
    const settings = parseSettings(
      readFileSync(runtimeEnvironment.configPath, 'utf8'),
      process.env,
    )
    await window.loadURL(desktopOrbUrl(rendererServer.baseUrl, {
      orbStyle: settings.orbStyle,
    }))
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  } catch {
    await showUnavailable(window)
  }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 172
  const height = 170
  const window = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'qwen-audio-agent',
    autoHideMenuBar: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })

  window.setAlwaysOnTop(true, 'floating')
  configurePermissions(window)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isDesktopRendererUrl(url) || url.startsWith(fallbackUrl)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  window.once('ready-to-show', () => window.show())
  window.on('blur', () => {
    dragState = null
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
      mainWindow = null
    }
  })

  loadQwenAudioAgent(window)
  return window
}

function createSettingsWindow() {
  const window = new BrowserWindow({
    width: 540,
    height: 610,
    minWidth: 460,
    minHeight: 540,
    title: '设置',
    backgroundColor: '#f5f6f7',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
  })
  void window.loadFile(settingsPage)
  return window
}

function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = createSettingsWindow()
}

function validPoint(point) {
  return (
    Number.isFinite(point?.x)
    && Number.isFinite(point?.y)
  )
}

ipcMain.on('qwen-audio-agent:drag-start', (event, point) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !validPoint(point)) return
  const [windowX, windowY] = mainWindow.getPosition()
  dragState = {
    pointerX: point.x,
    pointerY: point.y,
    windowX,
    windowY,
  }
})

ipcMain.on('qwen-audio-agent:drag-move', (event, point) => {
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || !dragState
    || !validPoint(point)
  ) return
  mainWindow.setPosition(
    Math.round(dragState.windowX + point.x - dragState.pointerX),
    Math.round(dragState.windowY + point.y - dragState.pointerY),
  )
})

ipcMain.on('qwen-audio-agent:drag-end', event => {
  if (mainWindow && event.sender === mainWindow.webContents) dragState = null
})

ipcMain.on('qwen-audio-agent:open-settings', event => {
  if (mainWindow && event.sender === mainWindow.webContents) showSettings()
})

ipcMain.handle('qwen-audio-agent:settings-load', async event => {
  if (!settingsWindow || event.sender !== settingsWindow.webContents) {
    throw new Error('无权读取设置')
  }
  const settings = parseSettings(
    readFileSync(runtimeEnvironment.configPath, 'utf8'),
    process.env,
  )
  return {
    settings,
    runtime: await runtimeStatus(),
    restartRequired: false,
  }
})

ipcMain.handle('qwen-audio-agent:settings-save', async (event, settings) => {
  if (!settingsWindow || event.sender !== settingsWindow.webContents) {
    throw new Error('无权保存设置')
  }
  const current = readFileSync(runtimeEnvironment.configPath, 'utf8')
  const previous = parseSettings(current, process.env)
  const content = updateSettingsContent(current, settings)
  const normalized = parseSettings(content)
  const nextOrigin = validateAppUrl(normalized.gatewayUrl)
  const nextRuntime = await runtimeStatus(nextOrigin)
  if (!nextRuntime.gatewayConnected) {
    throw new Error(`无法连接 Gateway：${nextOrigin}`)
  }
  writeFileSync(runtimeEnvironment.configPath, content, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(runtimeEnvironment.configPath, 0o600)
  const gatewayChanged = nextOrigin !== appOrigin
  const coreChanged = [
    'apiKey',
    'realtimeProvider',
    'protocol',
    'opencodeBaseUrl',
    'openclawBaseUrl',
    'backendModel',
    'realtimeModel',
    'realtimeVoice',
  ].some(key => previous[key] !== normalized[key])
  const orbStyleChanged = previous.orbStyle !== normalized.orbStyle
  appOrigin = nextOrigin
  process.env.QWEN_AUDIO_AGENT_URL = nextOrigin
  process.env.QWEN_AUDIO_ORB_STYLE = normalized.orbStyle
  if ((gatewayChanged || orbStyleChanged) && mainWindow && !mainWindow.isDestroyed()) {
    void loadQwenAudioAgent(mainWindow)
  }
  return {
    settings: normalized,
    restarted: false,
    restartRequired: coreChanged,
    runtime: nextRuntime,
  }
})

ipcMain.on('qwen-audio-agent:quit', event => {
  if (mainWindow && event.sender === mainWindow.webContents) app.quit()
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    rendererServer = await startDesktopRendererServer({
      webRoot,
      target: () => appOrigin,
    })
    if (process.platform === 'darwin' && process.defaultApp) {
      app.setActivationPolicy('accessory')
      app.dock?.hide()
    }
    mainWindow = createWindow()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) {
        mainWindow = createWindow()
      }
    })
  }).catch(error => {
    const message = error?.stack || error?.message || String(error)
    console.error('Failed to start Qwen Audio Agent:', message)
    dialog.showErrorBox('Qwen Audio Agent 无法启动', message)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void rendererServer?.close()
    rendererServer = null
  })
}
