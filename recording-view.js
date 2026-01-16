const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Cursor hotspot offsets (pixels) to align the SVG tip with the actual pointer
const CURSOR_HOTSPOT_X = 8;
const CURSOR_HOTSPOT_Y = 6;

let mousePositions = [];
let videoElement = null;
let cursor = null;
let currentVideoPath = '';

// Editor State
let trimStart = 0;
let trimEnd = 1; // Normalized 0-1
let isDragging = null;
let zoomLevel = 1.5;
let zoomDuration = 300;
let autoZoomEnabled = true;
let isZooming = false;
let lastZoomTime = 0;

window.addEventListener('DOMContentLoaded', async () => {
    // Get DOM elements after page loads
    videoElement = document.getElementById('player');
    cursor = document.getElementById('purple-cursor');
    
    const params = new URLSearchParams(window.location.search);
    currentVideoPath = params.get('video');
    const mouseDataPath = params.get('mouse');

    console.log('Previewing video:', currentVideoPath);
    console.log('Mouse data:', mouseDataPath);

    if (currentVideoPath) {
        try {
            // Use blob method that we know works
            console.log('Attempting to load video from:', currentVideoPath);
            const videoData = fs.readFileSync(currentVideoPath);
            console.log('File read successfully, size:', videoData.length, 'bytes');
            
            const blob = new Blob([videoData], { type: 'video/mp4' });
            console.log('Blob created, size:', blob.size, 'bytes');
            
            const blobUrl = URL.createObjectURL(blob);
            console.log('Object URL created:', blobUrl);
            console.log('Video element exists?', videoElement ? 'YES' : 'NO');
            
            videoElement.src = blobUrl;
            console.log('src set, calling load()');
            videoElement.load();
            console.log('load() called');
        } catch (error) {
            console.error('Failed to load video:', error);
            console.error('Error stack:', error.stack);
            alert('Error loading video: ' + error.message);
        }
        
        videoElement.addEventListener('loadedmetadata', () => {
            console.log('Video metadata loaded successfully');
            const loading = document.getElementById('loading-overlay');
            if (loading) loading.style.display = 'none';
            videoElement.play().catch(e => console.warn('Autoplay blocked:', e));
            const playIcon = document.getElementById('play-icon');
            const pauseIcon = document.getElementById('pause-icon');
            if (playIcon) playIcon.style.display = 'none';
            if (pauseIcon) pauseIcon.style.display = 'block';
        });

        videoElement.addEventListener('error', (e) => {
            const loading = document.getElementById('loading-overlay');
            if (loading) loading.style.display = 'none';
            const err = videoElement.error;
            let msg = 'Unknown Media Error';
            if (err) {
                switch (err.code) {
                    case 1: msg = 'Aborted: The fetching process was aborted by the user.'; break;
                    case 2: msg = 'Network: A network error occurred while fetching the resource.'; break;
                    case 3: msg = 'Decode: An error occurred while decoding the media resource.'; break;
                    case 4: msg = 'SrcNotSupported: The media resource was not suitable or format not supported.'; break;
                }
            }
            console.error('Video Error:', msg, err);
            
            // On-screen debug
            const container = document.getElementById('container');
            let debugNode = document.getElementById('debug-error-display');
            if (!debugNode) {
                debugNode = document.createElement('div');
                debugNode.id = 'debug-error-display';
                debugNode.style.cssText = 'position:absolute; top:20px; left:20px; right:20px; color:white; background:rgba(200,0,0,0.9); padding:15px; border-radius:8px; z-index:10000; font-family:monospace; font-size:12px; border: 2px solid white;';
                container.appendChild(debugNode);
            }
            debugNode.innerHTML = `
                <div style="font-weight:bold; font-size:14px; margin-bottom:10px;">PREVIEW LOAD FAILED</div>
                <div><b>Error:</b> ${msg}</div>
                <div><b>Result:</b> ${err ? err.message : 'No message'}</div>
                <div style="margin-top:10px; word-break:break-all;"><b>Requested Path:</b> ${currentVideoPath}</div>
                <div style="margin-top:10px; color:#ffdddd;">* Try restarting the app if this persists.</div>
            `;
        });
    }

    if (mouseDataPath) {
        try {
            const data = JSON.parse(fs.readFileSync(mouseDataPath, 'utf8'));
            mousePositions = data.positions;
            cursor.style.display = 'block';
        } catch (e) {
            console.error('Failed to load mouse data:', e);
        }
    }

    setupPlaybackControls();
    setupTimeline();
    setupSettings();
    requestAnimationFrame(updateLoop);
});

function setupPlaybackControls() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const skipForward = document.getElementById('skipForwardBtn');
    const skipBack = document.getElementById('skipBackBtn');

    playPauseBtn.addEventListener('click', () => {
        if (videoElement.paused) {
            videoElement.play();
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        } else {
            videoElement.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    });

    skipForward.addEventListener('click', () => {
        videoElement.currentTime += 5;
    });

    skipBack.addEventListener('click', () => {
        videoElement.currentTime -= 5;
    });

    videoElement.addEventListener('ended', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        videoElement.currentTime = trimStart * videoElement.duration;
    });
}

