const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let mousePositions = [];
let videoElement = null;
let cursor = null;
let currentVideoPath = '';

// Editor State
let trimStart = 0;
let trimEnd = 1;
let isDragging = null;

// Cursor settings
let cursorSettings = {
    style: 'windows',  // windows, mac, dot, ring, square, crosshair
    color: '#a855f7',
    size: 24
};

// Zoom settings (defaults)
let defaultZoomLevel = 1.5;
let defaultZoomSpeed = 300;
let defaultZoomHold = 1000;
let autoZoomEnabled = true;

// Per-click zoom events array
let zoomEvents = [];
let selectedZoomIndex = -1;

// Current zoom animation state
let currentZoomState = {
    scale: 1,
    focusX: 0,
    focusY: 0,
    startTime: 0,
    phase: 'none',
    targetMoveX: 0,
    targetMoveY: 0,
    eventIndex: -1
};

window.addEventListener('DOMContentLoaded', async () => {
    videoElement = document.getElementById('player');
    cursor = document.getElementById('purple-cursor');
    
    const params = new URLSearchParams(window.location.search);
    currentVideoPath = params.get('video');
    const mouseDataPath = params.get('mouse');

    if (currentVideoPath) {
        try {
            const videoData = fs.readFileSync(currentVideoPath);
            const blob = new Blob([videoData], { type: 'video/mp4' });
            const blobUrl = URL.createObjectURL(blob);
            videoElement.src = blobUrl;
            videoElement.load();
        } catch (error) {
            console.error('Failed to load video:', error);
            alert('Error loading video: ' + error.message);
        }
        
        videoElement.addEventListener('loadedmetadata', () => {
            console.log('Video loaded:', videoElement.videoWidth, 'x', videoElement.videoHeight);
            resizeWrapperToVideo();
            window.addEventListener('resize', resizeWrapperToVideo);
            
            videoElement.play().catch(e => console.warn('Autoplay blocked:', e));
            document.getElementById('play-icon').style.display = 'none';
            document.getElementById('pause-icon').style.display = 'block';
            
            // Initialize zoom timeline after video loads
            renderZoomTimeline();
        });

        videoElement.addEventListener('error', (e) => {
            console.error('Video Error:', videoElement.error);
        });
    }

    if (mouseDataPath) {
        try {
            const data = JSON.parse(fs.readFileSync(mouseDataPath, 'utf8'));
            mousePositions = data.positions;
            
            // Extract click events as zoom events
            initializeZoomEvents();
            
            cursor.style.display = 'block';
            updateCursorAppearance();
        } catch (e) {
            console.error('Failed to load mouse data:', e);
        }
    }

    setupPlaybackControls();
    setupTimeline();
    setupCursorSettings();
    setupZoomSettings();
    setupZoomTimeline();
    requestAnimationFrame(updateLoop);
});

// Initialize zoom events from recorded clicks
function initializeZoomEvents() {
    zoomEvents = [];
    for (let i = 0; i < mousePositions.length; i++) {
        if (mousePositions[i].click) {
            zoomEvents.push({
                time: mousePositions[i].time,
                x: mousePositions[i].x,
                y: mousePositions[i].y,
                zoomLevel: defaultZoomLevel,
                zoomSpeed: defaultZoomSpeed,
                holdDuration: defaultZoomHold,
                enabled: true
            });
        }
    }
    console.log(`Found ${zoomEvents.length} click events`);
}

