document.addEventListener('DOMContentLoaded', () => {
    const videoList = document.getElementById('video-list');
    const videoPlayer = document.getElementById('video-player');
    const modal = document.getElementById('settings-modal');
    const btn = document.getElementById("folder-btn");
    const span = document.getElementsByClassName("close")[0];
    const saveSettings = document.getElementById("save-settings");
    const browseBtn = document.getElementById("browse-btn");
    const dirInput = document.getElementById("video-dir-input");
    
    let currentVideoPath = null;
    
    // Browse Button Click
    browseBtn.onclick = function() {
        fetch('/api/choose-directory', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.path) {
                    dirInput.value = data.path;
                }
            })
            .catch(err => console.error("Error opening dialog:", err));
    }
    
    // Fetch video list
    function loadVideos() {
        fetch('/api/videos')
            .then(response => response.json())
            .then(videos => {
                videoList.innerHTML = '';
                videos.forEach(video => {
                    const div = document.createElement('div');
                    div.className = 'video-item';
                    div.dataset.path = video; // Store path in dataset for easy finding
                    div.title = video; // Tooltip for full path

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = video;
                    div.appendChild(nameSpan);
                    
                    div.onclick = () => playVideo(video, div);
                    videoList.appendChild(div);
                });
                
                // After loading videos, check for last played
                fetch('/api/last_played')
                    .then(r => r.json())
                    .then(data => {
                        if(data.last_played) {
                            highlightLastPlayed(data.last_played);
                        }
                    });
            });
    }

    function highlightLastPlayed(path) {
        // Remove existing indicators
        document.querySelectorAll('.last-played-indicator').forEach(el => el.remove());
        
        // Find the element
        const items = Array.from(document.querySelectorAll('.video-item'));
        const item = items.find(el => el.dataset.path === path);
        
        if (item) {
            const indicator = document.createElement('span');
            indicator.className = 'last-played-indicator';
            indicator.textContent = ' 👁️ Last Played';
            item.appendChild(indicator);
            // Optional: Scroll to it
            // item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    // Play video function
    function playVideo(relPath, element) {
        // Save progress of the current video before switching
        if (currentVideoPath && !videoPlayer.paused) {
            saveProgress(currentVideoPath, videoPlayer.currentTime);
        }
        
        // Update "Last Played" indicator immediately
        // We know we are about to play this, so mark it
        // Remove old indicator
        document.querySelectorAll('.last-played-indicator').forEach(el => el.remove());
        
        // Add new indicator to current element if it doesn't have one
        if (element) {
             const indicator = document.createElement('span');
             indicator.className = 'last-played-indicator';
             indicator.textContent = ' 👁️ Last Played';
             element.appendChild(indicator);
        }

        // Highlight active item
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
        if(element) element.classList.add('active');
        
        // Update current path immediately
        currentVideoPath = relPath;
        const encodedPath = encodeURIComponent(relPath);

        
        // Fetch saved progress
        fetch(`/api/progress/${encodedPath}`)
            .then(res => res.json())
            .then(data => {
                // If checking another video, ignore this result
                if (currentVideoPath !== relPath) return;

                const savedTime = data.timestamp;
                const videoUrl = `/video/${encodedPath}`;
                
                // Only change src if it's different (or to force reload)
                // But here we always want to load the new one
                videoPlayer.src = videoUrl;
                
                // Clean up previous event listener if possible (though onloadedmetadata overwrite handles it)
                videoPlayer.onloadedmetadata = () => {
                   if (savedTime > 0) {
                        videoPlayer.currentTime = savedTime;
                    }
                    videoPlayer.title = relPath;
                    document.getElementById('current-video-title').innerText = relPath;
                    videoPlayer.play().catch(e => console.log("Auto-play prevented:", e));
                };
            });
    }

    // Save progress periodically
    setInterval(() => {
        if (!videoPlayer.paused && currentVideoPath) {
            saveProgress();
        }
    }, 5000);
    
    // Save when paused or page hidden
    videoPlayer.addEventListener('pause', saveProgress);
    window.addEventListener('beforeunload', () => saveProgress());
    
    function saveProgress(path, time) {
        // Check if called as event handler
        if (path && path.type) { // Event object
            path = undefined;
            time = undefined;
        }

        const p = path || currentVideoPath;
        const t = (time !== undefined && time !== null) ? time : videoPlayer.currentTime;

        if (!p) return;
        
        fetch('/api/progress', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_path: p,
                timestamp: t
            }),
        });
    }

    // Modal logic
    btn.onclick = function() {
        modal.style.display = "block";
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                dirInput.value = data.video_directory;
            });
    }
    
    span.onclick = function() {
        modal.style.display = "none";
    }
    
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
    
    saveSettings.onclick = function() {
        const newDir = dirInput.value;
        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_directory: newDir })
        })
        .then(res => res.json())
        .then(data => {
            modal.style.display = "none";
            loadVideos(); // Reload list
        });
    }

    // Initial load
    loadVideos();

    // Custom Video Controls Logic
    const playPauseBtn = document.getElementById('play-pause');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    const timeTooltip = document.getElementById('time-tooltip');
    const timeDisplay = document.getElementById('time-display');
    const volumeSlider = document.getElementById('volume-slider');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const playerContainer = document.getElementById('player-container');
    const controls = document.getElementById('video-controls');
    let controlsTimeout;

    const muteBtn = document.getElementById('mute-btn');
    
    // Toggle Play/Pause
    function togglePlay() {
        if (videoPlayer.paused || videoPlayer.ended) {
            videoPlayer.play();
        } else {
            videoPlayer.pause();
        }
    }

    // Toggle Mute
    function toggleMute() {
        videoPlayer.muted = !videoPlayer.muted;
        updateVolumeIcon();
    }
    
    function updateVolumeIcon() {
        const iconPath = muteBtn.querySelector('path');
        if (videoPlayer.muted || videoPlayer.volume === 0) {
            // Muted icon
            iconPath.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
        } else {
            // Volume Up icon
            iconPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
        }
    }

    playPauseBtn.addEventListener('click', togglePlay);
    videoPlayer.addEventListener('click', togglePlay);
    muteBtn.addEventListener('click', toggleMute);

    // Sync UI with state
    videoPlayer.addEventListener('play', () => {
        // Change to Pause icon
        playPauseBtn.querySelector('path').setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
        showControls();
    });

    videoPlayer.addEventListener('pause', () => {
        // Change to Play icon
        playPauseBtn.querySelector('path').setAttribute('d', 'M8 5v14l11-7z');
        showControls(); 
        clearTimeout(controlsTimeout); 
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
        playerContainer.style.cursor = 'default';
    });
    
    videoPlayer.addEventListener('volumechange', () => {
        updateVolumeIcon();
        volumeSlider.value = videoPlayer.volume;
    });

    // Fullscreen Update Icon
    playerContainer.addEventListener('fullscreenchange', () => {
        const path = fullscreenBtn.querySelector('path');
        if (document.fullscreenElement) {
             // Exit Fullscreen icon
             path.setAttribute('d', 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z');
        } else {
             // Enter Fullscreen icon
             path.setAttribute('d', 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z');
        }
    });

    // Update Progress Bar & Time
    videoPlayer.addEventListener('timeupdate', () => {
        if (!videoPlayer.duration) return;
        const percent = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        progressBar.style.width = `${percent}%`;
        
        const current = formatTime(videoPlayer.currentTime);
        const total = formatTime(videoPlayer.duration);
        timeDisplay.textContent = `${current} / ${total}`;
    });

    // Seek
    progressBarContainer.addEventListener('click', (e) => {
        const rect = progressBarContainer.getBoundingClientRect();
        // Account for the 0px padding on left/right defined in CSS
        const padding = 0; 
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding;
        
        let pos = clickX / visualWidth;
        // Clamp between 0 and 1
        pos = Math.max(0, Math.min(1, pos));
        
        videoPlayer.currentTime = pos * videoPlayer.duration;
    });

    // Time Tooltip
    progressBarContainer.addEventListener('mousemove', (e) => {
        const rect = progressBarContainer.getBoundingClientRect();
        const padding = 0;
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding;
        
        let pos = clickX / visualWidth;
        const hoverTime = pos * videoPlayer.duration;
        
        // Clamp and format
        const safeTime = Math.max(0, Math.min(hoverTime, videoPlayer.duration));
        timeTooltip.textContent = formatTime(safeTime);
        
        // Position the tooltip
        // We want it centered on the cursor, but constrained to the container so it doesn't overflow
        const tooltipWidth = timeTooltip.offsetWidth; // Get current width
        let leftPos = e.clientX - rect.left;
        
        // Simple positioning
        timeTooltip.style.left = `${leftPos}px`;
    });

    // Volume
    volumeSlider.addEventListener('input', (e) => {
        videoPlayer.volume = e.target.value;
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            playerContainer.requestFullscreen();
            fullscreenBtn.textContent = '⛶'; // Exit icon?
        } else {
            document.exitFullscreen();
            fullscreenBtn.textContent = '⛶';
        }
    });

    // Reset Play button on end
    videoPlayer.addEventListener('ended', () => {
        playPauseBtn.textContent = '⏵';
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in an input
        if (document.activeElement.tagName === 'INPUT') return;

        switch(e.key) {
            case ' ':
            case 'k':
                e.preventDefault(); // Prevent scrolling
                togglePlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 5);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
                break;
            case 'f':
                e.preventDefault();
                fullscreenBtn.click();
                break;
            case 'm':
                e.preventDefault();
                videoPlayer.muted = !videoPlayer.muted;
                break;
        }
    });

    // Double Click Fullscreen
    playerContainer.addEventListener('dblclick', (e) => {
        // Prevent triggering the single click play/pause if possible, or just accept the toggle
        e.preventDefault(); 
        fullscreenBtn.click();
    });

    // Smoother Mouse Wheel Seek
    let seekTarget = null;
    let seekTimeout;
    
    playerContainer.addEventListener('wheel', (e) => {
        e.preventDefault();

        // 1. Calculate direction and magnitude based on scroll speed
        // standard deltaY is ~100.
        const delta = e.deltaY;
        const sensitivity = 0.05; // Seconds per delta unit
        const seekStep = delta * -sensitivity; // Invert: Down = backward, Up = forward? 
        // Wait, normally Scroll Up (negative) -> Move UP/Back in document. 
        // But in video players: Scroll Up -> Volume Up or Forward?
        // Let's stick to: Up (-delta) = Forward, Down (+delta) = Backward
        // so delta * -1 matches previous logic.
        
        // 2. Initialize seek target if not active
        if (seekTarget === null) {
            seekTarget = videoPlayer.currentTime;
        }

        // 3. Accumulate seek time
        seekTarget += seekStep;
        seekTarget = Math.max(0, Math.min(videoPlayer.duration, seekTarget));

        // 4. Update UI immediately (optional, or wait for timeupdate)
        const percent = (seekTarget / videoPlayer.duration) * 100;
        progressBar.style.width = `${percent}%`;
        const current = formatTime(seekTarget);
        const total = formatTime(videoPlayer.duration);
        timeDisplay.textContent = `${current} / ${total}`;

        // 5. Debounce the actual seek to avoid stuttering
        clearTimeout(seekTimeout);
        seekTimeout = setTimeout(() => {
            // Apply the final seek
            videoPlayer.currentTime = seekTarget;
            seekTarget = null; // Reset
        }, 50); // Small delay to gather scroll events
        
        showControls();
    }, { passive: false });

    // Also support dragging the progress bar
    let isDragging = false;
    
    progressBarContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        updateProgressFromEvent(e);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            updateProgressFromEvent(e);
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
        }
    });
    
    function updateProgressFromEvent(e) {
        const rect = progressBarContainer.getBoundingClientRect();
        const padding = 0;
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding;
        
        let pos = clickX / visualWidth;
        videoPlayer.currentTime = Math.max(0, Math.min(1, pos)) * videoPlayer.duration;
    }

    // Helper: Format time
    function formatTime(seconds) {
        if(isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Hide controls after inactivity
    function showControls() {
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
        playerContainer.style.cursor = 'default';
        
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(() => {
            if (!videoPlayer.paused) {
                // If hovering over controls, don't hide
                if (controls.matches(':hover')) {
                    showControls(); // Check again later
                    return;
                }
                controls.style.opacity = '0';
                controls.style.pointerEvents = 'none';
                playerContainer.style.cursor = 'none'; // Hide cursor
            }
        }, 3000);
    }

    playerContainer.addEventListener('mousemove', showControls);
    playerContainer.addEventListener('click', showControls);

    // Initial show
    showControls();
});