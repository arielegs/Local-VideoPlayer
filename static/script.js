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
    let currentVideoCodec = null; // Store codec info

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
    function playVideo(relPath, element, forceTranscode = false) {
        // Save progress of the current video before switching
        if (currentVideoPath && !videoPlayer.paused) {
            let currentTime = videoPlayer.currentTime;
            if (isTranscoding) currentTime += streamOffset;
            saveProgress(currentVideoPath, currentTime);
        }
        
        // Reset states
        // If forceTranscode is true (from error handler), force it.
        // Otherwise adhere to toggle.
        isTranscoding = forceTranscode || transcodeToggle.checked;

        // Auto-detect compatibility requirement if not already forced/checked
        if (!isTranscoding) {
            const troubleExtensions = ['.mkv', '.avi', '.wmv', '.flv', '.mov', '.ts', '.m3u8'];
            const format = relPath.substring(relPath.lastIndexOf('.')).toLowerCase();
            if (troubleExtensions.includes(format)) {
                 console.log("Auto-enabled compatibility mode for format:", format);
                 isTranscoding = true;
                 transcodeToggle.checked = true; // Sync UI
            }
        }

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
                currentVideoCodec = meta.videoCodec; // Save codec
                
                // Fetch saved progress
                fetch(`/api/progress/${encodedPath}`)
                    .then(res => res.json())
                    .then(data => {
                        // If checking another video, ignore this result
                        if (currentVideoPath !== relPath) return;

                        let savedTime = data.timestamp || 0;

                        const playSource = () => {
                             if (isTranscoding) {
                                  // Start stream from saved position
                                  streamOffset = savedTime;
                                  const videoUrl = `/stream/${encodedPath}?startTime=${savedTime}&vCodec=${currentVideoCodec || ''}`;
                                  videoPlayer.src = videoUrl;
                                  videoPlayer.currentTime = 0; // Stream starts here
                             } else {
                                  // Direct Play
                                  const videoUrl = `/video/${encodedPath}`;
                                  videoPlayer.src = videoUrl;
                                  // Video might error out here if format bad
                             }
                        };
                        
                        // Error handling wrapper for Direct Play fallback
                        const errorHandler = (e) => {
                             if (!isTranscoding) {
                                  console.warn("Direct play failed, switching to compatibility mode...", e);
                                  // Remove this listener to prevent loop if transcode fails too
                                  videoPlayer.removeEventListener('error', errorHandler);
                                  transcodeToggle.checked = true;
                                  playVideo(relPath, element, true);
                             }
                        };
                        
                        // Reset error handlers
                        videoPlayer.removeEventListener('error', errorHandler); // clean up old one potentially?
                        // Actually we should just add it once per load
                        videoPlayer.addEventListener('error', errorHandler, { once: true });

                        playSource();
                        
                        // Define onloadedmetadata once
                        videoPlayer.onloadedmetadata = () => {
                           // Only seek for Direct Play initial load
                           if (!isTranscoding && savedTime > 0 && Math.abs(videoPlayer.currentTime - savedTime) > 0.5) {
                                videoPlayer.currentTime = savedTime;
                            }
                            // Reset savedTime so subsequent seeks don't jump back?
                            // Actually better to nullify it after use, but it is scoped.
                            
                            videoPlayer.title = relPath;
                            const titleEl = document.getElementById('current-video-title');
                            if (titleEl) {
                                titleEl.innerText = relPath + (isTranscoding ? " (Compatibility Mode)" : "");
                            }
                            
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
    let isDragging = false;

    // Consolidated Seek Function
    function performSeek(time, commit = false) {
        // Clamp
        const maxDuration = (isTranscoding && totalDuration) ? totalDuration : (videoPlayer.duration || 0);
        if (maxDuration === 0) return; // Nothing we can do
        
        time = Math.max(0, Math.min(time, maxDuration));
        
        // Update UI immediately (visual feedback)
        const percent = (time / maxDuration) * 100;
        progressBar.style.width = `${percent}%`;
        timeDisplay.textContent = `${formatTime(time)} / ${formatTime(maxDuration)}`;
        
        if (!isTranscoding) {
            // Direct Play: Seek immediately
            // But if dragging, maybe wait? No, standard HTML5 video seeks fast usually.
            // If dragging, we might want to pause to avoid stutter audio?
            videoPlayer.currentTime = time;
        } else {
            // Transcoding Object Representation
            // Only reload the stream if we are 'committing' (mouseup or key press finished)
            if (commit) {
                 playerContainer.style.cursor = 'wait';
                 streamOffset = time;
                 const encodedPath = encodeURIComponent(currentVideoPath);
                 videoPlayer.src = `/stream/${encodedPath}?startTime=${time}&vCodec=${currentVideoCodec || ''}`;
                 videoPlayer.play().catch(e => console.error(e));
                 playerContainer.style.cursor = 'default';
            }
        }
    }

    progressBarContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        updateProgressFromEvent(e, false); // Update UI only
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            updateProgressFromEvent(e, false);
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            // Commit the seek
            updateProgressFromEvent(e, true); 
            isDragging = false;
        }
    });

    // Handle clicks that aren't drags (mouseup handles the end of a click too, but let's be safe)
    progressBarContainer.addEventListener('click', (e) => {
        // Debounce if needed, or rely on mouseup? 
        // Mouseup on document handles the drag end.
        // If it was a simple click, mousedown starts drag, mouseup ends drag -> commit.
        // So click listener might be redundant or double-fire.
        // Let's remove the click listener entirely and rely on mousedown/up.
    });
    
    function updateProgressFromEvent(e, commit) {
        const rect = progressBarContainer.getBoundingClientRect();
        const padding = 0; 
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding;
        
        let pos = clickX / visualWidth;
        pos = Math.max(0, Math.min(1, pos));
        
        const maxDuration = (isTranscoding && totalDuration) ? totalDuration : (videoPlayer.duration || 0);
        performSeek(pos * maxDuration, commit);
    }

    // Time Tooltip
    progressBarContainer.addEventListener('mousemove', (e) => {
        const rect = progressBarContainer.getBoundingClientRect();
        const padding = 0; // consistent with CSS
        const visualWidth = rect.width - (padding * 2);
        const clickX = e.clientX - rect.left - padding; // relative to bar
        
        let pos = clickX / visualWidth;
        
        const maxDuration = (isTranscoding && totalDuration) ? totalDuration : (videoPlayer.duration || 0);
        const hoverTime = pos * maxDuration;
        
        const safeTime = Math.max(0, Math.min(hoverTime, maxDuration));
        timeTooltip.textContent = formatTime(safeTime);
        
        // Tooltip position (centered on mouse X, clamped to container)
        // ... implementation details can use simple left style ...
        timeTooltip.style.left = `${e.clientX - rect.left}px`;
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
    
    let seekDebounce = null;
    let pendingSeekTime = null;

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

    function handleKeys(delta) {
        // Calculate current time base
        // If we are already scrubbing via keyboard (pendingSeekTime set), use that.
        // If not, use current video time.
        
        let baseTime;
        if (pendingSeekTime !== null) {
            baseTime = pendingSeekTime;
        } else {
             if (isTranscoding) {
                 baseTime = streamOffset + videoPlayer.currentTime;
             } else {
                 baseTime = videoPlayer.currentTime;
             }
        }
        
        let newTime = baseTime + delta;
        pendingSeekTime = newTime; // Update pending
        
        // Visual update immediately (commit=false)
        performSeek(newTime, false);
        
        // Debounce only the network commit
        if (seekDebounce) clearTimeout(seekDebounce);
        
        seekDebounce = setTimeout(() => {
            performSeek(pendingSeekTime, true); // Commit
            pendingSeekTime = null; // Reset
        }, 300); // 300ms wait
    }

    // Double Click Fullscreen
    playerContainer.addEventListener('dblclick', (e) => {
        // Prevent triggering the single click play/pause if possible, or just accept the toggle
        e.preventDefault(); 
        fullscreenBtn.click();
    });

    // Smoother Mouse Wheel Seek
    let wheelDebounce = null;
    let wheelTarget = null;
    
    playerContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const delta = e.deltaY;
        const sensitivity = 0.05; // 5% of scroll? No, fixed seconds is better usually?
        // Let's use 5 seconds per 'notch' roughly?
        // deltaY is usually 100. So 100 * -0.05 = -5 seconds.
        
        const seekStep = delta * -0.05; 

        // Current Base
        if (wheelTarget === null) {
             if (isTranscoding) {
                 wheelTarget = streamOffset + videoPlayer.currentTime;
             } else {
                 wheelTarget = videoPlayer.currentTime;
             }
        }
        
        wheelTarget += seekStep;
        
        // Visual
        performSeek(wheelTarget, false);
        
        // Debounce commit
        clearTimeout(wheelDebounce);
        wheelDebounce = setTimeout(() => {
             performSeek(wheelTarget, true);
             wheelTarget = null;
        }, 50); // Short delay for wheel
        
        showControls();
    }, { passive: false });
    
    // Remove old drag listeners if any remained (handled by consolidated block above)
    // ...


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