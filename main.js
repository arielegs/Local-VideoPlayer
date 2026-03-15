const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');
const startServer = require('./server');

// Heavy background Chromium features disabled to reduce RAM usage footprint and prevent phone-home telemetry
app.commandLine.appendSwitch('disable-features', 'TranslateUI,BlinkGenPropertyTrees');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-sync');

// Ultimate Privacy: Prevent the underlying Chromium engine from making background network requests to Google/external servers
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');

// Fix for Windows "Access is denied" cache issues in dev mode
// ONLY apply this in development. In production, use standard UserData for persistence.
if (!app.isPackaged) {
    const userDataPath = path.join(app.getPath('temp'), 'LocalVideoPlayerDev');
    app.setPath('userData', userDataPath);
} else {
    // Ensure consistent user data path for production
    // Previous versions might have used 'LocalVideoPlayer' (no spaces)
    // We want to maintain compatibility or force a specific path
    const appData = app.getPath('appData');
    const userDataPath = path.join(appData, 'LocalVideoPlayer'); // Explicitly match old folder
    app.setPath('userData', userDataPath);
}

let mainWindow;
let server;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.png'), // Load the icon
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false, // Disabling spellcheck saves memory
      enableWebSQL: false
    }
  });

  // Strict network blocking for privacy: aggressively block any request trying to leave the local machine
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    try {
        if (global.allowExternal === true) {
            return callback({ cancel: false });
        }
        
        const url = new URL(details.url);
        // Allow ONLY safe protocols and explicitly safe local hostnames
        const isSafeProtocol = ['devtools:', 'file:', 'data:', 'blob:', 'chrome-extension:'].includes(url.protocol);
        const isLocalHost = ['127.0.0.1', 'localhost'].includes(url.hostname);
        
        if (!isSafeProtocol && !isLocalHost) {
            console.warn(`[PRIVACY BLOCK] Stopped unauthorized connection attempt to: ${details.url}`);
            return callback({ cancel: true });
        }
    } catch (e) {
        return callback({ cancel: true }); // Block if URL is unparseable 
    }
    
    callback({ cancel: false });
  });

  // Block any attempt by scripts/ads to open a new tab or popup window,
  // but allow specific external links to safely open in the user's default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://github.com/')) {
        shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });

  // Remove the menu completely for a cleaner look
  mainWindow.setMenuBarVisibility(false);

  // Clear cache to ensure new changes are loaded
  mainWindow.webContents.session.clearCache();

  // Start the Express server first
  server = startServer(5000);

  // Load the URL
  mainWindow.loadURL('http://127.0.0.1:5000');

  // Prevent navigation to external sites
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up server when app quits
app.on('will-quit', () => {
    if (server) {
        server.close();
    }
});
