const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getFFmpegPath() {
  // Check common WinGet location found on this system
  const wingetPath = path.join(
    process.env.LOCALAPPDATA, 
    'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin/ffmpeg.exe'
  ).replace(/\//g, '\\');

  if (fs.existsSync(wingetPath)) return wingetPath;
  
  // Fallback to searching in PATH
  return 'ffmpeg';
}

class FFmpegRecorder {
  constructor() {
    this.process = null;
    this.outputPath = null;
    this.mousePositions = [];
    this.mouseTrackingInterval = null;
    this.ffmpegPath = getFFmpegPath();
  }

  // Start recording a specific window (using Desktop capture since we maximize it)
  async startWindowRecording(windowHandle, windowTitle, outputPath) {
    const recDir = path.join(process.cwd(), 'recs');
    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir);
    this.outputPath = outputPath || path.join(recDir, `recording-${Date.now()}.mp4`);
    
    // We use 'desktop' instead of 'hwnd=' or 'title=' because it's significantly 
    // more stable with hardware-accelerated apps (Chrome, Discord, VS Code).
    // Since we maximize the window, 'desktop' capture is exactly what we want.
    const args = [
      '-f', 'gdigrab',
      '-draw_mouse', '0',
      '-framerate', '60',
      '-i', 'desktop', 
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-y',
      this.outputPath
    ];

    console.log(`Starting capture for: ${windowTitle}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(this.ffmpegPath, args);
      
      let started = false;

      this.process.stderr.on('data', (data) => {
        const output = data.toString();
        // Check if recording has actually started
        if (!started && output.includes('frame=')) {
          started = true;
          this.startMouseTracking(); // Start tracking exactly when video starts flowing
          resolve(this.outputPath);
        }
      });

      this.process.on('error', (err) => {
        console.error('FFmpeg failed to spawn:', err);
        if (!started) reject(err);
      });

      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`FFmpeg exited with code ${code}. This usually means capture was interrupted.`);
        }
      });

      // Timeout if recording doesn't start
      setTimeout(() => {
        if (!started) {
          reject(new Error('FFmpeg failed to start recording (Timeout)'));
        }
      }, 5000);
    });
  }

  // Start recording full screen
  async startScreenRecording(outputPath) {
    const recDir = path.join(process.cwd(), 'recs');
    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir);
    this.outputPath = outputPath || path.join(recDir, `recording-${Date.now()}.mp4`);
    
    const args = [
      '-f', 'gdigrab',
      '-draw_mouse', '0',  // Hide mouse cursor
      '-framerate', '60',
      '-i', 'desktop',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-y',
      this.outputPath
    ];

    return new Promise((resolve, reject) => {
      this.process = spawn(this.ffmpegPath, args);
      
      let started = false;
      
      this.process.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('FFmpeg:', output);
        
        if (!started && output.includes('frame=')) {
          started = true;
          this.startMouseTracking(); // Start tracking exactly when video starts flowing
          resolve(this.outputPath);
        }
      });

      this.process.on('error', (err) => {
        console.error('FFmpeg error:', err);
        if (!started) reject(err);
      });

      setTimeout(() => {
        if (!started) {
          reject(new Error('FFmpeg failed to start recording'));
        }
      }, 5000);
    });
  }

  // Start tracking mouse positions
  startMouseTracking() {
    const { screen } = require('electron');
    this.mousePositions = [];
    const startTime = Date.now();
    
    // Get display scale factor (e.g., 1.25 for 125% scaling)
    // This is needed because getCursorScreenPoint returns logical pixels
    // but FFmpeg captures at physical/native resolution
    const primaryDisplay = screen.getPrimaryDisplay();
    this.displayScaleFactor = primaryDisplay.scaleFactor || 1;
    console.log('Display scale factor:', this.displayScaleFactor);

    // Simple click detection using PowerShell GetAsyncKeyState without Add-Type
    // We'll use a direct command that polls the mouse state
    const clickCommand = `
$signature = '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);';
$type = Add-Type -MemberDefinition $signature -Name User32 -Namespace Win32 -PassThru;
$wasPressed = $false;
while($true) {
  $state = $type::GetAsyncKeyState(1);
  $isPressed = $state -lt 0;
  if($isPressed -and -not $wasPressed) { Write-Output 'CLICK' };
  $wasPressed = $isPressed;
  Start-Sleep -Milliseconds 15;
}
`;

    this.clickDetector = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', clickCommand],
      { windowsHide: true }
    );
    let clickPending = false;
    this.clickDetector.stdout.setEncoding('utf8');
    let clickBuf = '';
    this.clickDetector.stdout.on('data', (data) => {
      clickBuf += data;
      let idx;
      while ((idx = clickBuf.indexOf('\n')) !== -1) {
        const line = clickBuf.slice(0, idx).trim();
        clickBuf = clickBuf.slice(idx + 1);
        if (line === 'CLICK') {
          clickPending = true;

          // Debug signal (prints occasionally so we can confirm clicks are flowing)
          this._clickCount = (this._clickCount || 0) + 1;
          console.log('Click recorded! Total:', this._clickCount);
        }
      }
    });

    this.clickDetector.stderr.on('data', (data) => {
      // If the script fails to compile Add-Type or otherwise errors, this will tell us.
      console.error('Click detector stderr:', data.toString());
    });

    this.clickDetector.on('exit', (code) => {
      console.error('Click detector exited with code:', code);
    });
    
    // Increased frequency for super smooth playback (125 samples per second)
    this.mouseTrackingInterval = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const timestamp = Date.now() - startTime;
      
      const hasClick = clickPending;
      clickPending = false; // Reset for next poll
      
      // Apply display scale factor to convert logical pixels to physical pixels
      // This ensures mouse coordinates match the FFmpeg capture resolution
      this.mousePositions.push({
        x: Math.round(point.x * this.displayScaleFactor),
        y: Math.round(point.y * this.displayScaleFactor),
        time: timestamp,
        click: hasClick
      });
    }, 8); 
  }

  // Stop recording
  async stopRecording() {
    return new Promise((resolve) => {
      if (this.mouseTrackingInterval) {
        clearInterval(this.mouseTrackingInterval);
        this.mouseTrackingInterval = null;
      }

      if (this.clickDetector) {
        this.clickDetector.kill();
        this.clickDetector = null;
      }

      if (!this.process) {
        resolve(null);
        return;
      }

      this.process.on('close', () => {
        const result = {
          videoPath: this.outputPath,
          mouseData: this.mousePositions
        };
        this.process = null;
        this.mousePositions = [];
        resolve(result);
      });

      // Send quit command to FFmpeg
      this.process.stdin.write('q');
    });
  }

  // Save mouse position data to JSON
  saveMouseData(mouseData, jsonPath) {
    if (!mouseData || mouseData.length === 0) return null;
    
    const recDir = path.join(process.cwd(), 'recs');
    const dataPath = jsonPath || this.outputPath.replace('.mp4', '-mouse.json');
    fs.writeFileSync(dataPath, JSON.stringify({
      positions: mouseData,
      duration: mouseData[mouseData.length - 1]?.time || 0
    }, null, 2));
    
    return dataPath;
  }

  // Trim video using FFmpeg
  static async trimVideo(inputPath, outputPath, startTime, duration, ffmpegPath) {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
      const args = [
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-i', inputPath,
        '-c', 'copy', // Copy codec for instant trimming
        '-y',
        outputPath
      ];
      
      const process = spawn(ffmpegPath || 'ffmpeg', args);
      process.on('close', (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error(`FFmpeg trim failed with code ${code}`));
      });
    });
  }
}

module.exports = FFmpegRecorder;
