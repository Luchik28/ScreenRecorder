const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let mousePositions = [];
let videoElement = null;
let videoElementScene = null; // Scene mode video element
let cursor = null;
let cursorScene = null;
let currentVideoPath = '';
let sceneMode = false; // Toggle between fullscreen video and scene mode

// Background / scene settings
let backgroundSettings = {
    wallpaper: 'none', // none | studio | sunset | midnight | neon
    os: 'none',         // none | mac | windows
    appScale: 1.0,      // 0.5 - 2.0
    appX: 0,            // px offset inside wrapper
    appY: 0,            // px offset inside wrapper
    borderRadius: 6    // px corner rounding
};

let activeSettingsTab = 'cursor';
let isDraggingApp = false;
let dragStart = null; // { x, y, startAppX, startAppY }

// Track the scene transform we apply for zoom: screen = base * scale + translate
let sceneTransformState = { scale: 1, tx: 0, ty: 0 };

// Editor State
let trimStart = 0;
let trimEnd = 1;
let isDragging = null;

// Cursor settings
let cursorSettings = {
    style: 'windows',
    color: '#000000',
    size: 24,
    clickEffect: 'none' // none, ripple, confetti
};

// Active click effects being rendered
let activeClickEffects = [];
let lastProcessedClickTime = -1; // Track which clicks we've already shown effects for

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
    videoElementScene = document.getElementById('player-scene');
    cursor = document.getElementById('purple-cursor');
    cursorScene = document.getElementById('cursor-scene');
    
    const params = new URLSearchParams(window.location.search);
    currentVideoPath = params.get('video');
    const mouseDataPath = params.get('mouse');

    if (currentVideoPath) {
        try {
            const videoData = fs.readFileSync(currentVideoPath);
            const blob = new Blob([videoData], { type: 'video/mp4' });
            const blobUrl = URL.createObjectURL(blob);
            videoElement.src = blobUrl;
            videoElementScene.src = blobUrl;
            videoElement.load();
            videoElementScene.load();
        } catch (error) {
            console.error('Failed to load video:', error);
            alert('Error loading video: ' + error.message);
        }
        
        videoElement.addEventListener('loadedmetadata', () => {
            console.log('Video loaded:', videoElement.videoWidth, 'x', videoElement.videoHeight);
            resizeWrapperToVideo();
            window.addEventListener('resize', resizeWrapperToVideo);
            
            // Initialize zoom events now that we have video duration
            if (mousePositions.length > 0) {
                initializeZoomEvents();
            }
            
            videoElement.play().catch(e => console.warn('Autoplay blocked:', e));
            document.getElementById('play-icon').style.display = 'none';
            document.getElementById('pause-icon').style.display = 'block';
            
            renderZoomTimeline();
        });

        // Sync scene video with main video
        videoElement.addEventListener('play', () => videoElementScene.play());
        videoElement.addEventListener('pause', () => videoElementScene.pause());
        videoElement.addEventListener('seeked', () => { videoElementScene.currentTime = videoElement.currentTime; });
        videoElement.addEventListener('timeupdate', () => {
            if (Math.abs(videoElementScene.currentTime - videoElement.currentTime) > 0.1) {
                videoElementScene.currentTime = videoElement.currentTime;
            }
        });

        videoElement.addEventListener('error', (e) => {
            console.error('Video Error:', videoElement.error);
        });
    }

    if (mouseDataPath) {
        try {
            const data = JSON.parse(fs.readFileSync(mouseDataPath, 'utf8'));
            mousePositions = data.positions;
            
            // Zoom events will be initialized after video metadata loads
            
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
    setupBackgroundSettings();
    setupZoomSettings();
    setupZoomTimeline();
    
    // Initialize color swatch selection to match default color
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        if (swatch.dataset.color === cursorSettings.color) {
            swatch.classList.add('selected');
        }
    });
    
    requestAnimationFrame(updateLoop);
});

