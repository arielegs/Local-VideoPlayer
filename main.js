const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const startServer = require('./server');

// Fix for Windows "Access is denied" cache issues in dev mode
// Use a temp directory for user data instead of the locked AppData one
const userDataPath = path.join(app.getPath('temp'), 'LocalVideoPlayerDev');
app.setPath('userData', userDataPath);

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
      sandbox: true
    }
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
