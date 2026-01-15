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

  // Start recording a specific window
  async startWindowRecording(windowTitle, outputPath) {
    this.outputPath = outputPath || path.join(process.cwd(), `recording-${Date.now()}.mp4`);
    
    // FFmpeg gdigrab uses 'title=WINDOW_TITLE'
    // Note: Some windows might have special characters that need escaping.
    const args = [
      '-f', 'gdigrab',
      '-draw_mouse', '0',
      '-framerate', '30',
      '-i', `title=${windowTitle}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-y',
      this.outputPath
    ];

    console.log(`Spawning FFmpeg (${this.ffmpegPath}) with args:`, args.join(' '));

    return new Promise((resolve, reject) => {
      this.process = spawn(this.ffmpegPath, args);
      
      let started = false;
      
      this.process.stderr.on('data', (data) => {
        const output = data.toString();
        console.log('FFmpeg:', output);
        
        // Check if recording has started
        if (!started && output.includes('frame=')) {
          started = true;
          resolve(this.outputPath);
        }
      });

      this.process.on('error', (err) => {
        console.error('FFmpeg error:', err);
        if (!started) reject(err);
      });

      // Timeout if recording doesn't start
      setTimeout(() => {
        if (!started) {
          reject(new Error('FFmpeg failed to start recording'));
        }
      }, 5000);
    });
  }

  // Start recording full screen
  async startScreenRecording(outputPath) {
    this.outputPath = outputPath || path.join(process.cwd(), `recording-${Date.now()}.mp4`);
    
    const args = [
      '-f', 'gdigrab',
      '-draw_mouse', '0',  // Hide mouse cursor
      '-framerate', '30',
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
    
    this.mouseTrackingInterval = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const timestamp = Date.now() - startTime;
      this.mousePositions.push({
        x: point.x,
        y: point.y,
        time: timestamp
      });
    }, 16); // ~60fps tracking
  }

  // Stop recording
  async stopRecording() {
    return new Promise((resolve) => {
      if (this.mouseTrackingInterval) {
        clearInterval(this.mouseTrackingInterval);
        this.mouseTrackingInterval = null;
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
    
    const dataPath = jsonPath || this.outputPath.replace('.mp4', '-mouse.json');
    fs.writeFileSync(dataPath, JSON.stringify({
      positions: mouseData,
      duration: mouseData[mouseData.length - 1]?.time || 0
    }, null, 2));
    
    return dataPath;
  }
}

module.exports = FFmpegRecorder;
