const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

// FIX: In packaged Electron apps, binaries inside ASAR archives may not be executable.
// @ffmpeg-installer sometimes returns a path inside app.asar which fails.
// We need to use "app.asar.unpacked" if available or ensure builder unpacks them.
// A simpler fix is to rely on electron-builder's asarUnpack and direct path replacement if needed.

let ffmpegPath = ffmpegInstaller.path;
let ffprobePath = ffprobeInstaller.path;

// Hack for ASAR paths: replace 'app.asar' with 'app.asar.unpacked'
if (ffmpegPath.includes('app.asar')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}
if (ffprobePath.includes('app.asar')) {
    ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

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
    let config = { "video_directory": "", "allow_external": false };
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            config = { ...config, ...fileConfig };
        } catch (e) { }
    }
    
    // Sync to electron main process
    if (typeof global !== 'undefined') {
        global.allowExternal = config.allow_external;
    }
    
    return config;
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

  // Dynamic About/Build Info API
  expressApp.get('/api/about', (req, res) => {
      try {
          let version = '1.0.0';
          try {
              const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
              version = pkg.version;
          } catch(e) {}
          
          let buildString = "Development Build";
          if (app.isPackaged) {
              const stats = fs.statSync(process.execPath);
              const bd = new Date(stats.mtime);
              buildString = bd.toLocaleDateString() + ' (' + bd.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ')';
          }
          
          res.json({
              version: version,
              buildDate: buildString
          });
      } catch (err) {
          res.json({ version: '1.0.0', buildDate: "Unknown" });
      }
  });

  expressApp.post('/api/config', (req, res) => {

    if (req.body.video_directory !== undefined) {
        config.video_directory = req.body.video_directory;
        updated = true;
    }
    
    if (req.body.allow_external !== undefined) {
        config.allow_external = !!req.body.allow_external;
        if (typeof global !== 'undefined') {
            global.allowExternal = config.allow_external;
        }
        updated = true;
    }

    if (updated) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        res.json({ "status": "success", "config": config });
    } else {
        res.status(400).json({ "status": "error", "message": "No valid fields provided" });
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

// Open in MPV API Removed

expressApp.get(/^\/api\/metadata\/(.*)/, (req, res) => {
    const config = loadConfig();
    const videoPath = decodeURIComponent(req.params[0]);
    const fullPath = path.join(config.video_directory, videoPath);

    if (!fs.existsSync(fullPath)) {
        return res.json({ duration: 0 });
    }

    ffmpeg.ffprobe(fullPath, (err, metadata) => {
        if (err) {
            console.error("FFprobe error:", err);
            return res.json({ duration: 0, videoCodec: null, audioCodec: null });
        }
        // ffprobe returns duration in seconds as a number usually, but let's be safe
        const d = metadata && metadata.format && metadata.format.duration;
        
        let vCodec = null;
        let audioTracks = [];
        let subtitleTracks = [];

        if (metadata && metadata.streams) {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream) vCodec = videoStream.codec_name;
            
            // Collect audio tracks
            metadata.streams.forEach((s, index) => {
                if (s.codec_type === 'audio') {
                    audioTracks.push({
                        index: s.index, // absolute index in file
                        codec: s.codec_name,
                        language: (s.tags && s.tags.language) ? s.tags.language : 'und',
                        title: (s.tags && s.tags.title) ? s.tags.title : `Audio Track ${audioTracks.length + 1}`
                    });
                }
                 if (s.codec_type === 'subtitle') {
                     subtitleTracks.push({
                         index: s.index,
                         codec: s.codec_name,
                         language: (s.tags && s.tags.language) ? s.tags.language : 'und',
                         title: (s.tags && s.tags.title) ? s.tags.title : `Subtitle ${subtitleTracks.length + 1}`
                     });
                 }
            });
        }

        res.json({ 
            duration: parseFloat(d) || 0,
            videoCodec: vCodec,
            audioTracks: audioTracks,
            subtitleTracks: subtitleTracks
        });
    });
});

// Serve Subtitles (Extract on the fly)
expressApp.get(/^\/api\/subtitles\/(.*)/, (req, res) => {
    const config = loadConfig();
    const videoPath = decodeURIComponent(req.params[0]);
    if (!config.video_directory) return res.sendStatus(404);
    
    const fullPath = path.join(path.resolve(config.video_directory), videoPath);
    const streamIndex = req.query.streamIndex;
    const startTime = req.query.startTime || 0;

    if (!fs.existsSync(fullPath)) return res.sendStatus(404);

    // console.log(`Extracting subtitles for stream ${streamIndex} from ${fullPath}`);

    res.contentType('text/vtt');
    
    // Attempt to be more accurate (though slower for very large sub files, but usually instant)
    // Don't use -ss in inputOptions (fast seek/reset ts before input)
    // Instead use -ss in output options (slow seek/process from start) so it cuts EXACTLY at startTime
    // Subtitles are tiny text files usually (<1MB), so reading from start is fast.
    
    // const inputOptions = [];
    // if (startTime > 0) {
    //     inputOptions.push(`-ss ${startTime}`);
    // }

    const inputOptions = [];

    const command = ffmpeg(fullPath)
        .inputOptions(inputOptions)
        .outputOptions([
             `-ss ${startTime}`, // Output seek for precision
             `-map 0:${streamIndex}`,
             '-f webvtt'
        ])
        .on('error', (err) => {
             console.error('Subtitle extraction error:', err.message);
             if (!res.headersSent) {
                 res.status(500).send('Error extracting subtitles');
             }
        })
        .pipe(res, { end: true });
});

// Transcoded Video Stream (for wide compatibility)
// This will transcode audio to AAC and copy video if possible, or transcode both
expressApp.get(/^\/stream\/(.*)/, (req, res) => {
    const config = loadConfig();
    const videoPath = decodeURIComponent(req.params[0]);
    if (!config.video_directory) {
         res.status(404).send('No video directory');
         return;
    }
    const videoDir = path.resolve(config.video_directory);
    const fullPath = path.join(videoDir, videoPath);

    if (!fs.existsSync(fullPath)) {
        res.status(404).send('Not found');
        return;
    }

    const startTime = req.query.startTime || 0;
    const clientVideoCodec = req.query.vCodec; 
    const audioIndex = req.query.audioIndex; // Desired audio stream index (absolute)

    const startStream = (vCodecName) => {
         let vCodec = 'libx264';
         // Standardize options for better sync
         let additionalOptions = [
             '-preset ultrafast',
             '-tune zerolatency',
             '-crf 23',
             '-pix_fmt yuv420p',
             '-g 60', // Force more frequent keyframes for seeking
             '-sc_threshold 0' 
         ];
         
         // FORCE RE-ENCODE for now to fix sync issues. 
         // 'copy' is the main culprit for A/V desync when seeking because 
         // video snaps to keyframes while audio cuts precisely.
         // if (vCodecName === 'h264' || vCodecName === 'avc1') {
         //      vCodec = 'copy';
         //      additionalOptions = []; 
         // }

         res.contentType('video/mp4');

         const command = ffmpeg(fullPath);

         if (startTime > 0) {
            // Use input seek only. With re-encoding (not copy), ffmpeg decodes
            // from the nearest keyframe and precisely starts output at the
            // requested timestamp. Combined with -reset_timestamps 1 the
            // output starts at PTS 0 which is what the browser expects.
            // Do NOT add an output -ss as well — that would double-seek
            // (input seek resets to 0, then output -ss skips again).
            command.seekInput(startTime);
         }
         
         // Standard probe size
         command.inputOptions([
             '-probesize 10M', 
             '-analyzeduration 10M'
         ]);

         // Map video (default to first usually)
         command.outputOptions(['-map 0:v:0']);

         // Map Audio
         if (audioIndex !== undefined && audioIndex !== null) {
              const idx = parseInt(audioIndex);
              if (!isNaN(idx)) {
                   command.outputOptions([`-map 0:${idx}`]);
              } else {
                   // Fallback to auto-select best audio if index invalid
                   command.outputOptions(['-map 0:a:0']);
              }
         } else {
              command.outputOptions(['-map 0:a:0']); 
         }

         command
            .format('mp4')
            .videoCodec(vCodec)
            .audioCodec('aac')     
            .audioChannels(2)
            .outputOptions([
                 '-movflags frag_keyframe+empty_moov+default_base_moof', 
                 '-reset_timestamps 1', // Crucial for A/V sync after seek
                 // '-avoid_negative_ts make_zero', // Ensure no negative timestamps
                 ...additionalOptions
            ])
            .on('start', (cmd) => {
                 console.log('Started ffmpeg:', cmd);
            })
            .on('error', (err) => {
                 if (err.message !== 'Output stream closed') {
                     // console.error('ffmpeg error:', err);
                 }
            })
            .pipe(res, { end: true });
    };

    if (clientVideoCodec) {
        startStream(clientVideoCodec);
    } else {
        // Fallback to probing if client didn't send codec (e.g. direct URL access)
        ffmpeg.ffprobe(fullPath, (err, metadata) => {
             if (err) {
                 console.error("Probe error", err);
                 return res.sendStatus(500);
             }
             
             const vStream = metadata.streams.find(s => s.codec_type === 'video');
             const codec = vStream ? vStream.codec_name : null;
             startStream(codec);
        });
    }
});

// Serve Video Files (Direct Play)
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
