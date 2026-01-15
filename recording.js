let mediaRecorder;
let recordedChunks = [];
let stream;
let zoomLevel = 1;
let targetZoom = 1;
let currentScale = 1;
let zoomPoints = [];
let recordingStartTime;
let animationFrame;

const preview = document.getElementById('preview');
const zoomContainer = document.getElementById('zoomContainer');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const recordingDot = document.getElementById('recordingDot');
const timeline = document.getElementById('timeline');
const timelineTrack = document.getElementById('timelineTrack');
const addZoomBtn = document.getElementById('addZoomBtn');
const clearZoomsBtn = document.getElementById('clearZoomsBtn');

// Listen for recording start signal
window.recordingAPI.onStartRecording(async (event, sourceId) => {
  await setupStream(sourceId);
});

async function setupStream(sourceId) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    });

    preview.srcObject = stream;
    preview.play();
    
    status.textContent = 'Stream ready - Click Start to begin';
    
    // Monitor for interactions (simulated for now)
    monitorInteractions();
    
  } catch (err) {
    console.error('Error accessing media devices:', err);
    status.textContent = 'Error: Could not access screen';
  }
}

function monitorInteractions() {
  // Detect clicks and keypresses to trigger zoom
  document.addEventListener('click', (e) => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      triggerZoom(e.clientX, e.clientY);
    }
  });

  document.addEventListener('keypress', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      triggerZoom();
    }
  });

  // Also monitor the preview video for interactions
  preview.addEventListener('click', (e) => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      const rect = preview.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      triggerZoom(x, y);
    }
  });
}

function triggerZoom(x, y) {
  const currentTime = Date.now() - recordingStartTime;
  
  // Toggle between zoomed in and zoomed out
  targetZoom = targetZoom === 1 ? 1.5 : 1;
  
  // Record zoom point
  zoomPoints.push({
    time: currentTime,
    zoom: targetZoom,
    x: x || window.innerWidth / 2,
    y: y || window.innerHeight / 2
  });
  
  animateZoom();
}

function animateZoom() {
  const duration = 500; // ms
  const startZoom = currentScale;
  const startTime = Date.now();
  
  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (ease-in-out)
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    currentScale = startZoom + (targetZoom - startZoom) * eased;
    
    zoomContainer.style.transform = `translate(-50%, -50%) scale(${currentScale})`;
    
    if (progress < 1) {
      animationFrame = requestAnimationFrame(animate);
    }
  }
  
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  animate();
}

startBtn.addEventListener('click', async () => {
  if (!stream) {
    status.textContent = 'Error: No stream available';
    return;
  }

  recordedChunks = [];
  zoomPoints = [];
  recordingStartTime = Date.now();

  const options = { mimeType: 'video/webm; codecs=vp9' };
  
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (err) {
    // Fallback to VP8 if VP9 is not supported
    const fallbackOptions = { mimeType: 'video/webm; codecs=vp8' };
    mediaRecorder = new MediaRecorder(stream, fallbackOptions);
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    status.textContent = 'Recording stopped - Ready to download';
    recordingDot.style.display = 'none';
    downloadBtn.style.display = 'flex';
    timeline.classList.add('active');
    renderTimeline();
  };

  mediaRecorder.start();
  
  startBtn.style.display = 'none';
  stopBtn.style.display = 'flex';
  recordingDot.style.display = 'block';
  status.textContent = 'Recording... Click or type to zoom';
});

stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    stopBtn.style.display = 'none';
  }
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `promo-recording-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  
  status.textContent = 'Video downloaded!';
});

function renderTimeline() {
  timelineTrack.innerHTML = '';
  
  if (zoomPoints.length === 0) return;
  
  const duration = Date.now() - recordingStartTime;
  
  zoomPoints.forEach((point, index) => {
    const marker = document.createElement('div');
    marker.className = 'zoom-marker';
    marker.style.left = `${(point.time / duration) * 100}%`;
    marker.style.width = '2%';
    marker.dataset.index = index;
    
    marker.addEventListener('mousedown', (e) => {
      // Allow dragging to adjust zoom timing
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = parseFloat(marker.style.left);
      
      function onMouseMove(e) {
        const deltaX = e.clientX - startX;
        const trackWidth = timelineTrack.offsetWidth;
        const deltaPercent = (deltaX / trackWidth) * 100;
        let newLeft = startLeft + deltaPercent;
        newLeft = Math.max(0, Math.min(98, newLeft));
        marker.style.left = `${newLeft}%`;
        
        // Update zoom point time
        zoomPoints[index].time = (newLeft / 100) * duration;
      }
      
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    timelineTrack.appendChild(marker);
  });
}

addZoomBtn.addEventListener('click', () => {
  const currentTime = (Date.now() - recordingStartTime) / 2;
  zoomPoints.push({
    time: currentTime,
    zoom: 1.5,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  });
  renderTimeline();
});

clearZoomsBtn.addEventListener('click', () => {
  zoomPoints = [];
  renderTimeline();
});

// Simulate auto-zoom during playback (for demonstration)
setInterval(() => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Randomly trigger zoom every 5-10 seconds for demo
    if (Math.random() < 0.1) {
      triggerZoom();
    }
  }
}, 1000);
