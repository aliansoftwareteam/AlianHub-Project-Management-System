import { app, ipcMain, Menu, Tray, BrowserWindow, shell, dialog, desktopCapturer, systemPreferences, powerMonitor, Notification,screen  } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers'
const path = require('node:path')
const fs = require('fs')
const isProd = process.env.NODE_ENV === 'production'
// Prod: assets are packaged into app/ (see electron-builder.yml). Dev: read from source resources/.
const assetPath = (name) => isProd ? path.join(__dirname, name) : path.join(__dirname, '..', 'resources', name)
const iconPath = assetPath('logo.png')
const trayIconPath = assetPath('traylogo.png')
// Prod: next export copies public/ into app/. Dev: read straight from renderer/public.
const notificationHtmlPath = isProd ? path.join(__dirname, 'notification.html') : path.join(__dirname, '..', 'renderer', 'public', 'notification.html')
const notificationTemplateHtmlPath = isProd ? path.join(__dirname, 'notification-template.html') : path.join(__dirname, '..', 'renderer', 'public', 'notification-template.html')
// AHE-3835 — the persistent "tracker stopped" alert card (distinct from the
// routine white notification-template.html toast).
const notificationAlertHtmlPath = isProd ? path.join(__dirname, 'notification-alert.html') : path.join(__dirname, '..', 'renderer', 'public', 'notification-alert.html')
let notification = null;
let screenshotNotificationWindow = null;
// AHE-3835 — persistent stop-alert state.
let stoppedAlertWindow = null;   // the single live alert window (one at a time)
let lastTaskCtx = null;          // { taskId, taskName, comment } — reported by the renderer on start
let pendingStoppedAlert = null;  // a lock/sleep stop deferred until the user returns

// Store permissions state in a config file
const permissionsConfigPath = path.join(app.getPath('userData'), 'permissions.json')

// Default permissions state
let permissionsState = {
  accessibility: false,
  screen: false
}

