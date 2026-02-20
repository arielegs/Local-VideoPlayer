const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

// Determine if we are running in development or production
// In packaged apps (electron-builder), __dirname is inside app.asar which is read-only.
// We should store data in the user's data directory.
// However, the user wants separation.
// If running from source (dev), we'll use a local 'dev_data' folder.
// If running installed, we'll use the user's AppData folder.

// Detect if running in Electron (via existence of process.versions.electron)
const isElectron = !!process.versions.electron;
// Detect if packaged (production build)
const isPackaged = __dirname.includes('app.asar');

let DATA_DIR;

if (isPackaged) {
    // Production/Installed mode: specific user data folder
    // We can't easily get app.getPath('userData') here without passing it from main.js
    // For now, let's assume relative to the executable for portable, or AppData for installed.
    // Given the user wants separation, let's use the OS temp directory or local AppData as a fallback if not passed.
    // A better approach: main.js should pass the data path.
    // Fallback logic specific to Windows typical install paths:
    DATA_DIR = path.join(process.env.APPDATA || '.', 'LocalVideoPlayer');
} else {
    // Development mode: use a local folder to separate from installed version
    DATA_DIR = path.join(__dirname, 'dev_data');
}

if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        // Fallback to current dir if permission denied
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
        } catch (e) { return { "video_directory": "./videos" }; }
    }
    return { "video_directory": "./videos" };
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
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});
app.use('/static', express.static(path.join(__dirname, 'static')));

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// Config API
app.get('/api/config', (req, res) => {
    res.json(loadConfig());
});

app.post('/api/config', (req, res) => {
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
app.get('/api/videos', (req, res) => {
    const config = loadConfig();
    const directory = config.video_directory || '.';
    const absDirectory = path.resolve(directory); // Ensure absolute before check
    if (!fs.existsSync(absDirectory)) {
        res.json([]);
        return;
    }
    res.json(getVideoFiles(absDirectory));
});

// Progress API
app.post('/api/progress', (req, res) => {
    const { video_path, timestamp } = req.body;
    if (video_path !== undefined && timestamp !== undefined) {
        saveProgress(video_path, timestamp);
        res.json({ "status": "success" });
    } else {
        res.status(400).json({ "status": "error" });
    }
});

app.get(/^\/api\/progress\/(.*)/, (req, res) => {
    // Extract the path after /api/progress/
    // Python code handles encoded paths somewhat automatically?
    // Here we need to be careful. The client sends encoded path.
    // req.params[0] represents the first capturing group
    const videoPath = decodeURIComponent(req.params[0]);
    const timestamp = loadProgress(videoPath);
    res.json({ "timestamp": timestamp });
});

// Last played API
app.get('/api/last_played', (req, res) => {
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

// Serve Video Files
app.get(/^\/video\/(.*)/, (req, res) => {
    const config = loadConfig();
    const videoDir = path.resolve(config.video_directory || '.');
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
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({"video_directory": "./videos"}, null, 4));
    }
    
    const server = app.listen(port, '127.0.0.1', () => {
        console.log(`Server running on port ${port} (Local Only)`);
    });
    return server;
}

module.exports = startServer;
