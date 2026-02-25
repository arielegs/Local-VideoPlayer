document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const videoList = document.getElementById('video-list');
    const videoPlayer = document.getElementById('video-player');
    const seekOverlay = document.getElementById('seek-overlay');
    
    // Modal & Config
    const modal = document.getElementById('settings-modal');
    const folderBtn = document.getElementById("folder-btn");
    const closeSpan = document.getElementsByClassName("close")[0];
    const saveSettings = document.getElementById("save-settings");
    const browseBtn = document.getElementById("browse-btn");
    const dirInput = document.getElementById("video-dir-input");
    const transcodeToggle = document.getElementById("transcode-toggle");
    
    // Player Controls
    const playPauseBtn = document.getElementById('play-pause');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    const timeTooltip = document.getElementById('time-tooltip');
    const timeDisplay = document.getElementById('time-display');
    const volumeSlider = document.getElementById('volume-slider');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const playerContainer = document.getElementById('player-container');
    const controls = document.getElementById('video-controls');
    const muteBtn = document.getElementById('mute-btn');

    // New Settings Menu Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsMenu = document.getElementById('settings-menu');
    const ccBtn = document.getElementById('cc-btn');
    
    // --- State ---
    let currentVideoPath = null;
    let isTranscoding = false;
    let currentVideoCodec = null; 
    let currentAudioTrack = null; // null means default track
    let currentSubtitleTrack = -1; // -1 for off
    let availableSubtitles = [];
    
    let streamOffset = 0;
    let totalDuration = 0;
    let controlsTimeout;
    let isDragging = false;

    // Load saved preference
    const savedTranscode = localStorage.getItem('transcodePref');
    if (savedTranscode === 'true') {
        transcodeToggle.checked = true;
        isTranscoding = true;
    }

    // --- Core Video Logic ---

    function loadVideos() {
        fetch('/api/videos')
            .then(response => response.json())
            .then(videos => {
                videoList.innerHTML = '';
                videos.forEach(video => {
                    const div = document.createElement('div');
                    div.className = 'video-item';
                    div.dataset.path = video; 
                    div.title = video;

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = video;
                    div.appendChild(nameSpan);
                    
                    div.onclick = () => playVideo(video, div);
                    videoList.appendChild(div);
                });
                
                // Last played
                fetch('/api/last_played')
                    .then(r => r.json())
                    .then(data => {
                        if(data.last_played) highlightLastPlayed(data.last_played);
                    });
            });
    }

    function removeSubtitleTracks() {
        // Iterate through textTracks property first to disable active tracks
        if (videoPlayer.textTracks) {
            for (let i = 0; i < videoPlayer.textTracks.length; i++) {
                 // Set mode to disabled to hide any active cues immediately
                 try {
                     videoPlayer.textTracks[i].mode = 'disabled';
                 } catch (e) { console.warn("Failed to disable track", e); }
            }
        }
        
        // Then remove the track elements from DOM
        const tracks = videoPlayer.getElementsByTagName('track');
        while (tracks.length > 0) {
            tracks[0].remove();
        }
        
        // Double check
        Array.from(videoPlayer.querySelectorAll('track')).forEach(t => t.remove());
    }

    function playVideo(relPath, element, forceTranscode = false) {
        // Save progress of previous
        if (currentVideoPath && !videoPlayer.paused) {
            let t = videoPlayer.currentTime;
            if (isTranscoding) t += streamOffset;
            saveProgress(currentVideoPath, t);
        }
        
        // Reset State
        isTranscoding = forceTranscode || transcodeToggle.checked;
        
        // Auto-transcode check for unsupported containers
        let autoEnforced = false;
        if (!isTranscoding) {
            const ext = relPath.substring(relPath.lastIndexOf('.')).toLowerCase();
            if (['.mkv', '.avi', '.wmv', '.flv', '.mov', '.ts', '.m3u8'].includes(ext)) {
                 console.log("Auto-enabled compatibility mode (container)");
                 isTranscoding = true;
                 transcodeToggle.checked = true; 
                 autoEnforced = true;
            }
        }

        // Disable toggle if enforced
        if (autoEnforced) {
            transcodeToggle.disabled = true;
            transcodeToggle.parentElement.title = "This format requires Compatibility Mode";
            document.querySelector('.compatibility-box').classList.add('disabled');
            document.querySelector('.compat-desc').textContent = "Required for this file format.";
        } else {
            transcodeToggle.disabled = false;
            transcodeToggle.parentElement.title = "";
            document.querySelector('.compatibility-box').classList.remove('disabled');
            document.querySelector('.compat-desc').textContent = "Enable if video fails to play or has no audio (MKV/AVI).";
            
            // Re-apply correct state if we revisited a supported file
            transcodeToggle.checked = isTranscoding;
        }

        streamOffset = 0;
        totalDuration = 0;
        currentAudioTrack = null; 
        currentSubtitleTrack = -1;
        
        // UI Reset
        videoPlayer.playbackRate = 1.0;
        updateSpeedSelection(1.0);
        highlightLastPlayed(relPath); // Update UI highlight
        
        currentVideoPath = relPath;
        document.getElementById('current-video-title').textContent = relPath.split(/[\\/]/).pop();
        
        const encodedPath = encodeURIComponent(relPath);
        
        // Cleanup old subtitles properly first
        removeSubtitleTracks();
        
        // FULL CLEANUP
        videoPlayer.innerHTML = ''; 

        // Fetch Metadata
        fetch(`/api/metadata/${encodedPath}`)
            .then(res => res.json())
            .then(meta => {
                if (currentVideoPath !== relPath) return; // Prevent async metadata loading of old videos

                totalDuration = meta.duration || 0;
                currentVideoCodec = meta.videoCodec;

                // Auto-enable compatibility mode for files with non-browser-playable audio
                // (e.g. MP4 with AC3/DTS/EAC3/FLAC audio codecs)
                if (!isTranscoding && !autoEnforced && meta.audioTracks && meta.audioTracks.length > 0) {
                    const browserAudioCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
                    const firstAudio = meta.audioTracks[0];
                    if (firstAudio.codec && !browserAudioCodecs.includes(firstAudio.codec.toLowerCase())) {
                        console.log(`Auto-enabled compatibility mode (audio codec: ${firstAudio.codec})`);
                        isTranscoding = true;
                        transcodeToggle.checked = true;
                        autoEnforced = true;
                        transcodeToggle.disabled = true;
                        transcodeToggle.parentElement.title = "This file's audio requires Compatibility Mode";
                        document.querySelector('.compatibility-box').classList.add('disabled');
                        document.querySelector('.compat-desc').textContent = `Audio codec (${firstAudio.codec}) requires transcoding.`;
                    }
                }
                
                setupAudioMenu(meta.audioTracks);
                setupSubtitleMenu(meta.subtitleTracks, encodedPath);

                // Load Progress
                fetch(`/api/progress/${encodedPath}`)
                    .then(res => res.json())
                    .then(data => {
                        if (currentVideoPath !== relPath) return;

                        let savedTime = data.timestamp || 0;
                        
                        // Error fallback
                        const errorHandler = () => {
                             if (!isTranscoding) {
                                  console.warn("Playback failed, forcing transcode...");
                                  videoPlayer.removeEventListener('error', errorHandler);
                                  transcodeToggle.checked = true; 
                                  playVideo(relPath, element, true);
                             }
                        };
                        videoPlayer.addEventListener('error', errorHandler, { once: true });

                        if (isTranscoding) {
                            streamOffset = savedTime;
                            let url = `/stream/${encodedPath}?startTime=${savedTime}&vCodec=${currentVideoCodec || ''}`;
                            // Use strict check for null, allow 0
                            if(currentAudioTrack !== null) url += `&audioIndex=${currentAudioTrack}`;
                            videoPlayer.src = url;
                        } else {
                            videoPlayer.src = `/video/${encodedPath}`;
                            videoPlayer.currentTime = savedTime;
                        }
                        
                        // Re-enable subtitle if selected (setupSubtitleMenu runs before this)
                        if (currentSubtitleTrack !== -1) {
                            enableSubtitle(currentSubtitleTrack, undefined, encodedPath);
                        }

                        videoPlayer.play().catch(e => console.log("Autoplay blocked", e));
                    });
            }); 
    }

    function highlightLastPlayed(path) {
        document.querySelectorAll('.last-played-indicator').forEach(el => el.remove());
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('active'));
        
        const items = Array.from(document.querySelectorAll('.video-item'));
        const item = items.find(el => el.dataset.path === path);
        
        if (item) {
            item.classList.add('active');
            const indicator = document.createElement('span');
            indicator.className = 'last-played-indicator';
            indicator.textContent = ' 👁️ Last Played';
            item.appendChild(indicator);
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // --- Settings Menu System ---

    settingsBtn.onclick = (e) => {
        e.stopPropagation();
        // Toggle display
        if (settingsMenu.style.display === 'block') {
            settingsMenu.style.display = 'none';
        } else {
            settingsMenu.style.display = 'block';
            showPanel('settings-main');
        }
    };

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
            settingsMenu.style.display = 'none';
        }
    });

    window.showPanel = function(panelId) {
        document.querySelectorAll('.settings-panel').forEach(p => {
            p.classList.add('hidden');
            p.style.display = 'none';
        });
        const target = document.getElementById(panelId);
        if(target) {
            target.classList.remove('hidden');
            target.style.display = 'block';
        }
    };

    // Main Menu Nav
    document.getElementById('row-speed').onclick = (e) => { e.stopPropagation(); showPanel('panel-speed'); };
    document.getElementById('row-audio').onclick = (e) => { e.stopPropagation(); showPanel('panel-audio'); };
    document.getElementById('row-subs').onclick = (e) => { e.stopPropagation(); showPanel('panel-subs'); };

    // Back Buttons
    document.querySelectorAll('.menu-header').forEach(h => {
        h.onclick = (e) => { e.stopPropagation(); showPanel('settings-main'); };
    });

    // Speed Logic
    document.querySelectorAll('#panel-speed .option').forEach(opt => {
        opt.onclick = (e) => {
            e.stopPropagation();
            const speed = parseFloat(opt.dataset.val);
            videoPlayer.playbackRate = speed;
            updateSpeedSelection(speed);
            showPanel('settings-main');
        };
    });

    function updateSpeedSelection(speed) {
        document.getElementById('speed-value').textContent = speed === 1 ? 'Normal' : speed + 'x';
        document.querySelectorAll('#panel-speed .option').forEach(o => {
            o.classList.remove('selected');
            if (parseFloat(o.dataset.val) === speed) o.classList.add('selected');
        });
    }

    // Audio Logic
    function setupAudioMenu(tracks) {
        const row = document.getElementById('row-audio');
        const list = document.getElementById('audio-list');
        list.innerHTML = '';
        
        if (!tracks || tracks.length <= 1) {
            row.style.display = 'none';
            return;
        }
        row.style.display = 'flex';

        // Auto-select based on preference if not already set
        if (currentAudioTrack === null) {
            const pref = localStorage.getItem('audioLangPref');
            if (pref) {
                const match = tracks.find(t => t.language === pref);
                if (match) {
                    currentAudioTrack = match.index;
                    const langDisp = match.language === 'und' ? `Track ${tracks.indexOf(match)+1}` : match.language.toUpperCase();
                    document.getElementById('audio-value').textContent = langDisp;
                }
            }
        }

        tracks.forEach((track, i) => {
            const div = document.createElement('div');
            div.className = 'option';
            const lang = track.language === 'und' ? `Track ${i+1}` : track.language.toUpperCase();
            div.textContent = `${lang} ${track.title ? '- ' + track.title : ''}`;
            
            // Check against track.index for correct selection highlighting
            if (track.index === currentAudioTrack) div.classList.add('selected');
            
            div.onclick = (e) => {
                e.stopPropagation();
                if (currentAudioTrack === track.index) return;
                
                // Save Preference
                localStorage.setItem('audioLangPref', track.language);

                currentAudioTrack = track.index;
                document.getElementById('audio-value').textContent = lang;
                
                // Reload for audio change
                let t = videoPlayer.currentTime;
                if (isTranscoding) t += streamOffset;
                
                if (!isTranscoding) {
                    isTranscoding = true; 
                    transcodeToggle.checked = true;
                }
                
                streamOffset = t;
                const encodedPath = encodeURIComponent(currentVideoPath);
                // Fix: use track.index NOT loop index i
                videoPlayer.src = `/stream/${encodedPath}?startTime=${t}&vCodec=${currentVideoCodec || ''}&audioIndex=${track.index}`;
                
                if (currentSubtitleTrack !== -1) {
                    enableSubtitle(currentSubtitleTrack, undefined, encodedPath);
                }

                videoPlayer.play();
                showPanel('settings-main');
            };
            list.appendChild(div);
        });
    }

    // Subtitle Logic
    function setupSubtitleMenu(tracks, encodedPath) {
        const row = document.getElementById('row-subs');
        const list = document.getElementById('subs-list');
        availableSubtitles = tracks || [];
        list.innerHTML = '';
        
        if (!tracks || tracks.length === 0) {
            row.style.display = 'none';
            ccBtn.style.display = 'none'; 
            return;
        }
        row.style.display = 'flex';
        ccBtn.style.display = 'block';

        // Auto-select based on preference
        if (currentSubtitleTrack === -1) {
            const pref = localStorage.getItem('subLangPref');
            if (pref && pref !== 'off') {
                const match = tracks.find(t => t.language === pref);
                if (match) {
                     currentSubtitleTrack = match.index;
                     document.getElementById('subs-value').textContent = match.language.toUpperCase();
                }
            } else {
                document.getElementById('subs-value').textContent = 'Off';
            }
        }

        // Add Off Option
        const offDiv = document.createElement('div');
        offDiv.className = 'option';
        offDiv.textContent = 'Off';
        if (currentSubtitleTrack === -1) offDiv.classList.add('selected');
        offDiv.onclick = (e) => {
             e.stopPropagation();
             localStorage.setItem('subLangPref', 'off');
             disableSubtitles();
             showPanel('settings-main');
        };
        list.appendChild(offDiv);

        tracks.forEach((track, i) => {
            const div = document.createElement('div');
            div.className = 'option';
            const lang = track.language === 'und' ? `Sub ${i+1}` : track.language.toUpperCase();
            div.textContent = `${lang} ${track.title ? '- ' + track.title : ''}`;
            
            if (track.index === currentSubtitleTrack) div.classList.add('selected');

            div.onclick = (e) => {
                e.stopPropagation();
                localStorage.setItem('subLangPref', track.language);
                enableSubtitle(track.index, i, encodedPath); // stored index vs array index
                showPanel('settings-main');
            };
            list.appendChild(div);
        });
    }

    function disableSubtitles() {
        currentSubtitleTrack = -1;
        removeSubtitleTracks();
        
        // UI Updates
        document.getElementById('subs-value').textContent = 'Off';
        
        const list = document.getElementById('subs-list');
        Array.from(list.children).forEach(c => c.classList.remove('selected'));
        if(list.children[0]) list.children[0].classList.add('selected');

        ccBtn.querySelector('.red-line').style.display = 'block';
        ccBtn.style.opacity = '0.7';
    }

    function enableSubtitle(streamIndex, arrayIndex, encodedPath) {
         currentSubtitleTrack = streamIndex;
         
         // Remove old tracks reliably
         removeSubtitleTracks(); 
         
         const idx = arrayIndex !== undefined ? arrayIndex : availableSubtitles.findIndex(t => t.index === streamIndex);
         const trackInfo = availableSubtitles[idx];
         if (!trackInfo) return;

         const trackEl = document.createElement('track');
         trackEl.kind = 'subtitles';
         trackEl.label = trackInfo.title || `Track ${streamIndex}`;
         trackEl.srclang = trackInfo.language;
         
         // Use a slight "fudge" factor (0.1s) to help browser sync if packets are slightly off
         let src = `/api/subtitles/${encodedPath}?streamIndex=${streamIndex}`;
         if (isTranscoding && streamOffset > 0) {
             src += `&startTime=${streamOffset}`;
         }
         trackEl.src = src;
         
         trackEl.default = true;
         
         // Event listener for load
         trackEl.onload = (e) => {
             console.log('Subtitle track loaded successfully');
             // Force showing immediately
             if(e.target.track) {
                 e.target.track.mode = 'showing';
                 
                 // HACK: Some browsers desync external VTT tracks when video src changes dynamically.
                 // We can try to force a re-alignment by toggling if it doesn't appear.
                 // But most likely the issue is the ffmpeg cut vs video keyframe difference.
             }
         };
         trackEl.addEventListener('error', (e) => {
             console.error('Subtitle track failed to load', e);
         });

         videoPlayer.appendChild(trackEl);
         
         // Immediate mode setting attempt
         setTimeout(() => {
             if (videoPlayer.textTracks && videoPlayer.textTracks[0]) {
                 videoPlayer.textTracks[0].mode = 'showing';
             }
         }, 100);
         
         // UI Updates
         const langName = trackInfo.language === 'und' ? `Sub ${idx+1}` : trackInfo.language.toUpperCase();
         document.getElementById('subs-value').textContent = langName;

         const list = document.getElementById('subs-list');
        Array.from(list.children).forEach(c => c.classList.remove('selected'));
        if(list.children[idx + 1]) list.children[idx + 1].classList.add('selected');

        ccBtn.querySelector('.red-line').style.display = 'none'; 
        ccBtn.style.opacity = '1';
    }

    // Quick Toggle CC
    ccBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentSubtitleTrack !== -1) {
            disableSubtitles();
        } else if (availableSubtitles.length > 0) {
            const encodedPath = encodeURIComponent(currentVideoPath);
            enableSubtitle(availableSubtitles[0].index, 0, encodedPath);
        }
    };


    // --- Player Controls (Play, Progress, Volume) ---

    // Toggle Play
    function togglePlay() {
        if (videoPlayer.paused || videoPlayer.ended) videoPlayer.play();
        else videoPlayer.pause();
    }
    
    playPauseBtn.addEventListener('click', togglePlay);
    videoPlayer.addEventListener('click', (e) => {
        if (settingsMenu.contains(e.target) || e.target === settingsBtn) return;
        togglePlay();
    });

    videoPlayer.addEventListener('play', () => {
         playPauseBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#fff"/></svg>';
         isDragging = false; // Reset drag state to ensure updates resume
         showControls();
    });
    
    videoPlayer.addEventListener('pause', () => {
         playPauseBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';
         showControls();
    });

    // Mute
    muteBtn.addEventListener('click', () => {
        videoPlayer.muted = !videoPlayer.muted;
        const iconPath = muteBtn.querySelector('path');
        if (videoPlayer.muted) {
            iconPath.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
        } else {
            iconPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
        }
    });
    
    volumeSlider.addEventListener('input', (e) => {
        videoPlayer.volume = e.target.value;
    });

    // Progress
    function updateProgress() {
        if (!isDragging && currentVideoPath) {
            let currentTime = videoPlayer.currentTime;
            let duration = videoPlayer.duration;
            
            if (isTranscoding) {
                 duration = totalDuration;
                 currentTime = streamOffset + videoPlayer.currentTime;
            }

            // Guard against NaN / Infinity / zero durations
            if (!duration || !isFinite(duration) || isNaN(duration)) duration = totalDuration || 1;
            if (isNaN(currentTime) || !isFinite(currentTime)) currentTime = streamOffset || 0;
            
            const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
            progressBar.style.width = `${percent}%`;
            timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
    }
    
    videoPlayer.addEventListener('timeupdate', updateProgress);
    
    // Fallback for sluggish timeupdate in compatibility mode
    setInterval(() => {
        if (isTranscoding && !videoPlayer.paused) {
            updateProgress();
        }
    }, 100);

    // Seek Drag
    progressBarContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleSeek(e, false);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) handleSeek(e, false);
    });
    
    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            handleSeek(e, true);
            isDragging = false;
        }
    });

    function captureFrame() {
        if (!seekOverlay) return;

        // Only capture a new frame if we have valid video data to show.
        // If we are already seeking (overlay visible) or video is not ready, keep the old frame.
        if (seekOverlay.style.display !== 'block' && videoPlayer.readyState >= 2) {
             seekOverlay.width = videoPlayer.videoWidth;
             seekOverlay.height = videoPlayer.videoHeight;
             const ctx = seekOverlay.getContext('2d');
             ctx.drawImage(videoPlayer, 0, 0, seekOverlay.width, seekOverlay.height);
             seekOverlay.style.display = 'block';
        }
    }

    function clearFrame() {
        if (seekOverlay) {
            seekOverlay.style.display = 'none';
        }
    }
    
    // Add event listener to clear overlay when new video starts playing
    videoPlayer.addEventListener('loadeddata', clearFrame);
    // Also clear on error just in case
    videoPlayer.addEventListener('error', clearFrame);

    function handleSeek(e, commit) {
        const rect = progressBarContainer.getBoundingClientRect();
        const maxDuration = (isTranscoding && totalDuration) ? totalDuration : (videoPlayer.duration || 0);
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));
        
        const newTime = pos * maxDuration;
        
        progressBar.style.width = `${pos * 100}%`;
        // Optimistically update time display
        timeDisplay.textContent = `${formatTime(newTime)} / ${formatTime(maxDuration)}`;
        
        if (commit) {
            if (isTranscoding) {
                // Buffer seek
                streamOffset = newTime;
                
                // Keep the current frame visible
                captureFrame();
                
                // Clear existing tracks
                removeSubtitleTracks();

                const encodedPath = encodeURIComponent(currentVideoPath);
                let url = `/stream/${encodedPath}?startTime=${newTime}&vCodec=${currentVideoCodec || ''}`;
                if(currentAudioTrack !== null) url += `&audioIndex=${currentAudioTrack}`;
                
                videoPlayer.src = url;
                
                if (currentSubtitleTrack !== -1) {
                     enableSubtitle(currentSubtitleTrack, undefined, encodedPath);
                }

                // Attempt to play immediately
                const p = videoPlayer.play();
                if (p) p.catch(e => console.log("Seek play suppressed", e));

            } else {
                videoPlayer.currentTime = newTime;
            }
        }
    }
    
    // Formatting
    function formatTime(seconds) {
        if(isNaN(seconds) || !isFinite(seconds) || seconds < 0) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const h = Math.floor(m / 60);
        
        if (h > 0) return `${h}:${(m%60).toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        return `${m}:${s.toString().padStart(2,'0')}`;
    }

    // Fullscreen
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) playerContainer.requestFullscreen();
        else document.exitFullscreen();
    });
    
    playerContainer.addEventListener('dblclick', (e) => {
        if (settingsMenu.contains(e.target)) return;
        fullscreenBtn.click();
    });

    // Control Visibility
    function showControls() {
        controls.className = 'controls'; // Ensure visible class
        controls.style.opacity = '1';
        playerContainer.style.cursor = 'default';
        
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(() => {
            if (!videoPlayer.paused && !controls.matches(':hover') && !settingsMenu.contains(document.activeElement)) {
                controls.style.opacity = '0';
                playerContainer.style.cursor = 'none';
            }
        }, 3000);
    }
    
    playerContainer.addEventListener('mousemove', showControls);
    playerContainer.addEventListener('click', showControls);

    // Save Progress Interval
    setInterval(() => {
        if (!videoPlayer.paused && currentVideoPath) {
            let t = videoPlayer.currentTime;
            if (isTranscoding) t = streamOffset + videoPlayer.currentTime;
            saveProgress(undefined, t);
        }
    }, 5000);

    function saveProgress(path, time) {
        const p = path || currentVideoPath;
        const t = (time !== undefined) ? time : videoPlayer.currentTime;
        if (!p) return;
        fetch('/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: p, timestamp: t }),
        });
    }

    // Directory Browser
    folderBtn.onclick = () => { 
        modal.style.display = "block"; 
        // Load current config into input
        fetch('/api/config')
            .then(r => r.json())
            .then(config => {
                if(config.video_directory) dirInput.value = config.video_directory;
            });
    };
    
    browseBtn.onclick = () => {
        fetch('/api/choose-directory', { method: 'POST' })
            .then(r => r.json())
            .then(data => {
                if (data.path) {
                    dirInput.value = data.path;
                }
            });
    };

    closeSpan.onclick = () => { modal.style.display = "none"; };
    window.onclick = (event) => { if (event.target == modal) modal.style.display = "none"; };
    
    saveSettings.onclick = () => {
        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_directory: dirInput.value })
        }).then(() => {
            modal.style.display = "none";
            loadVideos();
        });
    }

    // Transcode Pref Toggle
    transcodeToggle.addEventListener('change', () => {
        isTranscoding = transcodeToggle.checked;
        localStorage.setItem('transcodePref', isTranscoding);
        if (currentVideoPath) {
            // Save pos and reload
            let t = videoPlayer.currentTime;
            if (!transcodeToggle.checked) t += streamOffset; // was transcoding
            saveProgress(currentVideoPath, t);
            
            const items = Array.from(document.querySelectorAll('.video-item'));
            const el = items.find(e => e.dataset.path === currentVideoPath);
            playVideo(currentVideoPath, el);
        }
    });

    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in an input field
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();

        if (key === ' ' || key === 'k') {
            e.preventDefault(); // Prevent scrolling
            togglePlay();
            showControls();
        } else if (key === 'f') {
            fullscreenBtn.click();
            showControls(); // Ensure controls are visible when entering/exiting
        } else if (key === 'm') {
            muteBtn.click();
            showControls();
        } else if (key === 'arrowright' || key === 'l') {
            e.preventDefault(); // Prevent scrolling
            seekRelative(5);
            showControls();
        } else if (key === 'arrowleft' || key === 'j') {
            e.preventDefault(); // Prevent scrolling
            seekRelative(-5);
            showControls();
        }
    });

    function seekRelative(seconds) {
        if (!currentVideoPath) return; // Only seek if a video is loaded

        let duration = isTranscoding ? totalDuration : videoPlayer.duration;
        let currentTime = isTranscoding ? (streamOffset + videoPlayer.currentTime) : videoPlayer.currentTime;

        if (!duration) duration = Infinity; // Safety

        let newTime = currentTime + seconds;
        newTime = Math.max(0, Math.min(duration, newTime));
        
        // Optimistic UI update
        progressBar.style.width = `${(newTime / (duration || 1)) * 100}%`;
        timeDisplay.textContent = `${formatTime(newTime)} / ${formatTime(duration)}`;

        if (isTranscoding) {
            // For transcoding, we update the stream offset and reload
            // This mirrors the handleSeek logic for consistency
            streamOffset = newTime;
            
            removeSubtitleTracks();
            
            // Keep last frame
            captureFrame();

            const encodedPath = encodeURIComponent(currentVideoPath);
            let url = `/stream/${encodedPath}?startTime=${newTime}&vCodec=${currentVideoCodec || ''}`;
            if(currentAudioTrack !== null) url += `&audioIndex=${currentAudioTrack}`;
            
            videoPlayer.src = url;
            
            if (currentSubtitleTrack !== -1) {
                 enableSubtitle(currentSubtitleTrack, undefined, encodedPath);
            }
            videoPlayer.play().catch(e => console.log("Seek play suppressed", e));
        } else {
            videoPlayer.currentTime = newTime;
        }
    }

    loadVideos();
});