// Load permissions state from file
function loadPermissionsState() {
  try {
    if (fs.existsSync(permissionsConfigPath)) {
      const data = fs.readFileSync(permissionsConfigPath, 'utf8')
      permissionsState = JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading permissions state:', error)
  }
}

// Save permissions state to file
function savePermissionsState() {
  try {
    fs.writeFileSync(permissionsConfigPath, JSON.stringify(permissionsState), 'utf8')
  } catch (error) {
    console.error('Error saving permissions state:', error)
  }
}

// TIME-05: idle-time detection config (threshold in seconds; 0 disables).
const idleConfigPath = path.join(app.getPath('userData'), 'idle-config.json')
let idleThresholdSec = 300
let idleHandled = false
function loadIdleConfig() {
  try {
    if (fs.existsSync(idleConfigPath)) {
      const data = JSON.parse(fs.readFileSync(idleConfigPath, 'utf8'))
      if (data && Number.isFinite(data.idleThresholdSec) && data.idleThresholdSec >= 0) {
        idleThresholdSec = data.idleThresholdSec
      }
    }
  } catch (error) {
    console.error('Error loading idle config:', error)
  }
}
function saveIdleConfig() {
  try {
    fs.writeFileSync(idleConfigPath, JSON.stringify({ idleThresholdSec }), 'utf8')
  } catch (error) {
    console.error('Error saving idle config:', error)
  }
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('myapp', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('myapp')
}

let mainWindow
let tray = null

// Read the `type` query param from a myapp:// deep link, order-independently.
const deepLinkType = (u) => {
  try {
    return new URLSearchParams((u || '').split('?').slice(1).join('?')).get('type')
  } catch (e) {
    return null
  }
}

// Cold-launch buffering: a trackerStart deep link can arrive before the renderer
// has loaded projects. Buffer it and deliver once the renderer signals ready.
let pendingTrackerDeepLink = null
let rendererReadyForDeepLink = false

const deliverTrackerDeepLink = (url) => {
  if (!url) return
  if (rendererReadyForDeepLink && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('trackerInfoFill', { url })
  } else {
    pendingTrackerDeepLink = url
  }
}

ipcMain.on('deeplink:renderer-ready', () => {
  rendererReadyForDeepLink = true
  if (pendingTrackerDeepLink && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('trackerInfoFill', { url: pendingTrackerDeepLink })
    pendingTrackerDeepLink = null
  }
})
let isTracking = null
let activityInterval = null

// A second counts as "active" when the OS reports input within this many seconds.
const ACTIVE_IDLE_THRESHOLD_SEC = 2

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

process.on("uncaughtException", (error) => {
  console.log("Uncaught Exception:", error)
})

// Check and request permissions based on platform
function checkAndRequestPermissions() {
  if (process.platform === 'darwin') {
    // macOS permissions handling
    checkMacOSPermissions()
  } else if (process.platform === 'linux') {
    // Linux/Ubuntu permissions handling
    checkLinuxPermissions()
  }
}

// macOS permissions handling
function checkMacOSPermissions() {
  // Check and request accessibility permissions if needed
  if (!permissionsState.accessibility) {
    const accessibilityEnabled = systemPreferences.isTrustedAccessibilityClient(false)
    if (!accessibilityEnabled) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Accessibility Permission Required',
        message: 'This app needs accessibility permissions to track keyboard input.',
        buttons: ['Open System Preferences', 'Later'],
        defaultId: 0
      }).then(result => {
        if (result.response === 0) {
          systemPreferences.isTrustedAccessibilityClient(true)
          // We'll check again on next start or when feature is used
        }
      })
    } else {
      permissionsState.accessibility = true
      savePermissionsState()
    }
  }

  // Check and request screen recording permissions
  if (!permissionsState.screen) {
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      // In macOS, we can't directly request screen capture permission,
      // but we can guide the user to enable it
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Screen Recording Permission Required',
        message: 'This app needs screen recording permission for the screenshot feature.\n\nPlease go to System Preferences > Security & Privacy > Privacy > Screen Recording and enable permission for this app.',
        buttons: ['Open System Preferences', 'Later'],
        defaultId: 0
      }).then(result => {
        if (result.response === 0) {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        }
      })
    } else {
      permissionsState.screen = true
      savePermissionsState()
    }
  }
}

// Linux/Ubuntu permissions handling
function checkLinuxPermissions() {
  // For Ubuntu/Linux we mostly rely on requesting at startup
  // and guiding users through one-time setup
  if (!permissionsState.accessibility || !permissionsState.screen) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Permissions Required',
      message: 'This app requires special permissions for keyboard tracking and screen capture. You may need to:\n\n1. For keyboard tracking: Enable Input Monitoring\n2. For screenshots: Allow screen recording\n\nThese settings vary by Linux distribution.',
      buttons: ['OK, I understand'],
      defaultId: 0
    }).then(() => {
      // Mark as informed
      permissionsState.accessibility = true
      permissionsState.screen = true
      savePermissionsState()
    })
  }
}

// Create a function to check if permissions are granted when features are used
function verifyAccessibilityPermission() {
  if (process.platform === 'darwin') {
    const accessibilityEnabled = systemPreferences.isTrustedAccessibilityClient(false)
    if (!accessibilityEnabled) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Permission Required',
        message: 'Keyboard tracking requires accessibility permission.',
        buttons: ['Open System Preferences', 'Cancel'],
        defaultId: 0
      }).then(result => {
        if (result.response === 0) {
          systemPreferences.isTrustedAccessibilityClient(true)
        }
      })
      return false
    }
    // Update permission state if it's now granted
    if (!permissionsState.accessibility) {
      permissionsState.accessibility = true
      savePermissionsState()
    }
    return true
  }
  return true // On other platforms, assume granted after initial setup
}