function setupTimeline() {
    const timeline = document.getElementById('timeline');
    const handleStart = document.getElementById('handle-start');
    const handleEnd = document.getElementById('handle-end');
    const trimRegion = document.getElementById('trim-region');

    const updateTrimUI = () => {
        handleStart.style.left = (trimStart * 100) + '%';
        handleEnd.style.right = (100 - trimEnd * 100) + '%';
        trimRegion.style.left = (trimStart * 100) + '%';
        trimRegion.style.width = ((trimEnd - trimStart) * 100) + '%';
    };

    const handleMouseDown = (e, type) => {
        isDragging = type;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        const rect = timeline.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));

        if (isDragging === 'start') {
            trimStart = Math.min(pos, trimEnd - 0.05);
        } else if (isDragging === 'end') {
            trimEnd = Math.max(pos, trimStart + 0.05);
        } else if (isDragging === 'playhead') {
            if (videoElement.duration) {
                videoElement.currentTime = pos * videoElement.duration;
            }
        }
        updateTrimUI();
    };

    const handleMouseUp = () => {
        isDragging = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    handleStart.addEventListener('mousedown', (e) => handleMouseDown(e, 'start'));
    handleEnd.addEventListener('mousedown', (e) => handleMouseDown(e, 'end'));
    timeline.addEventListener('mousedown', (e) => {
        if (e.target === timeline || e.target.id === 'timeline-track' || e.target.id === 'trim-region') {
            handleMouseDown(e, 'playhead');
            handleMouseMove(e);
        }
    });
}

function setupSettings() {
    const zlRange = document.getElementById('zoomLevelRange');
    const zsRange = document.getElementById('zoomSpeedRange');
    const autoCheck = document.getElementById('autoZoomCheck');

    zlRange.addEventListener('input', (e) => {
        zoomLevel = parseFloat(e.target.value);
        document.getElementById('zoomLevelVal').textContent = zoomLevel + 'x';
    });

    zsRange.addEventListener('input', (e) => {
        zoomDuration = parseInt(e.target.value);
        document.getElementById('zoomSpeedVal').textContent = zoomDuration + 'ms';
        videoElement.style.transition = `transform ${zoomDuration}ms ease-in-out`;
    });

    autoCheck.addEventListener('change', (e) => {
        autoZoomEnabled = e.target.checked;
        if (!autoZoomEnabled) {
            videoElement.style.transform = 'scale(1) translate(0, 0)';
            isZooming = false;
        }
    });

    videoElement.style.transition = `transform ${zoomDuration}ms ease-in-out`;
}

function findMousePosition(time) {
    let low = 0;
    let high = mousePositions.length - 1;
    let bestIndex = -1;

    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (mousePositions[mid].time >= time) {
            bestIndex = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return bestIndex !== -1 ? mousePositions[bestIndex] : null;
}

function updateLoop() {
    if (mousePositions.length === 0) {
        requestAnimationFrame(updateLoop);
        return;
    }

    const currentTimeMs = videoElement.currentTime * 1000;
    const playhead = document.getElementById('playhead');
    if (videoElement.duration) {
        playhead.style.left = (videoElement.currentTime / videoElement.duration * 100) + '%';
    }

    // Loop within trim points
    if (!videoElement.paused && videoElement.duration) {
        const startSec = trimStart * videoElement.duration;
        const endSec = trimEnd * videoElement.duration;
        if (videoElement.currentTime < startSec) videoElement.currentTime = startSec;
        if (videoElement.currentTime > endSec) {
            videoElement.currentTime = startSec;
        }
    }

    const pos = findMousePosition(currentTimeMs);
    if (pos) {
        // Use the actual drawn video rect to avoid letterboxing errors from object-fit: contain
        const videoRect = videoElement.getBoundingClientRect();
        const recordedWidth = videoElement.videoWidth;
        const recordedHeight = videoElement.videoHeight;

        if (recordedWidth === 0 || recordedHeight === 0) {
            requestAnimationFrame(updateLoop);
            return;
        }

        const scaleX = videoRect.width / recordedWidth;
        const scaleY = videoRect.height / recordedHeight;

        // Clamp inside the rendered area to avoid drifting into letterbox space
        let targetX = videoRect.left + (pos.x * scaleX) - CURSOR_HOTSPOT_X;
        let targetY = videoRect.top + (pos.y * scaleY) - CURSOR_HOTSPOT_Y;
        targetX = Math.max(videoRect.left - CURSOR_HOTSPOT_X, Math.min(videoRect.right - CURSOR_HOTSPOT_X, targetX));
        targetY = Math.max(videoRect.top - CURSOR_HOTSPOT_Y, Math.min(videoRect.bottom - CURSOR_HOTSPOT_Y, targetY));
    
        cursor.style.transform = `translate(${targetX}px, ${targetY}px)`;
        cursor.style.display = 'block';
    }

    // Zoom Logic
    if (autoZoomEnabled && !videoElement.paused) {
        // Check if there was a click recently or if we are currently over one
        // We look back a bit to catch the start of the click event
        if (pos.click && !isZooming) {
            isZooming = true;
            
            // Calculate center offset for zoom based on rendered rect
            const videoRect = videoElement.getBoundingClientRect();
            const recordedWidth = videoElement.videoWidth;
            const recordedHeight = videoElement.videoHeight;

            const normX = (pos.x / recordedWidth) - 0.5;
            const normY = (pos.y / recordedHeight) - 0.5;
        
            // Move the video in the opposite direction of the mouse offset
            const moveX = -normX * 100 * zoomLevel; 
            const moveY = -normY * 100 * zoomLevel;

            videoElement.style.transform = `scale(${zoomLevel}) translate(${moveX}%, ${moveY}%)`;
            
            setTimeout(() => {
                videoElement.style.transform = 'scale(1) translate(0, 0)';
                setTimeout(() => { isZooming = false; }, zoomDuration);
            }, 1000); // Hold zoom for 1 second
        }
    }
    
    requestAnimationFrame(updateLoop);
}

document.getElementById('saveBtn').addEventListener('click', () => {
    const duration = videoElement.duration;
    const startSec = trimStart * duration;
    const endSec = trimEnd * duration;
    
    const trimInfo = {
        start: startSec,
        duration: endSec - startSec
    };

    ipcRenderer.send('save-video-to-downloads', currentVideoPath, trimInfo);
});
