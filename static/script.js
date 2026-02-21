document.addEventListener('DOMContentLoaded', () => {
    const videoList = document.getElementById('video-list');
    const videoPlayer = document.getElementById('video-player');
    const modal = document.getElementById('settings-modal');
    const btn = document.getElementById("folder-btn");
    const span = document.getElementsByClassName("close")[0];
    const saveSettings = document.getElementById("save-settings");
    const browseBtn = document.getElementById("browse-btn");
    const dirInput = document.getElementById("video-dir-input");
    const transcodeToggle = document.getElementById("transcode-toggle");
    
    let currentVideoPath = null;
    let isTranscoding = false;

    // Load saved preference
    const savedTranscode = localStorage.getItem('transcodePref');
    if (savedTranscode === 'true') {
        transcodeToggle.checked = true;
        isTranscoding = true;
    }

    // Toggle listener for immediate effect
    transcodeToggle.addEventListener('change', () => {
        // Save progress BEFORE updating global state logic
        if (currentVideoPath) {
            let t = videoPlayer.currentTime;
            // If switching OFF (new checked=false), old state was transcoding (true)
            if (!transcodeToggle.checked) {
                t += streamOffset;
            }
            saveProgress(currentVideoPath, t);
            
            // Pause so playVideo's internal save check sees paused and skips saving
            videoPlayer.pause();
        }

        // Update state
        isTranscoding = transcodeToggle.checked;
        localStorage.setItem('transcodePref', isTranscoding);
        
        // Reload video if one was selected
        if (currentVideoPath) {
            const items = Array.from(document.querySelectorAll('.video-item'));
            const item = items.find(el => el.dataset.path === currentVideoPath);
            playVideo(currentVideoPath, item);
        }
    });

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
        
        // Find the element (dataset.path uses spaces in filename, not encoded)
        // Ensure path matches dataset
        const items = Array.from(document.querySelectorAll('.video-item'));
        const item = items.find(el => el.dataset.path === path);
        
        if (item) {
            const indicator = document.createElement('span');
            indicator.className = 'last-played-indicator';
            indicator.textContent = ' 👁️ Last Played';
            item.appendChild(indicator);
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    // Play video function
    function playVideo(relPath, element) {
        // Save progress of the current video before switching
        if (currentVideoPath && !videoPlayer.paused) {
            let currentTime = videoPlayer.currentTime;
            if (isTranscoding) currentTime += streamOffset;
            saveProgress(currentVideoPath, currentTime);
        }
        
        // Reset states
        isTranscoding = transcodeToggle.checked;
        streamOffset = 0;
        totalDuration = 0;
        
        // Update "Last Played" indicator immediately
        document.querySelectorAll('.last-played-indicator').forEach(el => el.remove());
        
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

        // Fetch Metadata for Duration (Only needed for Transcoding really, but good to have)
        fetch(`/api/metadata/${encodedPath}`)
            .then(res => res.json())
            .then(meta => {
                totalDuration = meta.duration || 0;
                
                // Fetch saved progress
                fetch(`/api/progress/${encodedPath}`)
                    .then(res => res.json())
                    .then(data => {
                        // If checking another video, ignore this result
                        if (currentVideoPath !== relPath) return;

                        let savedTime = data.timestamp || 0;

                        if (isTranscoding) {
                             // Start stream from saved position
                             streamOffset = savedTime;
                             const videoUrl = `/stream/${encodedPath}?startTime=${savedTime}`;
                             videoPlayer.src = videoUrl;
                             videoPlayer.currentTime = 0; // Stream starts here
                        } else {
                             const videoUrl = `/video/${encodedPath}`;
                             videoPlayer.src = videoUrl;
                             // We set currentTime in loadedmetadata
                        }
                        
                        videoPlayer.onloadedmetadata = () => {
                           if (!isTranscoding && savedTime > 0) {
                                videoPlayer.currentTime = savedTime;
                            }
                            
                            videoPlayer.title = relPath;
                            document.getElementById('current-video-title').innerText = relPath + (isTranscoding ? " (Compatibility Mode)" : "");
                            videoPlayer.play().catch(e => console.log("Auto-play prevented:", e));
                        };
                    });
            }); 
    }

    // Save progress periodically
    setInterval(() => {
        if (!videoPlayer.paused && currentVideoPath) {
            let t = videoPlayer.currentTime;
            if (isTranscoding) t += streamOffset;
            saveProgress(undefined, t);
        }
    }, 5000);
    
    // Save when paused or page hidden
    // Note: event listeners pass event object as first arg, handle that in saveProgress
    videoPlayer.addEventListener('pause', () => {
         let t = videoPlayer.currentTime;
         if (isTranscoding) t += streamOffset;
         saveProgress(undefined, t);
    });
    
    window.addEventListener('beforeunload', () => {
         let t = videoPlayer.currentTime;
         if (isTranscoding) t += streamOffset;
         saveProgress(undefined, t);
    });
    
    function saveProgress(path, time) {
        // ... (rest is same)
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
    let streamOffset = 0;
    let totalDuration = 0;

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
        let currentTime = videoPlayer.currentTime;
        let duration = videoPlayer.duration;
        
        if (isTranscoding) {
             duration = totalDuration;
             currentTime = streamOffset + videoPlayer.currentTime;
             
             // Sanity check
             if (Math.abs(duration - currentTime) < 1) {
                 currentTime = duration;
             }
        }

        if (!duration && !isTranscoding) return; // Allow 0 duration for stream start?
        if (!duration) duration = 1; // prevent div by zero

        const percent = (currentTime / duration) * 100;
        progressBar.style.width = `${percent}%`;
        
        const current = formatTime(currentTime);
        const total = formatTime(duration);
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
        
        let seekTime;
       
        if (isTranscoding) {
            seekTime = pos * totalDuration;
            streamOffset = seekTime;
            const encodedPath = encodeURIComponent(currentVideoPath);
            videoPlayer.src = `/stream/${encodedPath}?startTime=${seekTime}`;
            
            // Wait for load start effectively
            videoPlayer.onloadedmetadata = () => {
                videoPlayer.play();
                // Ensure UI aligns
                progressBar.style.width = `${pos * 100}%`;
            };
        } else {
             if (videoPlayer.duration) {
                videoPlayer.currentTime = pos * videoPlayer.duration;
             }
        }
    });

    // Time Tooltip
    progressBarContainer.addEventListener('mousemove', (e) => {
        const rect = progressBarContainer.getBoundingClientRect();
        const padding = 0;
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding;
        
        let pos = clickX / visualWidth;
        
        let hoverTime;
        if (isTranscoding && totalDuration) {
             hoverTime = pos * totalDuration;
        } else {
             hoverTime = pos * videoPlayer.duration;
        }
        
        // Clamp and format
        const maxTime = (isTranscoding && totalDuration) ? totalDuration : (videoPlayer.duration || 0);
        const safeTime = Math.max(0, Math.min(hoverTime, maxTime));
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
        } else {
            document.exitFullscreen();
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
                handleKeys(5);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                handleKeys(-5);
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
    let seekDebounce = null;
    let pendingSeekTime = null;

    function handleKeys(delta) {
        if (!isTranscoding) {
            let t = videoPlayer.currentTime + delta;
            t = Math.max(0, Math.min(t, videoPlayer.duration || 0));
            videoPlayer.currentTime = t;
            return;
        }

        // Transcoding seek logic
        if (pendingSeekTime === null) {
            // First press: base off "stream logic time"
            // We need to use streamOffset + currentTime, but if we just sought, current time might be 0.
            pendingSeekTime = streamOffset + videoPlayer.currentTime;
        }
    
        // Apply delta
        pendingSeekTime += delta;
        pendingSeekTime = Math.max(0, Math.min(pendingSeekTime, totalDuration));
            
        // Visual feedback immediately
        const percent = (pendingSeekTime / totalDuration) * 100;
        progressBar.style.width = `${percent}%`;
        timeDisplay.textContent = `${formatTime(pendingSeekTime)} / ${formatTime(totalDuration)}`;
        
        // Show loading cursor
        playerContainer.style.cursor = 'wait';
        
        // Clear previous scheduled reload
        if (seekDebounce) clearTimeout(seekDebounce);
        
        // Wait 300ms for user to stop pressing keys - faster reaction
        seekDebounce = setTimeout(() => {
            streamOffset = pendingSeekTime;
            const encodedPath = encodeURIComponent(currentVideoPath);
            
            videoPlayer.src = `/stream/${encodedPath}?startTime=${pendingSeekTime}`;
            videoPlayer.play().catch(e => {});

            // Reset pending state
            pendingSeekTime = null;
            playerContainer.style.cursor = 'default';
        }, 300); 
    }
// Remove duplicate seek function and variables
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