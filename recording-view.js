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

// Current zoom animation state (for cursor tracking)
let currentZoomState = {
    scale: 1,
    focusX: 0,  // Focus point in recorded coordinates
    focusY: 0,
    startTime: 0,
    phase: 'none', // 'zoomIn', 'hold', 'zoomOut', 'none'
    targetMoveX: 0, // Target translate X percentage
    targetMoveY: 0  // Target translate Y percentage
};

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
            console.log('Video dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
            const loading = document.getElementById('loading-overlay');
            if (loading) loading.style.display = 'none';
            
            // Resize wrapper to match video aspect ratio
            resizeWrapperToVideo();
            window.addEventListener('resize', resizeWrapperToVideo);
            
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

// Interpolated version for smooth cursor movement
function findMousePositionInterpolated(time) {
    if (mousePositions.length === 0) return null;
    if (mousePositions.length === 1) return mousePositions[0];
    
    // Find the two positions surrounding the current time
    let low = 0;
    let high = mousePositions.length - 1;
    
    // Binary search for the first position with time >= target
    while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (mousePositions[mid].time < time) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    
    // low is now the index of first position with time >= target
    const nextIndex = low;
    const prevIndex = Math.max(0, nextIndex - 1);
    
    const prev = mousePositions[prevIndex];
    const next = mousePositions[nextIndex];
    
    // If same point or at boundaries, return directly
    if (prevIndex === nextIndex || prev.time === next.time) {
        return prev;
    }
    
    // Interpolate between prev and next
    const t = (time - prev.time) / (next.time - prev.time);
    const clampedT = Math.max(0, Math.min(1, t));
    
    // Smooth interpolation using ease-out for more natural movement
    const smoothT = 1 - Math.pow(1 - clampedT, 2);
    
    return {
        x: prev.x + (next.x - prev.x) * smoothT,
        y: prev.y + (next.y - prev.y) * smoothT,
        time: time,
        click: prev.click || next.click // Pass click if either has it
    };
}

// Easing function for smooth zoom animations
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Resize wrapper to match video aspect ratio
function resizeWrapperToVideo() {
    const wrapper = document.querySelector('.video-preview-wrapper');
    const mainEditor = document.querySelector('.main-editor');
    const editorControls = document.querySelector('.editor-controls');
    
    if (!videoElement.videoWidth || !videoElement.videoHeight) return;
    
    const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
    
    // Calculate available space
    const mainRect = mainEditor.getBoundingClientRect();
    const controlsRect = editorControls.getBoundingClientRect();
    
    const availableWidth = mainRect.width - 40; // padding
    const availableHeight = mainRect.height - controlsRect.height - 60; // controls + gaps
    
    let wrapperWidth, wrapperHeight;
    
    // Fit within available space maintaining aspect ratio
    if (availableWidth / availableHeight > videoAspect) {
        // Height constrained
        wrapperHeight = availableHeight;
        wrapperWidth = wrapperHeight * videoAspect;
    } else {
        // Width constrained
        wrapperWidth = availableWidth;
        wrapperHeight = wrapperWidth / videoAspect;
    }
    
    wrapper.style.width = wrapperWidth + 'px';
    wrapper.style.height = wrapperHeight + 'px';
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

    // Interpolate mouse position for smooth movement
    const pos = findMousePositionInterpolated(currentTimeMs);
    if (pos) {
        // The wrapper now exactly matches the video aspect ratio
        // so the video fills the wrapper completely
        const wrapper = document.querySelector('.video-preview-wrapper');
        const wrapperRect = wrapper.getBoundingClientRect();
        
        // Display size = wrapper size since video fills it
        const displayWidth = wrapperRect.width;
        const displayHeight = wrapperRect.height;
        
        // The video's recorded dimensions
        const recordedWidth = videoElement.videoWidth;
        const recordedHeight = videoElement.videoHeight;

        if (recordedWidth === 0 || recordedHeight === 0) {
            requestAnimationFrame(updateLoop);
            return;
        }

        // Calculate scaling: mouse positions are in screen coordinates, video is also screen resolution
        const scaleX = displayWidth / recordedWidth;
        const scaleY = displayHeight / recordedHeight;

        // Position cursor with zoom transform applied
        let cursorX = pos.x;
        let cursorY = pos.y;
        
        // If zooming, transform cursor using same logic as export (crop-and-scale)
        if (currentZoomState.phase !== 'none') {
            const elapsed = Date.now() - currentZoomState.startTime;
            let progress = Math.min(1, elapsed / zoomDuration);
            const eased = easeInOutCubic(progress);
            
            let animatedScale;
            if (currentZoomState.phase === 'zoomIn') {
                animatedScale = 1 + (zoomLevel - 1) * eased;
            } else if (currentZoomState.phase === 'hold') {
                animatedScale = zoomLevel;
            } else if (currentZoomState.phase === 'zoomOut') {
                animatedScale = zoomLevel - (zoomLevel - 1) * eased;
            }
            
            // Use same crop-and-scale logic as export
            // Calculate the visible source rectangle (in recorded coordinates)
            const viewWidth = recordedWidth / animatedScale;
            const viewHeight = recordedHeight / animatedScale;
            
            // Center on focus point, clamped to bounds
            let srcX = currentZoomState.focusX - viewWidth / 2;
            let srcY = currentZoomState.focusY - viewHeight / 2;
            srcX = Math.max(0, Math.min(recordedWidth - viewWidth, srcX));
            srcY = Math.max(0, Math.min(recordedHeight - viewHeight, srcY));
            
            // Transform cursor from source coordinates to zoomed coordinates
            cursorX = (pos.x - srcX) * animatedScale;
            cursorY = (pos.y - srcY) * animatedScale;
        }
        
        // Scale to display coordinates
        cursorX *= scaleX;
        cursorY *= scaleY;
    
        cursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
        cursor.style.display = 'block';

        // Zoom Logic - only when we have a valid position
        if (autoZoomEnabled && !videoElement.paused) {
            if (pos.click && !isZooming) {
                isZooming = true;
                
                // Store zoom focus point for cursor tracking
                currentZoomState.focusX = pos.x;
                currentZoomState.focusY = pos.y;
                currentZoomState.startTime = Date.now();
                currentZoomState.phase = 'zoomIn';

                // Calculate the crop region for the video (same as cursor logic)
                const viewWidth = recordedWidth / zoomLevel;
                const viewHeight = recordedHeight / zoomLevel;
                let srcX = pos.x - viewWidth / 2;
                let srcY = pos.y - viewHeight / 2;
                srcX = Math.max(0, Math.min(recordedWidth - viewWidth, srcX));
                srcY = Math.max(0, Math.min(recordedHeight - viewHeight, srcY));
                
                // Convert to CSS transform: we need to translate so that srcX,srcY is at origin, then scale
                // The transform origin is center, so we compute the offset from center
                const centerX = recordedWidth / 2;
                const centerY = recordedHeight / 2;
                const srcCenterX = srcX + viewWidth / 2;
                const srcCenterY = srcY + viewHeight / 2;
                
                // How much to translate (in percentage of element size) after scaling
                // We want srcCenter to appear at display center
                // After scale(S), translate(X%, Y%) moves by X%*width, Y%*height
                const moveX = ((centerX - srcCenterX) / recordedWidth) * 100;
                const moveY = ((centerY - srcCenterY) / recordedHeight) * 100;
                
                // Store for consistency
                currentZoomState.targetMoveX = moveX;
                currentZoomState.targetMoveY = moveY;

                // Ultra smooth easing
                videoElement.style.transition = `transform ${zoomDuration}ms cubic-bezier(0.37, 0, 0.63, 1)`;
                videoElement.style.transform = `scale(${zoomLevel}) translate(${moveX}%, ${moveY}%)`;
                
                // Transition to hold phase
                setTimeout(() => {
                    currentZoomState.phase = 'hold';
                }, zoomDuration);
                
                // Hold zoom, then animate OUT
                setTimeout(() => {
                    currentZoomState.startTime = Date.now();
                    currentZoomState.phase = 'zoomOut';
                    
                    videoElement.style.transition = `transform ${zoomDuration}ms cubic-bezier(0.37, 0, 0.63, 1)`;
                    videoElement.style.transform = 'scale(1) translate(0, 0)';
                    
                    setTimeout(() => { 
                        isZooming = false; 
                        currentZoomState.phase = 'none';
                        currentZoomState.scale = 1;
                    }, zoomDuration);
                }, 1000 + zoomDuration);
            }
        }
    }
    
    requestAnimationFrame(updateLoop);
}

document.getElementById('saveBtn').addEventListener('click', async () => {
    const duration = videoElement.duration;
    const startSec = trimStart * duration;
    const endSec = trimEnd * duration;
    const trimDuration = endSec - startSec;
    
    // Show a save dialog
    const exportPath = await ipcRenderer.invoke('show-save-dialog', {
        defaultPath: `promo-${Date.now()}.mp4`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    });
    
    if (exportPath.canceled) return;
    
    const outputPath = exportPath.filePath;
    
    // Show export overlay
    const overlay = document.getElementById('export-overlay');
    overlay.style.display = 'flex';
    
    // Start rendering video with effects
    ipcRenderer.send('export-video-with-effects', {
        videoPath: currentVideoPath,
        outputPath: outputPath,
        mouseData: mousePositions,
        trimStart: startSec,
        trimDuration: trimDuration,
        zoomLevel: zoomLevel,
        zoomDuration: zoomDuration,
        autoZoomEnabled: autoZoomEnabled
    });
});

// Handle export progress updates
ipcRenderer.on('export-progress', (event, progress) => {
    const stageText = document.getElementById('export-stage');
    const progressBar = document.getElementById('export-progress-bar');
    const percent = document.getElementById('export-percent');
    
    const stageNames = {
        'extracting': 'Extracting frames from video...',
        'processing': 'Applying cursor and zoom effects...',
        'encoding': 'Encoding final video...',
        'complete': 'Complete!'
    };
    
    stageText.textContent = stageNames[progress.stage] || progress.stage;
    progressBar.style.width = progress.progress + '%';
    percent.textContent = Math.round(progress.progress) + '%';
});

// Handle export completion
ipcRenderer.on('export-complete', (event, result) => {
    const overlay = document.getElementById('export-overlay');
    overlay.style.display = 'none';
    
    if (result.success) {
        alert('Video exported successfully!\nSaved to: ' + result.path);
    } else {
        alert('Export failed: ' + result.error);
    }
});