function applyBackgroundToScene() {
    if (!sceneMode) return;
    
    const bg = document.getElementById('background-layer');
    const appWindow = document.getElementById('app-window');
    const chromeTop = document.getElementById('os-chrome-top');
    const chromeBottom = document.getElementById('os-chrome-bottom');
    if (!bg || !appWindow) return;

    const wallpaper = backgroundSettings.wallpaper;
    if (wallpaper === 'none') {
        bg.style.backgroundImage = 'none';
        bg.style.backgroundColor = 'transparent';
    } else if (wallpaper === 'studio') {
        bg.style.backgroundImage = 'radial-gradient(1200px 800px at 20% 15%, rgba(168,85,247,0.35), transparent 60%), radial-gradient(900px 700px at 85% 20%, rgba(59,130,246,0.30), transparent 55%), linear-gradient(135deg, #0b0b10, #101018 55%, #0b0b10)';
        bg.style.backgroundColor = '#0b0b10';
    } else if (wallpaper === 'sunset') {
        bg.style.backgroundImage = 'radial-gradient(900px 700px at 15% 20%, rgba(255,122,24,0.35), transparent 60%), radial-gradient(1000px 800px at 80% 30%, rgba(255,45,85,0.25), transparent 60%), linear-gradient(135deg, #130912, #1a0d2a 55%, #0d0b12)';
        bg.style.backgroundColor = '#0d0b12';
    } else if (wallpaper === 'midnight') {
        bg.style.backgroundImage = 'radial-gradient(900px 700px at 30% 20%, rgba(34,197,94,0.18), transparent 60%), radial-gradient(1000px 800px at 80% 60%, rgba(59,130,246,0.22), transparent 60%), linear-gradient(135deg, #070a12, #0a1020 55%, #070a12)';
        bg.style.backgroundColor = '#070a12';
    } else if (wallpaper === 'neon') {
        bg.style.backgroundImage = 'radial-gradient(900px 700px at 25% 25%, rgba(0,255,255,0.18), transparent 60%), radial-gradient(900px 700px at 80% 20%, rgba(255,0,255,0.16), transparent 60%), radial-gradient(900px 700px at 70% 80%, rgba(255,255,0,0.12), transparent 60%), linear-gradient(135deg, #07070c, #0c0818 55%, #07070c)';
        bg.style.backgroundColor = '#07070c';
    }

    // Show/hide OS chrome overlays at screen edges
    if (chromeTop) chromeTop.style.display = backgroundSettings.os === 'mac' ? 'block' : 'none';
    if (chromeBottom) chromeBottom.style.display = backgroundSettings.os === 'windows' ? 'block' : 'none';

    // Apply app scale + position
    appWindow.style.setProperty('--app-scale', String(backgroundSettings.appScale));
    appWindow.style.setProperty('--app-x', `${backgroundSettings.appX}px`);
    appWindow.style.setProperty('--app-y', `${backgroundSettings.appY}px`);
    appWindow.style.borderRadius = `${backgroundSettings.borderRadius}px`;
}

