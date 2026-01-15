const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const FFmpegRecorder = require('./ffmpeg-recorder');
const { getWindows, maximizeWindow, getWindowRect } = require('./window-utils');

let recorder = new FFmpegRecorder();

let mainWindow;

// Register custom protocol for local media
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, stream: true } }
]);

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 800,
    height: 80,
    x: Math.floor((width - 800) / 2),
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  
    // Ensure it doesn't minimize when losing focus
    mainWindow.on('blur', () => {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    });
}

app.whenReady().then(() => {
  // Handle local media loading
  protocol.registerFileProtocol('media', (request, callback) => {
    const url = request.url.replace('media:///', '');
    try {
      return callback({ path: path.normalize(decodeURIComponent(url)) });
    } catch (error) {
      console.error('Failed to register protocol', error);
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-sources', async () => {
  try {
    // Suppress console errors from desktopCapturer thumbnails
    const electronSources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'], 
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: true
    }).catch(() => []);

    const windows = await getWindows();
    const results = windows.map(win => {
      // Improved matching logic: try title, then try substring matches
      let match = electronSources.find(s => s.name === win.Title);
      if (!match) {
        match = electronSources.find(s => win.Title.includes(s.name) || s.name.includes(win.Title));
      }
      
      return {
        id: `win32:${win.Handle}`,
        name: win.Title,
        handle: win.Handle,
        thumbnail: match ? match.thumbnail.toDataURL() : null,
        appIcon: match ? match.appIcon?.toDataURL() : null
      };
    });

    // Add full screen option
    const desktopSource = electronSources.find(s => s.id.startsWith('screen:'));
    results.unshift({
      id: 'screen:desktop',
      name: 'Entire screen (Desktop)',
      handle: 0,
      thumbnail: desktopSource ? desktopSource.thumbnail.toDataURL() : null,
      appIcon: null
    });

    return results;
  } catch (err) {
    console.error('Error fetching windows:', err);
    return [];
  }
});

// Handle getting mouse position
ipcMain.handle('get-mouse-position', () => {
  return screen.getCursorScreenPoint();
});

// Handle closing the app
ipcMain.on('close-app', () => {
  app.quit();
});

// Handle minimize
ipcMain.on('minimize-app', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

// Handle window expansion for grid
ipcMain.on('expand-window', () => {
  if (mainWindow) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    // Expand to almost full screen to show the window grid
    mainWindow.setBounds({
      width: 1200,
      height: 800,
      x: Math.floor((width - 1200) / 2),
      y: 20
    }, true);
  }
});

ipcMain.on('shrink-window', () => {
  if (mainWindow) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    
    // Return to toolbar size
    mainWindow.setBounds({
      width: 800,
      height: 80,
      x: Math.floor((width - 800) / 2),
      y: 20
    }, true);
  }
});

// Hide/show toolbar window (best effort to avoid full-screen capture)
ipcMain.on('hide-toolbar', () => {
  if (mainWindow) {
    // Instead of hide(), we set opacity to 0 and make it click-through
    // to keep it "active" in the OS but invisible to the capture.
    mainWindow.setOpacity(0.01); 
    mainWindow.setIgnoreMouseEvents(true);
  }
});

ipcMain.on('show-toolbar', () => {
  if (mainWindow) {
    mainWindow.setOpacity(1.0);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }
});

// Handle manual window maximization
ipcMain.handle('maximize-target-window', async (event, handle) => {
  const result = await maximizeWindow(handle);
  // Optimization: Shrink toolbar window fast after clicking
  if (mainWindow) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    mainWindow.setBounds({
      width: 800,
      height: 80,
      x: Math.floor((width - 800) / 2),
      y: 20
    }, false); // Set useAnchor to false/immediate
  }
  return result;
});
// Save video to downloads
ipcMain.on('save-video-to-downloads', (event, videoPath) => {
  const { shell } = require('electron');
  const downloadsPath = path.join(require('os').homedir(), 'Downloads');
  const fileName = path.basename(videoPath);
  const destPath = path.join(downloadsPath, fileName);
  
  fs.copyFileSync(videoPath, destPath);
  shell.showItemInFolder(destPath);
});
// Start FFmpeg recording
ipcMain.handle('start-recording', async (event, options) => {
  try {
    recorder = new FFmpegRecorder();
    console.log('Using FFmpeg at:', recorder.ffmpegPath);
    let videoPath;
    
    if (options.type === 'window' && options.windowHandle) {
      // Get window info
      const windows = await getWindows();
      const targetWindow = windows.find(w => w.Handle == options.windowHandle);
      
      if (!targetWindow) throw new Error('Window not found');

      // Maximize the window first
      await maximizeWindow(options.windowHandle);
      // Reduced delay since we pre-maximize during countdown
      await new Promise(resolve => setTimeout(resolve, 300)); 
      
      videoPath = await recorder.startWindowRecording(options.windowHandle, targetWindow.Title);
    } else {
      // Full screen recording
      videoPath = await recorder.startScreenRecording();
    }
    
    // Start mouse tracking
    recorder.startMouseTracking();
    
    return { success: true, videoPath };
  } catch (err) {
    console.error('Recording start failed:', err);
    return { success: false, error: err.message };
  }
});

// Stop FFmpeg recording
ipcMain.handle('stop-recording', async () => {
  try {
    const result = await recorder.stopRecording();
    
    if (result && result.videoPath) {
      // Save mouse data
      let mouseDataPath = null;
      if (result.mouseData && result.mouseData.length > 0) {
        mouseDataPath = recorder.saveMouseData(result.mouseData);
      }

      console.log('Recording saved:', result.videoPath);
      
      // Close toolbar window
      if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
      }
      
      const previewWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#1a1a1a',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false // Allow loading local files for the preview
        }
      });
      
      const query = `video=${encodeURIComponent(result.videoPath)}&mouse=${encodeURIComponent(mouseDataPath || '')}`;
      previewWindow.loadFile('recording.html', { search: query });
      
      return {
        success: true,
        videoPath: result.videoPath,
        mouseDataPath: mouseDataPath
      };
    }
    return { success: false, error: 'Recording failed' };
  } catch (err) {
    console.error('Recording stop failed:', err);
    return { success: false, error: err.message };
  }
});
