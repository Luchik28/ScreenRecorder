let selectedSourceId = null;
let selectedWindowHandle = null; // For FFmpeg/Win32
let directStream = null; // Fallback stream from system picker
let captureKind = null; // 'screen' or 'window' for system picker
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let recordingStartTime = null;
let timerInterval = null;
let availableWindows = [];

// Button references
const selectWindowBtn = document.getElementById('selectWindowBtn');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const windowGrid = document.getElementById('windowGrid');
const windowGridContainer = document.getElementById('windowGridContainer');
const countdown = document.getElementById('countdown');
const timer = document.getElementById('timer');
const selectionStatus = document.getElementById('selectionStatus');

// Event listeners
selectWindowBtn.addEventListener('click', showWindowGrid);
fullScreenBtn.addEventListener('click', selectFullScreen);
recordBtn.addEventListener('click', startCountdown);
stopBtn.addEventListener('click', stopRecording);
minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeApp());
closeBtn.addEventListener('click', () => window.electronAPI.closeApp());

// Start in window selection mode by default
showWindowGrid();

// Show window grid overlay
async function showWindowGrid() {
  console.log('showWindowGrid called'); // Debug logging
  
  // Expand window to show the grid
  window.electronAPI.expandWindow();
  
  selectWindowBtn.classList.add('active');
  fullScreenBtn.classList.remove('active');
  
  windowGrid.classList.add('active');
  windowGridContainer.innerHTML = '<div style="color:white; text-align:center; padding:20px;">Loading windows...</div>';
  
  try {
    const sources = await window.electronAPI.getSources();
    console.log('All sources:', sources);
    
    windowGridContainer.innerHTML = '';
    
    // Filter for windows only (now they're win32: not window:)
    availableWindows = sources.filter(source => source.id.startsWith('win32:'));
    
    console.log('Filtered windows:', availableWindows);
  } catch (err) {
    console.error('Failed to get sources:', err);
    windowGridContainer.innerHTML = '<div style="color:white;text-align:center;">Failed to load windows.<br><br><button id="retrySystemPicker" class="btn-record" style="margin:0 auto;">Use System Selection instead</button></div>';
    document.getElementById('retrySystemPicker').addEventListener('click', () => {
        windowGrid.classList.remove('active');
        window.electronAPI.shrinkWindow();
        startSystemPicker('window');
    });
    return;
  }
  
  if (availableWindows.length === 0) {
    windowGridContainer.innerHTML = '<div style="color:white;text-align:center;padding:20px;">No windows found.<br>Some applications may be hidden.<br><br><button id="manualPickerBtn" class="btn-record" style="margin:0 auto;">Open System Picker</button></div>';
    document.getElementById('manualPickerBtn').addEventListener('click', () => {
        windowGrid.classList.remove('active');
        window.electronAPI.shrinkWindow();
        startSystemPicker('window');
    });
    return;
  }
  
  availableWindows.forEach(source => {
    const windowItem = document.createElement('div');
    windowItem.className = 'window-item';
    windowItem.dataset.id = source.id;

    // Window Thumbnail
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'window-thumbnail';
    
    if (source.thumbnail) {
      const thumb = document.createElement('img');
      thumb.src = source.thumbnail;
      thumb.style.width = '100%';
      thumb.style.height = '100%';
      thumb.style.objectFit = 'cover';
      thumb.style.borderRadius = '8px';
      thumbWrap.appendChild(thumb);
    } else {
      thumbWrap.classList.add('placeholder');
      thumbWrap.style.display = 'flex';
      thumbWrap.style.alignItems = 'center';
      thumbWrap.style.justifyContent = 'center';
      thumbWrap.style.background = '#2b2b2b';
      thumbWrap.textContent = source.name.substring(0, 2).toUpperCase();
    }

    const name = document.createElement('div');
    name.className = 'window-name';
    name.textContent = source.name;

    windowItem.appendChild(thumbWrap);
    windowItem.appendChild(name);

    windowItem.addEventListener('click', async () => {
      console.log('Selected window:', source.id, source.name);
      
      // Pull window full screen immediately if it's a window
      if (source.id.startsWith('win32:')) {
        const handle = source.id.split(':')[1];
        await window.electronAPI.maximizeTargetWindow(handle);
      }
      
      selectWindow(source.id, source.name, windowItem);
    });

    windowGridContainer.appendChild(windowItem);
  });
}