function setupBackgroundSettings() {
    const bgOptions = document.querySelectorAll('.bg-option');
    const osOptions = document.querySelectorAll('.os-option');
    const advanced = document.getElementById('bg-advanced');
    const screenSize = document.getElementById('screenSize');
    const screenSizeVal = document.getElementById('screenSizeVal');
    const resetBtn = document.getElementById('reset-position');
    const wrapper = document.getElementById('container');

    // Wallpaper button group
    bgOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            bgOptions.forEach(b => {
                b.style.borderColor = 'var(--border)';
                b.classList.remove('selected');
            });
            btn.style.borderColor = 'var(--primary)';
            btn.classList.add('selected');
            backgroundSettings.wallpaper = btn.dataset.bg;
            
            // Toggle scene mode
            sceneMode = backgroundSettings.wallpaper !== 'none';
            document.getElementById('scene').style.display = sceneMode ? 'block' : 'none';
            document.getElementById('player').style.display = sceneMode ? 'none' : 'block';
            document.getElementById('click-effects-container').style.display = sceneMode ? 'none' : 'block';
            document.getElementById('purple-cursor').style.display = sceneMode ? 'none' : 'block';
            
            if (advanced) {
                advanced.style.display = sceneMode ? 'block' : 'none';
            }
            applyBackgroundToScene();
        });
    });

    // OS button group
    osOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            osOptions.forEach(b => {
                b.style.background = '#111';
                b.style.borderColor = 'var(--border)';
                b.style.color = '#888';
                b.classList.remove('selected');
            });
            btn.style.background = 'rgba(168,85,247,0.2)';
            btn.style.borderColor = 'var(--primary)';
            btn.style.color = '#ddd';
            btn.classList.add('selected');
            backgroundSettings.os = btn.dataset.os;
            applyBackgroundToScene();
        });
    });

    if (screenSize && screenSizeVal) {
        screenSize.addEventListener('input', () => {
            const pct = parseInt(screenSize.value, 10);
            screenSizeVal.textContent = `${pct}%`;
            backgroundSettings.appScale = pct / 100;
            applyBackgroundToScene();
        });
    }

    const cornerRadius = document.getElementById('cornerRadius');
    const cornerRadiusVal = document.getElementById('cornerRadiusVal');
    if (cornerRadius && cornerRadiusVal) {
        cornerRadius.addEventListener('input', () => {
            const radius = parseInt(cornerRadius.value, 10);
            cornerRadiusVal.textContent = `${radius}px`;
            backgroundSettings.borderRadius = radius;
            applyBackgroundToScene();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            backgroundSettings.appX = 0;
            backgroundSettings.appY = 0;
            applyBackgroundToScene();
        });
    }

    // Drag app window around scene when Background tab is selected
    if (wrapper) {
        wrapper.addEventListener('mousedown', (e) => {
            if (activeSettingsTab !== 'background' || !sceneMode) return;
            if (e.button !== 0) return;
            const target = e.target;
            if (target.closest('.settings-panel') || target.closest('.editor-controls') || target.closest('.header')) return;

            isDraggingApp = true;
            dragStart = {
                x: e.clientX,
                y: e.clientY,
                startAppX: backgroundSettings.appX,
                startAppY: backgroundSettings.appY
            };
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingApp || !dragStart) return;
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            backgroundSettings.appX = dragStart.startAppX + dx;
            backgroundSettings.appY = dragStart.startAppY + dy;
            applyBackgroundToScene();
        });

        document.addEventListener('mouseup', () => {
            isDraggingApp = false;
            dragStart = null;
        });
    }

    // Initialize
    if (advanced) advanced.style.display = 'none';
    applyBackgroundToScene();
}

function initializeZoomEvents() {
    zoomEvents = [];
    
    const videoDuration = videoElement.duration * 1000; // ms
    const fullZoomDuration = defaultZoomSpeed * 2 + defaultZoomHold; // Full size zoom
    
    // Get all clicks first
    const allClicks = [];
    for (let i = 0; i < mousePositions.length; i++) {
        if (mousePositions[i].click) {
            allClicks.push({
                time: mousePositions[i].time,
                x: mousePositions[i].x,
                y: mousePositions[i].y,
                index: i
            });
        }
    }
    
    // Remove the last click (used to stop recording)
    if (allClicks.length > 0) {
        allClicks.pop();
    }
    
    // First pass: create zoom events only for clicks that can fit a FULL zoom
    // Or merge with previous if they're close
    for (let i = 0; i < allClicks.length; i++) {
        const clickTime = allClicks[i].time;
        
        // Skip if click is past video duration
        if (clickTime >= videoDuration) continue;
        
        const availableTime = videoDuration - clickTime;
        
        // Check if we can fit a full zoom
        if (availableTime >= fullZoomDuration) {
            // Check if this would overlap with or be close to the previous zoom
            if (zoomEvents.length > 0) {
                const prev = zoomEvents[zoomEvents.length - 1];
                const prevEnd = prev.time + prev.zoomSpeed * 2 + prev.holdDuration;
                const gap = clickTime - prevEnd;
                
                // If gap is less than 500ms, merge with previous instead of creating new
                if (gap < 500) {
                    // Extend previous zoom to include this click
                    const newEndTime = Math.min(clickTime + fullZoomDuration, videoDuration);
                    prev.holdDuration = newEndTime - prev.time - prev.zoomSpeed * 2;
                    // Average position
                    prev.x = Math.round((prev.x + allClicks[i].x) / 2);
                    prev.y = Math.round((prev.y + allClicks[i].y) / 2);
                    continue;
                }
            }
            
            // Create new full-size zoom
            zoomEvents.push({
                time: clickTime,
                x: allClicks[i].x,
                y: allClicks[i].y,
                zoomLevel: defaultZoomLevel,
                zoomSpeed: defaultZoomSpeed,
                holdDuration: defaultZoomHold,
                enabled: true
            });
        } else {
            // Not enough time for full zoom - try to merge with previous
            if (zoomEvents.length > 0) {
                const prev = zoomEvents[zoomEvents.length - 1];
                const prevEnd = prev.time + prev.zoomSpeed * 2 + prev.holdDuration;
                
                // Extend previous zoom to reach as far as possible
                const newEndTime = Math.min(clickTime + 500, videoDuration); // extend a bit past click
                if (newEndTime > prevEnd) {
                    prev.holdDuration = newEndTime - prev.time - prev.zoomSpeed * 2;
                    // Weight position toward new click
                    prev.x = Math.round((prev.x + allClicks[i].x) / 2);
                    prev.y = Math.round((prev.y + allClicks[i].y) / 2);
                }
            }
            // Skip creating a new shrunk zoom - just don't create it
        }
    }
    
    // Final cleanup: ensure no zoom extends past video
    for (const event of zoomEvents) {
        const eventEnd = event.time + event.zoomSpeed * 2 + event.holdDuration;
        if (eventEnd > videoDuration) {
            event.holdDuration = Math.max(100, videoDuration - event.time - event.zoomSpeed * 2);
        }
    }
    
    console.log(`Found ${zoomEvents.length} zoom events after processing`);
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            activeSettingsTab = tabName;
            
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
    
    // Click effect selection
    document.querySelectorAll('.click-effect-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.click-effect-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            cursorSettings.clickEffect = option.dataset.effect;
        });
    });
}

