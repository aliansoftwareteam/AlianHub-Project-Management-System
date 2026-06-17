import { app, ipcMain, Menu, Tray, BrowserWindow, shell, dialog, desktopCapturer, systemPreferences, powerMonitor, Notification,screen  } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers'
const path = require('node:path')
const fs = require('fs')
const iconPath = path.join(__dirname, 'logo.png')
const trayIconPath = path.join(__dirname, 'traylogo.png')
const isProd = process.env.NODE_ENV === 'production'
let notification = null;
let screenshotNotificationWindow = null;

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

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('myapp', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('myapp')
}

let mainWindow
let tray = null
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
  
  // Load saved permissions state
  loadPermissionsState()
  
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
    let type = deepLinkURL?.split('?')[1]?.split('&')[0]?.split('=')[1];
    if (type && type == 'trackerStart') {
      mainWindow.webContents.send('trackerInfoFill', { url: deepLinkURL })
    } else {
      mainWindow.webContents.send('deeplinkUrl', { url: deepLinkURL })
    }
  }
})()

app.on('open-url', (event, deepLinkURL) => {
  event.preventDefault();
  let type = deepLinkURL?.split('?')[1]?.split('&')[0]?.split('=')[1];
  if (type && type == 'trackerStart') {
    mainWindow.webContents.send('trackerInfoFill', { url: deepLinkURL })
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
    let url = commandLine.pop()
    if (url) {
      let type = url?.split('?')[1]?.split('&')[0]?.split('=')[1];
      if (type && type == 'trackerStart') {
        mainWindow.webContents.send('trackerInfoFill', { url: url })
      } else {
        mainWindow.webContents.send('deeplinkUrl', { url: url })
      }
    }
  })
}

// Activity sampling via OS idle time. Replaces node-global-key-listener, whose
// bundled native hook binary (e.g. WinKeyServer.exe) was flagged and quarantined
// by antivirus as a keylogger, which silently stopped all keyboard/mouse counts.
// powerMonitor.getSystemIdleTime() is built into Electron, ships no native
// binary, needs no accessibility permission, and reflects both keyboard and
// mouse input. While tracking we sample once per second and emit one
// 'activity:tick' for each second the user was recently active.
const startActivitySampling = () => {
  if (activityInterval) return
  activityInterval = setInterval(() => {
    if (!isTracking || !mainWindow || mainWindow.isDestroyed()) return
    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds <= ACTIVE_IDLE_THRESHOLD_SEC) {
      mainWindow.webContents.send('activity:tick', { active: 1 })
    }
  }, 1000)
}

// Stop the idle sampler.
const stopActivitySampling = () => {
  if (activityInterval) {
    clearInterval(activityInterval)
    activityInterval = null
  }
}

// Add IPC listeners for start and stop events
ipcMain.on('start-listen-event', () => {
  isTracking = true
  startActivitySampling()
  mainWindow.webContents.send('tracking:status', { active: true })
})

ipcMain.on('stop-listen-event', () => {
  isTracking = false
  stopActivitySampling()
  mainWindow.webContents.send('tracking:status', { active: false })
})

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
  const windowWidth = 350;
  const windowHeight = 200;

  screenshotNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth - 10,
    y: height - windowHeight - 10,
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

  screenshotNotificationWindow.loadFile(path.join(__dirname, 'notification.html'));
  screenshotNotificationWindow.webContents.send('logo-path', iconPath);
  screenshotNotificationWindow.webContents.on('did-finish-load', () => {
    screenshotNotificationWindow.webContents.send('screenshot-path', dataUrl);
    screenshotNotificationWindow.show();

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

powerMonitor.on('suspend', () => {
  mainWindow.webContents.send('stop-tracker', true);
});
// HANDLE LOCK SCREEN
powerMonitor.on('lock-screen', () => {
  mainWindow.webContents.send('stop-tracker', true);
  // win.webContents.send('lock-screen', true);
});

// Add this handler to check permissions status
ipcMain.handle('check-permissions', async () => {
  return permissionsState
})

app.on('window-all-closed', () => {
  app.quit()
})