function setupPlaybackControls() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

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

    document.getElementById('skipForwardBtn').addEventListener('click', () => {
        videoElement.currentTime += 5;
    });

    document.getElementById('skipBackBtn').addEventListener('click', () => {
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
        renderZoomTimeline();
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

function setupCursorSettings() {
    // Cursor style options
    document.querySelectorAll('.cursor-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.cursor-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            cursorSettings.style = option.dataset.cursor;
            updateCursorAppearance();
        });
    });
    
    // Color swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            cursorSettings.color = swatch.dataset.color;
            document.getElementById('custom-color').value = cursorSettings.color;
            updateCursorAppearance();
        });
    });
    
    // Custom color picker
    document.getElementById('custom-color').addEventListener('input', (e) => {
        cursorSettings.color = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        updateCursorAppearance();
    });
    
    // Cursor size
    document.getElementById('cursorSize').addEventListener('input', (e) => {
        cursorSettings.size = parseInt(e.target.value);
        document.getElementById('cursorSizeVal').textContent = cursorSettings.size + 'px';
        updateCursorAppearance();
    });
}

function updateCursorAppearance() {
    const size = cursorSettings.size;
    const color = cursorSettings.color;
    
    cursor.innerHTML = '';
    cursor.style.width = size + 'px';
    cursor.style.height = size + 'px';
    
    switch (cursorSettings.style) {
        case 'windows':
            cursor.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
                <path d="M5.65376 12.3673L15.1533 17.8692C16.5741 18.6918 18.2562 17.3753 17.7812 15.8231L13.8827 3.08381C13.4357 1.62319 11.4116 1.48705 10.761 2.8722L5.27181 14.5458C4.69678 15.7686 5.86561 17.1524 7.15376 16.5161L5.65376 12.3673Z" fill="${color}" stroke="white" stroke-width="1.5"/>
            </svg>`;
            break;
        case 'mac':
            cursor.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}">
                <path d="M7,2L17,12L12,12L15,22L5,12L10,12L7,2Z" stroke="white" stroke-width="1"/>
            </svg>`;
            break;
        case 'dot':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:50%; border:2px solid white; box-sizing:border-box;"></div>`;
            break;
        case 'ring':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; border:3px solid ${color}; border-radius:50%; box-sizing:border-box; box-shadow: 0 0 0 1px white inset, 0 0 0 1px white;"></div>`;
            break;
        case 'square':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:3px; border:2px solid white; box-sizing:border-box;"></div>`;
            break;
        case 'crosshair':
            const half = size / 2;
            cursor.innerHTML = `<div style="position:relative; width:${size}px; height:${size}px;">
                <div style="position:absolute; width:2px; height:${size}px; left:${half-1}px; top:0; background:${color}; box-shadow: 0 0 0 1px white;"></div>
                <div style="position:absolute; height:2px; width:${size}px; top:${half-1}px; left:0; background:${color}; box-shadow: 0 0 0 1px white;"></div>
            </div>`;
            break;
    }
}

function setupZoomSettings() {
    // Default zoom settings
    const defaultLevelRange = document.getElementById('defaultZoomLevel');
    const defaultSpeedRange = document.getElementById('defaultZoomSpeed');
    const autoCheck = document.getElementById('autoZoomCheck');
    
    if (defaultLevelRange) {
        defaultLevelRange.addEventListener('input', (e) => {
            defaultZoomLevel = parseFloat(e.target.value);
            document.getElementById('defaultZoomLevelVal').textContent = defaultZoomLevel + 'x';
        });
    }
    
    if (defaultSpeedRange) {
        defaultSpeedRange.addEventListener('input', (e) => {
            defaultZoomSpeed = parseInt(e.target.value);
            document.getElementById('defaultZoomSpeedVal').textContent = defaultZoomSpeed + 'ms';
        });
    }
    
    if (autoCheck) {
        autoCheck.addEventListener('change', (e) => {
            autoZoomEnabled = e.target.checked;
            if (!autoZoomEnabled) {
                videoElement.style.transform = 'scale(1) translate(0, 0)';
                currentZoomState.phase = 'none';
            }
        });
    }
    
    // Selected zoom settings (in panel)
    const selectedZoomLevel = document.getElementById('selectedZoomLevel');
    const selectedZoomSpeed = document.getElementById('selectedZoomSpeed');
    const selectedZoomHold = document.getElementById('selectedZoomHold');
    const zoomPanelClose = document.getElementById('zoom-panel-close');
    const deleteZoomBtn = document.getElementById('delete-zoom-btn');
    
    if (selectedZoomLevel) {
        selectedZoomLevel.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById('selectedZoomLevelVal').textContent = val + 'x';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].zoomLevel = val;
            }
        });
    }
    
    if (selectedZoomSpeed) {
        selectedZoomSpeed.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('selectedZoomSpeedVal').textContent = val + 'ms';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].zoomSpeed = val;
            }
        });
    }
    
    if (selectedZoomHold) {
        selectedZoomHold.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('selectedZoomHoldVal').textContent = val + 'ms';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].holdDuration = val;
            }
        });
    }
    
    // Close zoom panel
    if (zoomPanelClose) {
        zoomPanelClose.addEventListener('click', () => {
            document.getElementById('zoom-panel').classList.remove('visible');
            selectedZoomIndex = -1;
            renderZoomTimeline();
        });
    }
    
    // Delete zoom
    if (deleteZoomBtn) {
        deleteZoomBtn.addEventListener('click', () => {
            if (selectedZoomIndex >= 0) {
                zoomEvents.splice(selectedZoomIndex, 1);
                selectedZoomIndex = -1;
                document.getElementById('zoom-panel').classList.remove('visible');
                renderZoomTimeline();
            }
        });
    }
}