function verifyScreenCapturePermission() {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status !== 'granted') {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Permission Required',
        message: 'Screen capture requires permission. Please enable it in System Preferences > Security & Privacy > Privacy > Screen Recording.',
        buttons: ['Open System Preferences', 'Cancel'],
        defaultId: 0
      }).then(result => {
        if (result.response === 0) {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        }
      })
      return false
    }
    // Update permission state if it's now granted
    if (!permissionsState.screen) {
      permissionsState.screen = true
      savePermissionsState()
    }
    return true
  }
  return true // On other platforms, assume granted after initial setup
}

;(async () => {
  await app.whenReady()

  // Windows shows the AppUserModelID as the notification header ("attribution").
  // Set a friendly one so toasts read "AlianHub Time Tracker" instead of the
  // default "electron.app.alianhubtimetracker".
  if (process.platform === 'win32') app.setAppUserModelId('AlianHub Time Tracker')
  
  // Load saved permissions state
  loadPermissionsState()
  loadIdleConfig()
  
  if (tray) { return }
  if (process.platform == 'darwin') {
    app.dock.setIcon(iconPath)
  }
  
  tray = new Tray(trayIconPath)
  const template = [
    {
      label: 'Time Tracker',
      icon: trayIconPath,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Show App', click: () => {
        mainWindow.show()
      },
    },
    {
      label: 'Quit', click: () => {
        mainWindow.webContents.send('stop-tracker', true);
        mainWindow.close()
      },
    },
  ]
  const contextMenu = Menu.buildFromTemplate(template)
  tray.setContextMenu(contextMenu)
  tray.setToolTip('Alianhub Time Tracker')

  mainWindow = createWindow('main', {
    title: "Time Tracker",
    width: 347,
    height: 628,
    icon: iconPath,
    resizable: false,
    movable: true,
    autoHideMenuBar: true,
    maximizable: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  
  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
  
  // Check permissions after window is created
  checkAndRequestPermissions()
  
  let deepLinkURL = process.argv.find(item => item.startsWith("myapp://")) || null
  if (deepLinkURL) {
    let type = deepLinkType(deepLinkURL);
    if (type && type == 'trackerStart') {
      deliverTrackerDeepLink(deepLinkURL)
    } else {
      mainWindow.webContents.send('deeplinkUrl', { url: deepLinkURL })
    }
  }
})()

app.on('open-url', (event, deepLinkURL) => {
  event.preventDefault();
  let type = deepLinkType(deepLinkURL);
  if (type && type == 'trackerStart') {
    deliverTrackerDeepLink(deepLinkURL)
  } else {
    mainWindow.webContents.send('deeplinkUrl', { url: deepLinkURL })
  }
});

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    let url = commandLine.find(item => item.startsWith("myapp://")) || commandLine.pop()
    if (url) {
      let type = deepLinkType(url);
      if (type && type == 'trackerStart') {
        deliverTrackerDeepLink(url)
      } else {
        mainWindow.webContents.send('deeplinkUrl', { url: url })
      }
    }
  })
}

// Activity sampling WITHOUT a global input hook (a hook is what antivirus flags
// as a keylogger — the bug that quarantined the old node-global-key-listener
// binary). Each second we read two built-in, hook-free signals:
//   - powerMonitor.getSystemIdleTime(): seconds since the last input (kbd OR mouse)
//   - screen.getCursorScreenPoint(): the current mouse cursor position
// If the cursor moved this second it's MOUSE activity; if there was input but the
// cursor did not move (typing) it's KEYBOARD activity. Limitation: a mouse click
// that doesn't move the cursor is counted as keyboard — acceptable, since exact
// click counts would require the AV-flagged global hook. No native binary, no
// accessibility permission.
let lastCursorPoint = null
const startActivitySampling = () => {
  if (activityInterval) return
  lastCursorPoint = null
  activityInterval = setInterval(() => {
    if (!isTracking || !mainWindow || mainWindow.isDestroyed()) return
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const cursor = screen.getCursorScreenPoint()
    const mouseMoved = lastCursorPoint !== null && (cursor.x !== lastCursorPoint.x || cursor.y !== lastCursorPoint.y)
    lastCursorPoint = cursor
    // TIME-05: pause tracking once idle for the configured threshold (0 disables).
    if (mouseMoved || idleSeconds <= ACTIVE_IDLE_THRESHOLD_SEC) {
      idleHandled = false
    } else if (idleThresholdSec > 0 && idleSeconds >= idleThresholdSec && !idleHandled) {
      idleHandled = true
      // Notify only — do NOT auto-stop the tracker. Tracking keeps running; this
      // is just a heads-up that no input was detected for the threshold.
      mainWindow.webContents.send('idle:detected', { idleSeconds, thresholdSeconds: idleThresholdSec })
      try {
        showNotification({ title: 'No activity detected', subtitle: `You've been idle for ${Math.round(idleThresholdSec / 60)} min.` })
      } catch (e) { /* notifications are best-effort */ }
    }
    if (mouseMoved) {
      mainWindow.webContents.send('activity:tick', { type: 'mouse' })
    } else if (idleSeconds <= ACTIVE_IDLE_THRESHOLD_SEC) {
      mainWindow.webContents.send('activity:tick', { type: 'keyboard' })
    }
  }, 1000)
}