// Select a window
function selectWindow(sourceId, sourceName, element) {
  // Remove previous selection
  document.querySelectorAll('.window-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Mark as selected
  if (element) element.classList.add('selected');
  selectedSourceId = sourceId;
  
  // Extract window handle from ID (format: win32:12345)
  if (sourceId.startsWith('win32:')) {
    selectedWindowHandle = sourceId.split(':')[1];
  }
  
  captureKind = 'window'; // Track kind
  
  // Clear any existing system picker stream
  if (directStream) {
    directStream.getTracks().forEach(track => track.stop());
    directStream = null;
  }
  
  // Update status label
  const selectionStatus = document.getElementById('selectionStatus');
  if (selectionStatus) {
      selectionStatus.textContent = `${sourceName} selected`;
      selectionStatus.style.color = '#fff';
  }
  
  // Enable record button
  recordBtn.disabled = false;
  
  console.log('Window selected:', sourceId, 'Handle:', selectedWindowHandle);
  // Hide grid once a window is selected
  windowGrid.classList.remove('active');
  window.electronAPI.shrinkWindow();
}

// Start in window selection mode by default
// showWindowGrid is already called at line 43
// enterWindowSelectionMode(); // REMOVE THIS BROKEN LINE

// Show window selector (Mission Control style)
// Legacy function removed


// Select full screen mode
async function selectFullScreen() {
  selectWindowBtn.classList.remove('active');
  fullScreenBtn.classList.add('active');
  
  // Hide window grid
  windowGrid.classList.remove('active');
  window.electronAPI.shrinkWindow();
  
  try {
     const sources = await window.electronAPI.getSources();
     const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
     
     const selectionStatus = document.getElementById('selectionStatus');
     if (screenSource) {
         selectedSourceId = screenSource.id;
         captureKind = 'screen';
         directStream = null; // Ensure we don't use the picker stream
         
         if (selectionStatus) {
            selectionStatus.textContent = 'Full Screen selected';
            selectionStatus.style.color = '#fff';
         }
         recordBtn.disabled = false;
         console.log('Full screen auto-selected:', screenSource.id);
     } else {
         throw new Error('No screen source found');
     }
  } catch (e) {
      console.error('Auto-select full screen failed:', e);
      const selectionStatus = document.getElementById('selectionStatus');
      if (selectionStatus) selectionStatus.textContent = 'Selection failed';
  }
}

// Select a source (legacy function, kept for compatibility)
async function selectSource(sourceId) {
  selectedSourceId = sourceId;
  recordBtn.disabled = false;
}

// Hide source selector modal (legacy function)
function hideSourceSelector() {
  // Not needed anymore but kept for compatibility
}

// Start countdown
async function startCountdown() {
  recordBtn.style.display = 'none';
  countdown.style.display = 'block';
  
  for (let i = 3; i > 0; i--) {
    countdown.textContent = i;
    countdown.style.animation = 'none';
    setTimeout(() => {
      countdown.style.animation = 'pulse 0.5s ease-in-out';
    }, 10);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  countdown.style.display = 'none';
  startRecording();
}

// Start recording
async function startRecording() {
  if (!selectedSourceId && !directStream && captureKind !== 'screen') {
    alert('Please select a window or screen first');
    return;
  }

  // Hide the toolbar during recording
  document.body.style.opacity = '0';
  
  // Small delay to ensure toolbar is hidden
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    // Start FFmpeg recording
    const result = await window.electronAPI.startRecording({
      type: captureKind,
      windowHandle: selectedWindowHandle
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to start recording');
    }
    
    console.log('Recording started:', result.videoPath);
    
    // Decide toolbar visibility: hide during full-screen capture (best effort)
    if (captureKind === 'screen') {
      // Keep toolbar hidden to avoid being in capture
      window.electronAPI.hideToolbar();
    } else {
      document.body.style.opacity = '1';
    }
    
    // Hide status label
    selectionStatus.style.display = 'none';

    // Show timer and stop button
    stopBtn.style.display = 'flex';
    timer.style.display = 'block';
    recordingStartTime = Date.now();
    
    timerInterval = setInterval(updateTimer, 100);

  } catch (err) {
    console.error('Error starting recording:', err);
    document.body.style.opacity = '1';
    alert('Could not start recording. Error: ' + err.message);
    recordBtn.style.display = 'flex';
  }
}

// Update timer display
function updateTimer() {
  if (!recordingStartTime) return;
  
  const elapsed = Date.now() - recordingStartTime;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const ms = Math.floor((elapsed % 1000) / 100);
  
  timer.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

// Stop recording
async function stopRecording() {
  try {
    clearInterval(timerInterval);
    stopBtn.style.display = 'none';
    timer.style.display = 'none';
    recordBtn.style.display = 'flex';
    
    const result = await window.electronAPI.stopRecording();
    
    if (result.success) {
      console.log('Recording saved:', result.videoPath);
      if (result.mouseDataPath) {
        console.log('Mouse data saved:', result.mouseDataPath);
      }
      alert(`Recording saved!\nVideo: ${result.videoPath}${result.mouseDataPath ? '\nMouse data: ' + result.mouseDataPath : ''}`);
    }
    
    // Restore toolbar after recording stops
    window.electronAPI.showToolbar();
    document.body.style.opacity = '1';
    selectionStatus.style.display = 'block';
    directStream = null;
    selectedSourceId = null;
    selectedWindowHandle = null;
    recordBtn.disabled = true;
    selectWindowBtn.classList.remove('active');
    fullScreenBtn.classList.remove('active');
    selectionStatus.textContent = 'No source selected';
    selectionStatus.style.color = 'rgba(255, 255, 255, 0.7)';
  } catch (err) {
    console.error('Error stopping recording:', err);
    alert('Error stopping recording: ' + err.message);
  }
}

// Handle recording stop
function handleRecordingStop() {
  if (recordedChunks.length === 0) {
    alert('No data recorded');
    return;
  }
  
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  
  // Download the file
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `recording-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  
  // Reset
  recordedChunks = [];
  selectedSourceId = null;
  recordBtn.disabled = true;
  selectWindowBtn.classList.remove('active');
  fullScreenBtn.classList.remove('active');
}

// Start the system picker (getDisplayMedia) as a reliable fallback
async function startSystemPicker(kind = 'screen') {
  try {
    const displayMediaOptions = {
      video: true,
      audio: false,
      // Some browsers/electron builds may honor these hints
      monitorTypeSurfaces: kind === 'screen' ? 'include' : 'exclude',
      selfBrowserSurface: 'exclude'
    };
    const sysStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    directStream = sysStream;
    captureKind = kind;
    selectedSourceId = null; // Not needed with direct stream
    recordBtn.disabled = false;
    // Hide grid if it was open
    windowGrid.classList.remove('active');
  } catch (e) {
    console.error('System picker failed:', e);
    alert('Screen selection failed. Please try again.');
  }
}
