const express = require('express');
const fs = require('fs');
const path = require('path');
const expressApp = express();

expressApp.use(express.json());

const { app, dialog } = require('electron');

// Determine if we are running in development or production
// In packaged apps (electron-builder), __dirname is inside app.asar which is read-only.
// We should store data in the user's data directory.

const isPackaged = app.isPackaged; 
let DATA_DIR;

if (isPackaged) {
    // Production: Use the standard Electron User Data directory.
    // This persists across updates and is OS-agnostic (Windows, Mac, Linux).
    DATA_DIR = app.getPath('userData');
} else {
    // Development: Use local folder to avoid messing with installed version
    DATA_DIR = path.join(__dirname, 'dev_data');
}

if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        // Fallback
        DATA_DIR = __dirname;
    }
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const LAST_PLAYED_FILE = path.join(DATA_DIR, 'last_played.json');

// Helper functions (same logic as Python)
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        } catch (e) { return { "video_directory": "" }; }
    }
    return { "video_directory": "" };
}

function saveProgress(videoPath, timestamp) {
    let progress = {};
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
        } catch (e) { progress = {}; }
    }
    
    progress[videoPath] = timestamp;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 4));
    
    // Also save last played
    fs.writeFileSync(LAST_PLAYED_FILE, JSON.stringify({ "last_played": videoPath }, null, 4));
}

function loadProgress(videoPath) {
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            return progress[videoPath] || 0;
        } catch (e) { return 0; }
    }
    return 0;
}

// Recursive file walker
function getAllFiles(dirPath, arrayOfFiles) {
    try {
        const files = fs.readdirSync(dirPath);

        arrayOfFiles = arrayOfFiles || [];

        files.forEach(function(file) {
            const fullPath = path.join(dirPath, file);
            try {
                if (fs.statSync(fullPath).isDirectory()) {
                    // Skip hidden directories or system folders to be safe
                    if (!file.startsWith('.') && file !== 'node_modules') {
                        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
                    }
                } else {
                    arrayOfFiles.push(fullPath);
                }
            } catch (e) {
                // Ignore permission errors for specific files/folders
            }
        });
    } catch (e) {
        // Ignore permission errors for the directory itself
    }

    return arrayOfFiles;
}

function getVideoFiles(directory) {
    const videoExtensions = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm']);
    const absDirectory = path.resolve(directory);

    if (!fs.existsSync(absDirectory)) return [];

    try {
        const allFiles = getAllFiles(absDirectory);
        const videoFiles = [];

        allFiles.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            if (videoExtensions.has(ext)) {
                let relPath = path.relative(absDirectory, file);
                // Normalize to forward slashes for web
                relPath = relPath.split(path.sep).join('/');
                videoFiles.push(relPath);
            }
        });

        return videoFiles.sort();
    } catch (e) {
        console.error("Error scanning directory:", e);
        return [];
    }
}

// Routes
// Serve static files with caching disabled for development
expressApp.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});
expressApp.use('/static', express.static(path.join(__dirname, 'static')));

// Serve index.html
expressApp.get('/', (req, res) => {
    // When running in an AppImage, __dirname points to resources/app.asar/
    // We need to ensure we're serving the file correctly from the archive.
    const indexPath = path.join(__dirname, 'templates/index.html');
    
    // Explicitly check logging (this will show in terminal if you run from term)
    console.log('Serving index from:', indexPath);

    // Using fs.readFile might be safer for ASAR archives in some contexts
    // but res.sendFile usually handles it. Let's try adding root option.
    res.sendFile('templates/index.html', { root: __dirname });
});

// Config API
expressApp.get('/api/config', (req, res) => {
    res.json(loadConfig());
});

expressApp.post('/api/config', (req, res) => {
    const newDir = req.body.video_directory;
    if (newDir) {
        const config = loadConfig();
        config.video_directory = newDir;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        res.json({ "status": "success", "video_directory": newDir });
    } else {
        res.status(400).json({ "status": "error" });
    }
});

// Videos API
expressApp.get('/api/videos', (req, res) => {
    const config = loadConfig();
    const directory = config.video_directory;
    
    // If no directory is set, return empty list instead of defaulting to root
    if (!directory) {
        res.json([]);
        return;
    }

    const absDirectory = path.resolve(directory); // Ensure absolute before check
    if (!fs.existsSync(absDirectory)) {
        res.json([]);
        return;
    }
    res.json(getVideoFiles(absDirectory));
});

// Progress API
expressApp.post('/api/progress', (req, res) => {
    const { video_path, timestamp } = req.body;
    if (video_path !== undefined && timestamp !== undefined) {
        saveProgress(video_path, timestamp);
        res.json({ "status": "success" });
    } else {
        res.status(400).json({ "status": "error" });
    }
});

expressApp.get(/^\/api\/progress\/(.*)/, (req, res) => {
    // Extract the path after /api/progress/
    // Python code handles encoded paths somewhat automatically?
    // Here we need to be careful. The client sends encoded path.
    // req.params[0] represents the first capturing group
    const videoPath = decodeURIComponent(req.params[0]);
    const timestamp = loadProgress(videoPath);
    res.json({ "timestamp": timestamp });
});

// Last played API
expressApp.get('/api/last_played', (req, res) => {
    if (fs.existsSync(LAST_PLAYED_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(LAST_PLAYED_FILE, 'utf8'));
            res.json(data);
        } catch (e) {
            res.json({ "last_played": null });
        }
    } else {
        res.json({ "last_played": null });
    }
});

expressApp.post('/api/choose-directory', async (req, res) => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            res.json({ path: result.filePaths[0] });
        } else {
            res.json({ canceled: true });
        }
    } catch (err) {
        console.error('Error opening dialog:', err);
        res.status(500).json({ error: 'Failed to open dialog' });
    }
});

// Serve Video Files
expressApp.get(/^\/video\/(.*)/, (req, res) => {
    const config = loadConfig();
    // If no directory is configured, we shouldn't serve files from root by default for security
    if (!config.video_directory) {
         res.status(404).send('No video directory configured');
         return;
    }
    const videoDir = path.resolve(config.video_directory);
    const filename = req.params[0]; // Captures the rest of the path

    // Security check: ensure the resolved path is within videoDir
    // For local app, maybe less strict, but good practice.
    const fullPath = path.join(videoDir, filename);

    if (fs.existsSync(fullPath)) {
        res.sendFile(fullPath);
    } else {
        res.status(404).send('Not found');
    }
});

function startServer(port) {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({"video_directory": ""}, null, 4));
    }
    
    const server = expressApp.listen(port, '127.0.0.1', () => {
        console.log(`Server running on port ${port} (Local Only)`);
    });
    return server;
}

module.exports = startServer;