// Stop the activity sampler.
const stopActivitySampling = () => {
  if (activityInterval) {
    clearInterval(activityInterval)
    activityInterval = null
  }
  lastCursorPoint = null
}

// Add IPC listeners for start and stop events
ipcMain.on('start-listen-event', () => {
  isTracking = true
  idleHandled = false
  startActivitySampling()
  mainWindow.webContents.send('tracking:status', { active: true })
})

ipcMain.on('stop-listen-event', () => {
  isTracking = false
  stopActivitySampling()
  mainWindow.webContents.send('tracking:status', { active: false })
})

// AHE-3831 / AHE-3835 — the renderer hit an estimate gate. A live auto-stop
// (estimate reached mid-session) surfaces the NEW persistent "tracker stopped"
// alert; the other two reasons are START-blocks (not stops), so they keep the
// routine informational white toast.
ipcMain.on('estimate:limit', (event, data) => {
  const d = data || {}
  if (d.reason === 'autostopped') {
    try {
      showTrackerStoppedAlert({ reason: 'estimate', taskName: d.taskName || (lastTaskCtx && lastTaskCtx.taskName) || '' })
    } catch (e) { /* best-effort */ }
    return
  }
  const name = d.taskName ? `"${d.taskName}"` : 'This task'
  let title = 'Tracker reached task estimate hours limit'
  let subtitle
  if (d.reason === 'no-estimate') {
    title = 'Add estimated hours to start the tracker'
    subtitle = `${name} has no estimated hours set.`
  } else {
    subtitle = `${name} has already reached its estimated hours.`
  }
  try {
    showNotification({ title, subtitle })
  } catch (e) { /* notifications are best-effort */ }
})

// AHE-3835 — the renderer reports the actively-tracked task so the stop alert can
// name it (lock/sleep) and Resume knows what to restart. Read-only: this never
// changes tracking behaviour.
ipcMain.on('tracker:context', (event, data) => {
  const d = data || {}
  if (d.taskId) lastTaskCtx = { taskId: String(d.taskId), taskName: d.taskName || '', comment: d.comment || '' }
})

// AHE-3835 — actions from the stop alert (notification-alert.html).
ipcMain.on('alert:dismiss', () => { closeStoppedAlert() })
ipcMain.on('alert:resume', () => {
  closeStoppedAlert()
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  if (!lastTaskCtx || !lastTaskCtx.taskId) return
  // Reuse the proven deep-link start path — its assignee + estimate checks apply,
  // so an estimate-exceeded task correctly refuses and explains why.
  const params = new URLSearchParams({ type: 'trackerStart', taskId: lastTaskCtx.taskId })
  if (lastTaskCtx.comment) params.set('comment', lastTaskCtx.comment)
  deliverTrackerDeepLink(`myapp://open?${params.toString()}`)
})