function setupZoomTimeline() {
    const zoomTimeline = document.getElementById('zoom-timeline');
    if (!zoomTimeline) return;
    
    // Click to add new zoom
    zoomTimeline.addEventListener('click', (e) => {
        if (e.target === zoomTimeline) {
            const rect = zoomTimeline.getBoundingClientRect();
            const clickPos = (e.clientX - rect.left) / rect.width;
            
            // Convert to time in ms
            const duration = mousePositions.length > 0 ? mousePositions[mousePositions.length - 1].time : 0;
            const clickTime = clickPos * duration;
            
            // Find nearest mouse position for x,y
            const nearestPos = findMousePositionInterpolated(clickTime);
            
            // Add new zoom event
            zoomEvents.push({
                time: clickTime,
                x: nearestPos ? nearestPos.x : 0,
                y: nearestPos ? nearestPos.y : 0,
                zoomLevel: defaultZoomLevel,
                zoomSpeed: defaultZoomSpeed,
                holdDuration: defaultZoomHold,
                enabled: true
            });
            
            // Sort by time
            zoomEvents.sort((a, b) => a.time - b.time);
            renderZoomTimeline();
        }
    });
}

function renderZoomTimeline() {
    const zoomTimeline = document.getElementById('zoom-timeline');
    if (!zoomTimeline) return;
    
    const duration = mousePositions.length > 0 ? mousePositions[mousePositions.length - 1].time : 1;
    
    zoomTimeline.innerHTML = '';
    
    zoomEvents.forEach((event, index) => {
        const startPercent = (event.time / duration) * 100;
        const totalDuration = event.zoomSpeed * 2 + event.holdDuration;
        const widthPercent = (totalDuration / duration) * 100;
        
        const marker = document.createElement('div');
        marker.className = 'zoom-marker' + (index === selectedZoomIndex ? ' selected' : '');
        marker.style.left = startPercent + '%';
        marker.style.width = Math.max(widthPercent, 2) + '%';
        marker.textContent = event.zoomLevel + 'x';
        marker.dataset.index = index;
        
        marker.addEventListener('click', (e) => {
            e.stopPropagation();
            selectZoomEvent(index);
        });
        
        zoomTimeline.appendChild(marker);
    });
}

