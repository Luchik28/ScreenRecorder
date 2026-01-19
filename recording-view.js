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
    style: 'windows',
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
let isDraggingZoom = null; // { index, type: 'left'|'right' }

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
            
            initializeZoomEvents();
            
            cursor.style.display = 'block';
            updateCursorAppearance();
        } catch (e) {
            console.error('Failed to load mouse data:', e);
        }
    }

    setupPlaybackControls();
    setupTimeline();
    setupTabs();
    setupCursorSettings();
    setupZoomSettings();
    setupZoomTimeline();
    requestAnimationFrame(updateLoop);
});

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

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        });
    });
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
    document.querySelectorAll('.cursor-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.cursor-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            cursorSettings.style = option.dataset.cursor;
            updateCursorAppearance();
        });
    });
    
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            cursorSettings.color = swatch.dataset.color;
            document.getElementById('custom-color').value = cursorSettings.color;
            updateCursorAppearance();
        });
    });
    
    document.getElementById('custom-color').addEventListener('input', (e) => {
        cursorSettings.color = e.target.value;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        updateCursorAppearance();
    });
    
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
            // Use actual Windows cursor appearance with color tint
            cursor.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" style="filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                <path d="M0.5,0.5 L0.5,22.5 L6.5,16.5 L10,25.5 L13.5,24 L10,15 L17.5,15 L0.5,0.5 Z" fill="${color}" stroke="white" stroke-width="1"/>
            </svg>`;
            break;
        case 'mac':
            // Use actual Mac cursor appearance with color tint
            cursor.innerHTML = `<svg viewBox="0 0 24 32" width="${size*0.75}" height="${size}" style="filter: drop-shadow(0.5px 0.5px 0.5px rgba(0,0,0,0.5));">
                <path d="M2,0.5 L2,21.5 L8,15.5 L11,26.5 L13,25.5 L10,14.5 L16,14.5 L2,0.5 Z" fill="${color}" stroke="white" stroke-width="0.8"/>
            </svg>`;
            break;
        case 'dot':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:50%; border:2px solid white; box-sizing:border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
            break;
        case 'ring':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; border:3px solid ${color}; border-radius:50%; box-sizing:border-box; box-shadow: 0 0 0 1px white inset, 0 0 0 1px white, 0 2px 4px rgba(0,0,0,0.3);"></div>`;
            break;
        case 'square':
            cursor.innerHTML = `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:3px; border:2px solid white; box-sizing:border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
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
    
    const selectedZoomLevel = document.getElementById('selectedZoomLevel');
    const selectedZoomSpeed = document.getElementById('selectedZoomSpeed');
    const selectedZoomHold = document.getElementById('selectedZoomHold');
    const deleteZoomBtn = document.getElementById('delete-zoom-btn');
    
    if (selectedZoomLevel) {
        selectedZoomLevel.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById('selectedZoomLevelVal').textContent = val + 'x';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].zoomLevel = val;
                renderZoomTimeline();
            }
        });
    }
    
    if (selectedZoomSpeed) {
        selectedZoomSpeed.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('selectedZoomSpeedVal').textContent = val + 'ms';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].zoomSpeed = val;
                renderZoomTimeline();
            }
        });
    }
    
    if (selectedZoomHold) {
        selectedZoomHold.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('selectedZoomHoldVal').textContent = val + 'ms';
            if (selectedZoomIndex >= 0 && zoomEvents[selectedZoomIndex]) {
                zoomEvents[selectedZoomIndex].holdDuration = val;
                renderZoomTimeline();
            }
        });
    }
    
    if (deleteZoomBtn) {
        deleteZoomBtn.addEventListener('click', () => {
            if (selectedZoomIndex >= 0) {
                zoomEvents.splice(selectedZoomIndex, 1);
                selectedZoomIndex = -1;
                hideZoomDetails();
                renderZoomTimeline();
            }
        });
    }
}

function setupZoomTimeline() {
    const zoomTimeline = document.getElementById('zoom-timeline');
    if (!zoomTimeline) return;
    
    zoomTimeline.addEventListener('click', (e) => {
        if (e.target === zoomTimeline && !isDraggingZoom) {
            const rect = zoomTimeline.getBoundingClientRect();
            const clickPos = (e.clientX - rect.left) / rect.width;
            
            const duration = mousePositions.length > 0 ? mousePositions[mousePositions.length - 1].time : 0;
            const clickTime = clickPos * duration;
            
            const nearestPos = findMousePositionInterpolated(clickTime);
            
            zoomEvents.push({
                time: clickTime,
                x: nearestPos ? nearestPos.x : 0,
                y: nearestPos ? nearestPos.y : 0,
                zoomLevel: defaultZoomLevel,
                zoomSpeed: defaultZoomSpeed,
                holdDuration: defaultZoomHold,
                enabled: true
            });
            
            zoomEvents.sort((a, b) => a.time - b.time);
            renderZoomTimeline();
        }
    });
    
    document.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('zoom-handle')) {
            e.preventDefault();
            e.stopPropagation();
            const marker = e.target.parentElement;
            const index = parseInt(marker.dataset.index);
            const type = e.target.classList.contains('left') ? 'left' : 'right';
            
            isDraggingZoom = { index, type };
            document.addEventListener('mousemove', handleZoomDrag);
            document.addEventListener('mouseup', handleZoomDragEnd);
        } else if (e.target.classList.contains('zoom-marker') && !e.target.classList.contains('zoom-handle')) {
            const index = parseInt(e.target.dataset.index);
            selectZoomEvent(index);
        }
    });
}

function handleZoomDrag(e) {
    if (!isDraggingZoom) return;
    
    const zoomTimeline = document.getElementById('zoom-timeline');
    const rect = zoomTimeline.getBoundingClientRect();
    const mousePos = (e.clientX - rect.left) / rect.width;
    const duration = mousePositions.length > 0 ? mousePositions[mousePositions.length - 1].time : 1;
    const mouseTime = mousePos * duration;
    
    const event = zoomEvents[isDraggingZoom.index];
    const minHold = 100;
    
    if (isDraggingZoom.type === 'left') {
        const maxStart = event.time + event.holdDuration - minHold;
        const newStart = Math.max(0, Math.min(mouseTime, maxStart));
        const deltaTime = newStart - event.time;
        
        event.time = newStart;
        event.holdDuration = Math.max(minHold, event.holdDuration - deltaTime);
    } else if (isDraggingZoom.type === 'right') {
        const eventStart = event.time;
        const currentEnd = eventStart + event.zoomSpeed * 2 + event.holdDuration;
        const newEnd = Math.max(eventStart + event.zoomSpeed * 2 + minHold, Math.min(mouseTime, duration));
        
        event.holdDuration = Math.max(minHold, newEnd - eventStart - event.zoomSpeed * 2);
    }
    
    if (selectedZoomIndex === isDraggingZoom.index) {
        document.getElementById('selectedZoomHold').value = event.holdDuration;
        document.getElementById('selectedZoomHoldVal').textContent = event.holdDuration + 'ms';
    }
    
    renderZoomTimeline();
}

function handleZoomDragEnd() {
    isDraggingZoom = null;
    document.removeEventListener('mousemove', handleZoomDrag);
    document.removeEventListener('mouseup', handleZoomDragEnd);
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
        
        const leftHandle = document.createElement('div');
        leftHandle.className = 'zoom-handle left';
        marker.appendChild(leftHandle);
        
        const rightHandle = document.createElement('div');
        rightHandle.className = 'zoom-handle right';
        marker.appendChild(rightHandle);
        
        zoomTimeline.appendChild(marker);
    });
}

function showZoomDetails() {
    document.getElementById('details-empty').style.display = 'none';
    document.getElementById('zoom-details').style.display = 'block';
}

function hideZoomDetails() {
    document.getElementById('details-empty').style.display = 'block';
    document.getElementById('zoom-details').style.display = 'none';
}

function selectZoomEvent(index) {
    selectedZoomIndex = index;
    const event = zoomEvents[index];
    
    document.getElementById('selectedZoomLevel').value = event.zoomLevel;
    document.getElementById('selectedZoomLevelVal').textContent = event.zoomLevel + 'x';
    document.getElementById('selectedZoomSpeed').value = event.zoomSpeed;
    document.getElementById('selectedZoomSpeedVal').textContent = event.zoomSpeed + 'ms';
    document.getElementById('selectedZoomHold').value = event.holdDuration;
    document.getElementById('selectedZoomHoldVal').textContent = event.holdDuration + 'ms';
    
    showZoomDetails();
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="details"]').classList.add('active');
    document.getElementById('details-tab').classList.add('active');
    
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
        
        const activeZoom = autoZoomEnabled ? findActiveZoomEvent(currentTimeMs) : null;
        
        if (activeZoom) {
            const event = activeZoom.event;
            const eventStart = event.time;
            const zoomInEnd = eventStart + event.zoomSpeed;
            const holdEnd = zoomInEnd + event.holdDuration;
            const zoomOutEnd = holdEnd + event.zoomSpeed;
            
            let animatedScale = 1;
            
            if (currentTimeMs < zoomInEnd) {
                const progress = (currentTimeMs - eventStart) / event.zoomSpeed;
                animatedScale = 1 + (event.zoomLevel - 1) * easeInOutCubic(progress);
            } else if (currentTimeMs < holdEnd) {
                animatedScale = event.zoomLevel;
            } else {
                const progress = (currentTimeMs - holdEnd) / event.zoomSpeed;
                animatedScale = event.zoomLevel - (event.zoomLevel - 1) * easeInOutCubic(progress);
            }
            
            const viewWidth = recordedWidth / animatedScale;
            const viewHeight = recordedHeight / animatedScale;
            
            let srcX = event.x - viewWidth / 2;
            let srcY = event.y - viewHeight / 2;
            srcX = Math.max(0, Math.min(recordedWidth - viewWidth, srcX));
            srcY = Math.max(0, Math.min(recordedHeight - viewHeight, srcY));
            
            const centerX = recordedWidth / 2;
            const centerY = recordedHeight / 2;
            const srcCenterX = srcX + viewWidth / 2;
            const srcCenterY = srcY + viewHeight / 2;
            
            const moveX = ((centerX - srcCenterX) / recordedWidth) * 100;
            const moveY = ((centerY - srcCenterY) / recordedHeight) * 100;
            
            videoElement.style.transition = 'none';
            videoElement.style.transform = `scale(${animatedScale}) translate(${moveX}%, ${moveY}%)`;
        } else {
            videoElement.style.transform = 'scale(1) translate(0, 0)';
        }
        
        cursorX *= scaleX;
        cursorY *= scaleY;
        
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
