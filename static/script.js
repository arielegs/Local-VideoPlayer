document.addEventListener('DOMContentLoaded', () => {
    const videoList = document.getElementById('video-list');
    const videoPlayer = document.getElementById('video-player');
    const modal = document.getElementById('settings-modal');
    const btn = document.getElementById("folder-btn");
    const span = document.getElementsByClassName("close")[0];
    const saveSettings = document.getElementById("save-settings");
    const dirInput = document.getElementById("video-dir-input");
    
    let currentVideoPath = null;
    
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
});