function selectZoomEvent(index) {
    selectedZoomIndex = index;
    const event = zoomEvents[index];
    const zoomPanel = document.getElementById('zoom-panel');
    
    if (!zoomPanel) return;
    
    // Update panel values
    const selectedZoomLevel = document.getElementById('selectedZoomLevel');
    const selectedZoomSpeed = document.getElementById('selectedZoomSpeed');
    const selectedZoomHold = document.getElementById('selectedZoomHold');
    
    if (selectedZoomLevel) {
        selectedZoomLevel.value = event.zoomLevel;
        document.getElementById('selectedZoomLevelVal').textContent = event.zoomLevel + 'x';
    }
    if (selectedZoomSpeed) {
        selectedZoomSpeed.value = event.zoomSpeed;
        document.getElementById('selectedZoomSpeedVal').textContent = event.zoomSpeed + 'ms';
    }
    if (selectedZoomHold) {
        selectedZoomHold.value = event.holdDuration;
        document.getElementById('selectedZoomHoldVal').textContent = event.holdDuration + 'ms';
    }
    
    // Show panel
    zoomPanel.classList.add('visible');
    
    // Update timeline selection
    renderZoomTimeline();
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

function findMousePositionInterpolated(time) {
    if (mousePositions.length === 0) return null;
    if (mousePositions.length === 1) return mousePositions[0];
    
    let low = 0;
    let high = mousePositions.length - 1;
    
    while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (mousePositions[mid].time < time) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    
    const nextIndex = low;
    const prevIndex = Math.max(0, nextIndex - 1);
    
    const prev = mousePositions[prevIndex];
    const next = mousePositions[nextIndex];
    
    if (prevIndex === nextIndex || prev.time === next.time) {
        return prev;
    }
    
    const t = (time - prev.time) / (next.time - prev.time);
    const clampedT = Math.max(0, Math.min(1, t));
    const smoothT = 1 - Math.pow(1 - clampedT, 2);
    
    return {
        x: prev.x + (next.x - prev.x) * smoothT,
        y: prev.y + (next.y - prev.y) * smoothT,
        time: time,
        click: prev.click || next.click
    };
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Find active zoom event for current time
function findActiveZoomEvent(timeMs) {
    for (let i = 0; i < zoomEvents.length; i++) {
        const event = zoomEvents[i];
        if (!event.enabled) continue;
        
        const eventEnd = event.time + event.zoomSpeed * 2 + event.holdDuration;
        if (timeMs >= event.time && timeMs <= eventEnd) {
            return { event, index: i };
        }
    }
    return null;
}

function resizeWrapperToVideo() {
    const wrapper = document.querySelector('.video-preview-wrapper');
    const mainEditor = document.querySelector('.main-editor');
    const editorControls = document.querySelector('.editor-controls');
    
    if (!videoElement.videoWidth || !videoElement.videoHeight || !mainEditor || !editorControls) return;
    
    const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
    
    const mainRect = mainEditor.getBoundingClientRect();
    const controlsRect = editorControls.getBoundingClientRect();
    
    // Account for settings panel (280px) and gaps
    const settingsWidth = 280;
    const availableWidth = mainRect.width - settingsWidth - 60;
    const availableHeight = mainRect.height - controlsRect.height - 60;
    
    let wrapperWidth, wrapperHeight;
    
    if (availableWidth / availableHeight > videoAspect) {
        wrapperHeight = availableHeight;
        wrapperWidth = wrapperHeight * videoAspect;
    } else {
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

    const pos = findMousePositionInterpolated(currentTimeMs);
    if (pos) {
        const wrapper = document.querySelector('.video-preview-wrapper');
        const videoRect = videoElement.getBoundingClientRect();
        
        const displayWidth = videoRect.width;
        const displayHeight = videoRect.height;
        const recordedWidth = videoElement.videoWidth;
        const recordedHeight = videoElement.videoHeight;

        if (recordedWidth === 0 || recordedHeight === 0) {
            requestAnimationFrame(updateLoop);
            return;
        }

        const scaleX = displayWidth / recordedWidth;
        const scaleY = displayHeight / recordedHeight;

        let cursorX = pos.x;
        let cursorY = pos.y;
        
        // Check for active zoom event
        const activeZoom = autoZoomEnabled ? findActiveZoomEvent(currentTimeMs) : null;
        
        if (activeZoom) {
            const event = activeZoom.event;
            const eventStart = event.time;
            const zoomInEnd = eventStart + event.zoomSpeed;
            const holdEnd = zoomInEnd + event.holdDuration;
            const zoomOutEnd = holdEnd + event.zoomSpeed;
            
            let animatedScale = 1;
            
            if (currentTimeMs < zoomInEnd) {
                // Zooming in
                const progress = (currentTimeMs - eventStart) / event.zoomSpeed;
                animatedScale = 1 + (event.zoomLevel - 1) * easeInOutCubic(progress);
            } else if (currentTimeMs < holdEnd) {
                // Holding
                animatedScale = event.zoomLevel;
            } else {
                // Zooming out
                const progress = (currentTimeMs - holdEnd) / event.zoomSpeed;
                animatedScale = event.zoomLevel - (event.zoomLevel - 1) * easeInOutCubic(progress);
            }
            
            // Apply zoom to video
            const viewWidth = recordedWidth / animatedScale;
            const viewHeight = recordedHeight / animatedScale;
            
            let srcX = event.x - viewWidth / 2;
            let srcY = event.y - viewHeight / 2;
            srcX = Math.max(0, Math.min(recordedWidth - viewWidth, srcX));
            srcY = Math.max(0, Math.min(recordedHeight - viewHeight, srcY));
            
            // CSS transform
            const centerX = recordedWidth / 2;
            const centerY = recordedHeight / 2;
            const srcCenterX = srcX + viewWidth / 2;
            const srcCenterY = srcY + viewHeight / 2;
            
            const moveX = ((centerX - srcCenterX) / recordedWidth) * 100;
            const moveY = ((centerY - srcCenterY) / recordedHeight) * 100;
            
            videoElement.style.transition = 'none';
            videoElement.style.transform = `scale(${animatedScale}) translate(${moveX}%, ${moveY}%)`;
            
            // Transform cursor
            cursorX = (pos.x - srcX) * animatedScale;
            cursorY = (pos.y - srcY) * animatedScale;
        } else {
            videoElement.style.transform = 'scale(1) translate(0, 0)';
        }
        
        // Scale cursor to display coordinates
        cursorX *= scaleX;
        cursorY *= scaleY;
        
        // Offset for video position within wrapper
        const wrapperRect = wrapper.getBoundingClientRect();
        cursorX += videoRect.left - wrapperRect.left;
        cursorY += videoRect.top - wrapperRect.top;
    
        cursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
        cursor.style.display = 'block';
    }
    
    requestAnimationFrame(updateLoop);
}

document.getElementById('saveBtn').addEventListener('click', async () => {
    const duration = videoElement.duration;
    const startSec = trimStart * duration;
    const endSec = trimEnd * duration;
    const trimDuration = endSec - startSec;
    
    const exportPath = await ipcRenderer.invoke('show-save-dialog', {
        defaultPath: `promo-${Date.now()}.mp4`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    });
    
    if (exportPath.canceled) return;
    
    const outputPath = exportPath.filePath;
    const overlay = document.getElementById('export-overlay');
    overlay.style.display = 'flex';
    
    // Send all settings including per-zoom events and cursor settings
    ipcRenderer.send('export-video-with-effects', {
        videoPath: currentVideoPath,
        outputPath: outputPath,
        mouseData: mousePositions,
        trimStart: startSec,
        trimDuration: trimDuration,
        zoomEvents: zoomEvents,
        cursorSettings: cursorSettings,
        autoZoomEnabled: autoZoomEnabled
    });
});

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

ipcRenderer.on('export-complete', (event, result) => {
    const overlay = document.getElementById('export-overlay');
    overlay.style.display = 'none';
    
    if (result.success) {
        alert('Video exported successfully!\nSaved to: ' + result.path);
    } else {
        alert('Export failed: ' + result.error);
    }
});