// TIME-05: configurable idle threshold (value in minutes; 0 disables auto-pause).
ipcMain.on('idle:set-threshold', (event, value) => {
  const minutes = Number(value)
  if (Number.isFinite(minutes) && minutes >= 0) {
    idleThresholdSec = Math.round(minutes * 60)
    saveIdleConfig()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('idle:threshold', { minutes, seconds: idleThresholdSec })
    }
  }
})
ipcMain.handle('idle:get-threshold', () => ({ seconds: idleThresholdSec, minutes: idleThresholdSec / 60 }))

ipcMain.on("open-external-url", (event, url) => {
  shell.openExternal(url)
})

ipcMain.on('minimize-app', () => {
  mainWindow.minimize()
})

ipcMain.on('close-app', () => {
  mainWindow.close()
})

ipcMain.on('trackerStop', () => {
  mainWindow.webContents.send('trackerStop:capture', { key: 'stop' })
})

ipcMain.on('screenshot:capture', () => {
  // Check screen capture permission first
  if (!verifyScreenCapturePermission()) {
    mainWindow.webContents.send('permission:denied', { type: 'screen' })
    return
  }
  
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
    .then((source) => {
      let image = source[0].thumbnail.toPNG()
      let base64 = source[0].thumbnail.toDataURL()
      const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
      mainWindow.webContents.send('screenshot:captured', { file: image, base64: base64 })
      sendNotification(dataUrl);
    })
    .catch((error) => {
      console.error("ERROR in capture: ", error)
    })
})

function sendNotification(dataUrl) {

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 372;
  const windowHeight = 282;

  screenshotNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth,
    y: height - windowHeight, // extra gap above the taskbar so the card bottom isn't clipped
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  screenshotNotificationWindow.loadFile(notificationHtmlPath);
  screenshotNotificationWindow.webContents.on('did-finish-load', () => {
    // Send after load so the renderer's IPC listeners are registered (else the events are missed).
    screenshotNotificationWindow.webContents.send('logo-path', iconPath);
    screenshotNotificationWindow.webContents.send('screenshot-path', dataUrl);
    screenshotNotificationWindow.showInactive(); // don't steal focus from the user's current input

    const notificationWindow = screenshotNotificationWindow;
    const closeHandler = () => {
      if (!notificationWindow.isDestroyed()) {
        notificationWindow.close();
      }
    };
    ipcMain.once('close_click', closeHandler);

    const autoCloseTimer = setTimeout(() => {
      if (!notificationWindow.isDestroyed()) {
        notificationWindow.close();
      }
    }, 10000);

    notificationWindow.once('closed', () => {
      clearTimeout(autoCloseTimer);
      ipcMain.removeListener('close_click', closeHandler);
    });
  });

}

// Common in-app notification — one shared layout (notification-template.html)
// whose content is passed in, so any future notification can reuse it:
//   showNotification({ title, subtitle, image, timeout })
// Pass `image` (a data URL / path) to show a media preview; omit it for a
// compact text-only card. The screenshot notification keeps its own file and
// flow (sendNotification) and is intentionally left untouched.
function showNotification({ title, subtitle = '', image = null, timeout = 10000 }) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 372;
  // Best-guess starting height; the renderer measures its real laid-out content
  // and we resize to fit (see 'notification:size' below), so content of ANY
  // length — a 1–3 line title, with or without a media preview — is shown in
  // full and never clipped. The card stays anchored bottom-right and grows
  // upward, so its bottom is always above the taskbar.
  const initialHeight = image ? 282 : 120;

  const win = new BrowserWindow({
    width: windowWidth,
    height: initialHeight,
    x: width - windowWidth,
    y: height - initialHeight,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Show only once — either after the first size report, or via the fallback.
  let shown = false;
  const showOnce = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.showInactive(); // don't steal focus from the user's current input
  };

  // Fit the window to the content the renderer actually rendered, keeping the
  // bottom edge above the taskbar. Scoped to THIS window (event.sender check) so
  // concurrent notifications never resize each other.
  const sizeHandler = (event, data) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return;
    const h = Math.max(60, Math.min(Math.round((data && data.height) || initialHeight), height - 20));
    win.setBounds({ x: width - windowWidth, y: height - h, width: windowWidth, height: h });
    showOnce();
  };
  ipcMain.on('notification:size', sizeHandler);

  win.loadFile(notificationTemplateHtmlPath);
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('logo-path', iconPath);
    win.webContents.send('notification:render', { title, subtitle, image, timeout });
    // Fallback: show at the initial height if no size report arrives shortly.
    setTimeout(showOnce, 400);

    const closeHandler = () => {
      if (!win.isDestroyed()) win.close();
    };
    ipcMain.once('notification:close', closeHandler);

    const autoCloseTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, timeout);

    win.once('closed', () => {
      clearTimeout(autoCloseTimer);
      ipcMain.removeListener('notification:close', closeHandler);
      ipcMain.removeListener('notification:size', sizeHandler);
    });
  });
}