function updateCursorAppearance() {
    const size = cursorSettings.size;
    const color = cursorSettings.color;
    
    // Update both cursors (fullscreen and scene)
    const cursors = [cursor, cursorScene].filter(c => c);
    
    cursors.forEach(c => {
        c.innerHTML = '';
        c.style.width = size + 'px';
        c.style.height = size + 'px';
    });
    
    const cursorHtml = getCursorHtml(cursorSettings.style, size, color);
    cursors.forEach(c => {
        c.innerHTML = cursorHtml;
    });
}

function getCursorHtml(style, size, color) {
    switch (style) {
        case 'windows':
            return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" style="filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));">
                <path d="M0.5,0.5 L0.5,22.5 L6.5,16.5 L10,25.5 L13.5,24 L10,15 L17.5,15 L0.5,0.5 Z" fill="${color}" stroke="white" stroke-width="1"/>
            </svg>`;
        case 'mac':
            return `<svg viewBox="0 0 24 32" width="${size*0.75}" height="${size}" style="filter: drop-shadow(0.5px 0.5px 0.5px rgba(0,0,0,0.5));">
                <path d="M2,0.5 L2,21.5 L8,15.5 L11,26.5 L13,25.5 L10,14.5 L16,14.5 L2,0.5 Z" fill="${color}" stroke="white" stroke-width="0.8"/>
            </svg>`;
        case 'dot':
            return `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:50%; border:2px solid white; box-sizing:border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        case 'ring':
            return `<div style="width:${size}px; height:${size}px; border:3px solid ${color}; border-radius:50%; box-sizing:border-box; box-shadow: 0 0 0 1px white inset, 0 0 0 1px white, 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        case 'square':
            return `<div style="width:${size}px; height:${size}px; background:${color}; border-radius:3px; border:2px solid white; box-sizing:border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        case 'crosshair':
            const half = size / 2;
            return `<div style="position:relative; width:${size}px; height:${size}px;">
                <div style="position:absolute; width:2px; height:${size}px; left:${half-1}px; top:0; background:${color}; box-shadow: 0 0 0 1px white;"></div>
                <div style="position:absolute; height:2px; width:${size}px; top:${half-1}px; left:0; background:${color}; box-shadow: 0 0 0 1px white;"></div>
            </div>`;
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
    
    // Add keyboard handler for deleting selected zoom
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoomIndex !== -1) {
            e.preventDefault();
            zoomEvents.splice(selectedZoomIndex, 1);
            selectedZoomIndex = -1;
            hideZoomDetails();
            renderZoomTimeline();
        }
    });
    
    zoomTimeline.addEventListener('click', (e) => {
        if (e.target === zoomTimeline && !isDraggingZoom) {
            const rect = zoomTimeline.getBoundingClientRect();
            const clickPos = (e.clientX - rect.left) / rect.width;
            
            const videoDuration = videoElement.duration * 1000;
            if (!videoDuration || videoDuration <= 0) return;
            
            const clickTime = clickPos * videoDuration;
            const zoomDuration = defaultZoomSpeed * 2 + defaultZoomHold;
            
            // HARD CHECK: Cannot start at or past video duration
            if (clickTime < 0 || clickTime >= videoDuration) return;
            
            // HARD CHECK: zoom would extend past video end
            if (clickTime + zoomDuration > videoDuration) return;
            
            // Check if it would overlap with existing zooms
            for (const existingZoom of zoomEvents) {
                const existingStart = existingZoom.time;
                const existingEnd = existingZoom.time + existingZoom.zoomSpeed * 2 + existingZoom.holdDuration;
                const newEnd = clickTime + zoomDuration;
                
                // Check for overlap
                if (!(newEnd <= existingStart || clickTime >= existingEnd)) {
                    return; // Would overlap
                }
            }
            
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
            e.preventDefault();
            const index = parseInt(e.target.dataset.index);
            selectZoomEvent(index);
            
            // Start dragging the entire zoom box
            const zoomTimeline = document.getElementById('zoom-timeline');
            const rect = zoomTimeline.getBoundingClientRect();
            const videoDuration = videoElement.duration * 1000;
            const clickTime = ((e.clientX - rect.left) / rect.width) * videoDuration;
            const event = zoomEvents[index];
            const offsetFromStart = clickTime - event.time;
            
            isDraggingZoom = { index, type: 'move', offsetFromStart };
            document.addEventListener('mousemove', handleZoomDrag);
            document.addEventListener('mouseup', handleZoomDragEnd);
        }
    });
}