// AHE-3835 — the PERSISTENT "tracker stopped" alert. Unlike showNotification()
// (routine white toast that auto-dismisses), this is a distinct amber card that
// stays until the user clicks Resume or Dismiss — so a user who had stepped away
// when the tracker stopped still sees it on return. One instance at a time.
function closeStoppedAlert() {
  if (stoppedAlertWindow && !stoppedAlertWindow.isDestroyed()) stoppedAlertWindow.close()
  stoppedAlertWindow = null
}

function showTrackerStoppedAlert({ reason, taskName = '', stoppedAt = Date.now() } = {}) {
  closeStoppedAlert() // never let alerts stack in the corner

  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const windowWidth = 372
  const initialHeight = 190

  const win = new BrowserWindow({
    width: windowWidth,
    height: initialHeight,
    x: width - windowWidth,
    y: height - initialHeight,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  stoppedAlertWindow = win

  let shown = false
  const showOnce = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.showInactive() // never steal focus from the user's current input
  }

  // Fit the window to the card's real height (reason / task length varies).
  // Scoped to THIS window so it can never resize a later alert.
  const sizeHandler = (event, data) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return
    const h = Math.max(120, Math.min(Math.round((data && data.height) || initialHeight), height - 20))
    win.setBounds({ x: width - windowWidth, y: height - h, width: windowWidth, height: h })
    showOnce()
  }
  ipcMain.on('alert:size', sizeHandler)

  win.loadFile(notificationAlertHtmlPath)
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('alert:render', { reason, taskName, stoppedAt })
    setTimeout(showOnce, 400) // fallback if no size report arrives
  })

  win.once('closed', () => {
    ipcMain.removeListener('alert:size', sizeHandler)
    if (stoppedAlertWindow === win) stoppedAlertWindow = null
  })
}

// Show a stop that happened while the screen was locked / asleep — but only once
// the user RETURNS (unlock / resume), never into a locked or black screen.
function surfacePendingStoppedAlert() {
  if (!pendingStoppedAlert) return
  const p = pendingStoppedAlert
  pendingStoppedAlert = null
  try {
    showTrackerStoppedAlert({ reason: p.reason, taskName: (lastTaskCtx && lastTaskCtx.taskName) || '', stoppedAt: p.stoppedAt })
  } catch (e) { /* best-effort */ }
}

powerMonitor.on('suspend', () => {
  // A running session is about to be stopped by sleep — remember it and show the
  // alert on resume (showing it now, into a sleeping screen, would be pointless).
  if (isTracking) pendingStoppedAlert = { reason: 'suspended', stoppedAt: Date.now() }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stop-tracker', true);
});
// HANDLE LOCK SCREEN
powerMonitor.on('lock-screen', () => {
  if (isTracking) pendingStoppedAlert = { reason: 'locked', stoppedAt: Date.now() }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stop-tracker', true);
});
// Surface the deferred stop alert when the user comes back.
powerMonitor.on('unlock-screen', () => { surfacePendingStoppedAlert() });
powerMonitor.on('resume', () => { surfacePendingStoppedAlert() });

// Add this handler to check permissions status
ipcMain.handle('check-permissions', async () => {
  return permissionsState
})

app.on('window-all-closed', () => {
  app.quit()
})