function handleZoomDrag(e) {
    if (!isDraggingZoom) return;
    
    const zoomTimeline = document.getElementById('zoom-timeline');
    const rect = zoomTimeline.getBoundingClientRect();
    const mousePos = (e.clientX - rect.left) / rect.width;
    const videoDuration = videoElement.duration * 1000;
    const mouseTime = mousePos * videoDuration;
    
    const event = zoomEvents[isDraggingZoom.index];
    const eventDuration = event.zoomSpeed * 2 + event.holdDuration;
    const minHold = 100;
    
    // ABSOLUTE BOUNDARIES
    const absoluteMinStart = 0;
    const absoluteMaxEnd = videoDuration;
    
    // Get boundaries from adjacent zoom events to prevent overlap
    const prevEvent = isDraggingZoom.index > 0 ? zoomEvents[isDraggingZoom.index - 1] : null;
    const nextEvent = isDraggingZoom.index < zoomEvents.length - 1 ? zoomEvents[isDraggingZoom.index + 1] : null;
    const prevEventEnd = prevEvent ? prevEvent.time + prevEvent.zoomSpeed * 2 + prevEvent.holdDuration : 0;
    const nextEventStart = nextEvent ? nextEvent.time : absoluteMaxEnd;
    
    if (isDraggingZoom.type === 'move') {
        // Move entire zoom box
        let newStart = mouseTime - isDraggingZoom.offsetFromStart;
        
        // HARD CLAMP: Cannot go before 0
        newStart = Math.max(absoluteMinStart, newStart);
        // HARD CLAMP: Cannot go past video end minus event duration
        newStart = Math.min(absoluteMaxEnd - eventDuration, newStart);
        // Don't overlap with previous event
        newStart = Math.max(prevEventEnd, newStart);
        // Don't overlap with next event
        newStart = Math.min(nextEventStart - eventDuration, newStart);
        
        // Final safety: ensure we're still valid
        if (newStart >= 0 && newStart + eventDuration <= absoluteMaxEnd) {
            event.time = newStart;
            
            // Update cursor position to new time
            const nearestPos = findMousePositionInterpolated(newStart);
            if (nearestPos) {
                event.x = nearestPos.x;
                event.y = nearestPos.y;
            }
        }
    } else if (isDraggingZoom.type === 'left') {
        // Dragging left handle changes start time and hold duration
        const currentEnd = event.time + eventDuration;
        const minStart = Math.max(absoluteMinStart, prevEventEnd);
        const maxStart = currentEnd - event.zoomSpeed * 2 - minHold;
        
        let newStart = Math.max(minStart, Math.min(mouseTime, maxStart));
        const deltaTime = newStart - event.time;
        
        event.time = newStart;
        event.holdDuration = Math.max(minHold, event.holdDuration - deltaTime);
    } else if (isDraggingZoom.type === 'right') {
        // Dragging right handle changes hold duration
        const eventStart = event.time;
        const minEnd = eventStart + event.zoomSpeed * 2 + minHold;
        
        // HARD CLAMP: Cannot exceed video duration or next event
        const maxEnd = Math.min(absoluteMaxEnd, nextEventStart);
        const newEnd = Math.max(minEnd, Math.min(mouseTime, maxEnd));
        
        event.holdDuration = Math.max(minHold, newEnd - eventStart - event.zoomSpeed * 2);
    }
    
    // FINAL VALIDATION: Ensure event doesn't exceed video duration
    const finalEnd = event.time + event.zoomSpeed * 2 + event.holdDuration;
    if (finalEnd > absoluteMaxEnd) {
        event.holdDuration = Math.max(minHold, absoluteMaxEnd - event.time - event.zoomSpeed * 2);
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
    
    const videoDuration = videoElement.duration * 1000; // This is the ONLY duration that matters
    if (!videoDuration || videoDuration <= 0) return;
    
    zoomTimeline.innerHTML = '';
    
    zoomEvents.forEach((event, index) => {
        // Skip events that start past video end
        if (event.time >= videoDuration) return;
        
        const startPercent = (event.time / videoDuration) * 100;
        let totalDuration = event.zoomSpeed * 2 + event.holdDuration;
        let eventEnd = event.time + totalDuration;
        
        // For DISPLAY only - cap visual width at video duration (don't modify event data)
        let displayDuration = totalDuration;
        if (eventEnd > videoDuration) {
            displayDuration = videoDuration - event.time;
        }
        
        const widthPercent = (displayDuration / videoDuration) * 100;
        
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
    
    // Only return click=true if we've just passed an actual click frame
    // This ensures the click effect happens AT or just after the click, not before
    let isClick = false;
    let clickX = null;
    let clickY = null;
    let actualClickTime = null;
    
    // Check if prev frame had a click and we're now past it (within 50ms window)
    if (prev.click && time >= prev.time && time <= prev.time + 50) {
        isClick = true;
        clickX = prev.x;
        clickY = prev.y;
        actualClickTime = prev.time;
    }
    // Also check next frame in case we're right at the click moment
    else if (next.click && time >= next.time && time <= next.time + 50) {
        isClick = true;
        clickX = next.x;
        clickY = next.y;
        actualClickTime = next.time;
    }
    
    return {
        x: prev.x + (next.x - prev.x) * smoothT,
        y: prev.y + (next.y - prev.y) * smoothT,
        time: time,
        click: isClick,
        clickX: clickX,
        clickY: clickY,
        actualClickTime: actualClickTime
    };
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function findActiveZoomEvent(timeMs) {
    const videoDuration = videoElement.duration * 1000; // ms
    
    for (let i = 0; i < zoomEvents.length; i++) {
        const event = zoomEvents[i];
        if (!event.enabled) continue;
        
        const zoomInEnd = event.time + event.zoomSpeed;
        const holdEnd = zoomInEnd + event.holdDuration;
        const zoomOutEnd = holdEnd + event.zoomSpeed;
        
        // Cap the event end at video duration
        const effectiveEventEnd = Math.min(zoomOutEnd, videoDuration);
        
        if (timeMs >= event.time && timeMs <= effectiveEventEnd) {
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
        const activeZoom = autoZoomEnabled ? findActiveZoomEvent(currentTimeMs) : null;

        if (!sceneMode) {
            // Fullscreen mode (original behavior)
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

            const clickEffectsContainer = document.getElementById('click-effects-container');

            if (activeZoom) {
                const event = activeZoom.event;
                const eventStart = event.time;
                const zoomInEnd = eventStart + event.zoomSpeed;
                const holdEnd = zoomInEnd + event.holdDuration;
                const zoomOutEnd = holdEnd + event.zoomSpeed;
                const videoDuration = videoElement.duration * 1000;

                let animatedScale = 1;
                let effectiveZoomOutEnd = zoomOutEnd;
                if (zoomOutEnd > videoDuration) effectiveZoomOutEnd = videoDuration;

                if (currentTimeMs < zoomInEnd) {
                    const progress = (currentTimeMs - eventStart) / event.zoomSpeed;
                    animatedScale = 1 + (event.zoomLevel - 1) * easeInOutCubic(progress);
                } else if (currentTimeMs < holdEnd) {
                    animatedScale = event.zoomLevel;
                } else if (currentTimeMs < effectiveZoomOutEnd) {
                    const zoomOutDuration = Math.max(1, effectiveZoomOutEnd - holdEnd);
                    const progress = (currentTimeMs - holdEnd) / zoomOutDuration;
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

                const transformValue = `scale(${animatedScale}) translate(${moveX}%, ${moveY}%)`;
                videoElement.style.transition = 'none';
                videoElement.style.transform = transformValue;

                if (clickEffectsContainer) {
                    clickEffectsContainer.style.transform = transformValue;
                    clickEffectsContainer.style.transformOrigin = 'center center';
                }
            } else {
                videoElement.style.transform = 'scale(1) translate(0, 0)';
                if (clickEffectsContainer) {
                    clickEffectsContainer.style.transform = 'scale(1) translate(0, 0)';
                }
            }

            cursorX *= scaleX;
            cursorY *= scaleY;

            const wrapperRect = wrapper.getBoundingClientRect();
            cursorX += videoRect.left - wrapperRect.left;
            cursorY += videoRect.top - wrapperRect.top;

            cursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
            cursor.style.display = 'block';

            if (cursorSettings.clickEffect !== 'none' && pos.click && pos.actualClickTime !== null) {
                if (pos.actualClickTime > lastProcessedClickTime) {
                    lastProcessedClickTime = pos.actualClickTime;
                    let effectX = pos.clickX !== null ? pos.clickX : pos.x;
                    let effectY = pos.clickY !== null ? pos.clickY : pos.y;
                    effectX *= scaleX;
                    effectY *= scaleY;
                    spawnClickEffect(effectX, effectY);
                }
            }
        } else {
            // Scene mode: camera zoom over background + app window
            const scene = document.getElementById('scene');
            const appWindow = document.getElementById('app-window');
            const wrapperRect = wrapper.getBoundingClientRect();
            const videoRect = videoElementScene.getBoundingClientRect();
            
            const displayWidth = videoRect.width;
            const displayHeight = videoRect.height;
            const recordedWidth = videoElementScene.videoWidth;
            const recordedHeight = videoElementScene.videoHeight;

            if (recordedWidth === 0 || recordedHeight === 0) {
                requestAnimationFrame(updateLoop);
                return;
            }

            const scaleX = displayWidth / recordedWidth;
            const scaleY = displayHeight / recordedHeight;

            // Cursor in video-relative coords
            let cursorX = pos.x * scaleX;
            let cursorY = pos.y * scaleY;

            // Position cursor within app window (before any scene transforms)
            cursorScene.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
            cursorScene.style.display = 'block';

            // Camera zoom - use ORIGINAL cursor position in video space for zoom focus
            if (scene && activeZoom) {
                const event = activeZoom.event;
                const eventStart = event.time;
                const zoomInEnd = eventStart + event.zoomSpeed;
                const holdEnd = zoomInEnd + event.holdDuration;
                const zoomOutEnd = holdEnd + event.zoomSpeed;
                const videoDuration = videoElement.duration * 1000;

                let animatedScale = 1;
                let effectiveZoomOutEnd = zoomOutEnd;
                if (zoomOutEnd > videoDuration) effectiveZoomOutEnd = videoDuration;

                if (currentTimeMs < zoomInEnd) {
                    const progress = (currentTimeMs - eventStart) / event.zoomSpeed;
                    animatedScale = 1 + (event.zoomLevel - 1) * easeInOutCubic(progress);
                } else if (currentTimeMs < holdEnd) {
                    animatedScale = event.zoomLevel;
                } else if (currentTimeMs < effectiveZoomOutEnd) {
                    const zoomOutDuration = Math.max(1, effectiveZoomOutEnd - holdEnd);
                    const progress = (currentTimeMs - holdEnd) / zoomOutDuration;
                    animatedScale = event.zoomLevel - (event.zoomLevel - 1) * easeInOutCubic(progress);
                }

                // Get app window's center position in the wrapper (unaffected by zoom)
                const appRect = appWindow.getBoundingClientRect();
                const appCenterX = appRect.left - wrapperRect.left + appRect.width / 2;
                const appCenterY = appRect.top - wrapperRect.top + appRect.height / 2;
                
                // Zoom focus: zoom event's x,y position scaled to display size, relative to app window center
                const zoomFocusX = event.x * scaleX;
                const zoomFocusY = event.y * scaleY;
                
                // Calculate where this focus point is in scene coords
                const focusSceneX = appCenterX - appRect.width / 2 + zoomFocusX;
                const focusSceneY = appCenterY - appRect.height / 2 + zoomFocusY;

                const centerX = wrapperRect.width / 2;
                const centerY = wrapperRect.height / 2;
                
                let tx = centerX - animatedScale * focusSceneX;
                let ty = centerY - animatedScale * focusSceneY;

                // Clamp to prevent zooming outside the scene bounds
                const scaledSceneW = wrapperRect.width * animatedScale;
                const scaledSceneH = wrapperRect.height * animatedScale;
                tx = Math.min(0, Math.max(wrapperRect.width - scaledSceneW, tx));
                ty = Math.min(0, Math.max(wrapperRect.height - scaledSceneH, ty));

                scene.style.transformOrigin = '0 0';
                scene.style.transform = `translate(${tx}px, ${ty}px) scale(${animatedScale})`;
            } else if (scene) {
                scene.style.transform = 'translate(0px, 0px) scale(1)';
            }

            if (cursorSettings.clickEffect !== 'none' && pos.click && pos.actualClickTime !== null) {
                if (pos.actualClickTime > lastProcessedClickTime) {
                    lastProcessedClickTime = pos.actualClickTime;
                    let effectX = pos.clickX !== null ? pos.clickX : pos.x;
                    let effectY = pos.clickY !== null ? pos.clickY : pos.y;
                    effectX *= scaleX;
                    effectY *= scaleY;
                    spawnClickEffect(effectX, effectY, true);
                }
            }
        }
    }

    if (currentTimeMs < lastProcessedClickTime - 100) {
        lastProcessedClickTime = -1;
    }
    
    requestAnimationFrame(updateLoop);
}

function spawnClickEffect(x, y, isScene = false) {
    const container = isScene 
        ? document.getElementById('click-effects-scene') 
        : document.getElementById('click-effects-container');
    
    if (!container) return;
    
    const effectType = cursorSettings.clickEffect;
    const color = cursorSettings.color;
    
    if (effectType === 'ripple') {
        // Create ripple effect
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.style.borderColor = color;
        
        container.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    } else if (effectType === 'confetti') {
        // Create confetti particles
        const colors = [color, '#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3'];
        const particleCount = 12;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'confetti-particle';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            
            // Random direction and distance
            const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const distance = 30 + Math.random() * 40;
            const endX = Math.cos(angle) * distance;
            const endY = Math.sin(angle) * distance;
            
            particle.style.setProperty('--end-x', endX + 'px');
            particle.style.setProperty('--end-y', endY + 'px');
            particle.animate([
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) scale(0.3)`, opacity: 0 }
            ], {
                duration: 600 + Math.random() * 200,
                easing: 'ease-out'
            });
            
            container.appendChild(particle);
            setTimeout(() => particle.remove(), 800);
        }
    }
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
        autoZoomEnabled: autoZoomEnabled,
        backgroundSettings: backgroundSettings
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
