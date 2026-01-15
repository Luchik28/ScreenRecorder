const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');
const FFmpegRecorder = require('./ffmpeg-recorder');
const { getWindows, maximizeWindow, getWindowRect } = require('./window-utils');

let recorder = new FFmpegRecorder();

let mainWindow;

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
  
  // Open DevTools for debugging
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  // Commenting out custom handler to allow native system picker (more reliable)
  /*
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      // Fallback when system picker is unavailable: pick first screen
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const screenSource = sources.find(s => s.id && s.id.startsWith('screen:')) || sources[0];
          if (screenSource) {
            callback({ video: screenSource });
          } else {
            console.error('No capturable sources found');
            callback({ video: null });
          }
        })
        .catch(err => {
          console.error('desktopCapturer.getSources failed:', err);
          callback({ video: null });
        });
    }, { useSystemPicker: true });
  } catch (e) {
    console.error('Failed to set display media request handler:', e);
  }
  */

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
  console.log('IPC: get-sources called');
  try {
    // Get thumbnails from Electron's desktopCapturer as well
    const electronSources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'], 
      thumbnailSize: { width: 300, height: 200 } 
    });

    const windows = await getWindows();
    const results = windows.map(win => {
      // Try to find a matching Electron source for the thumbnail
      const match = electronSources.find(s => s.name === win.Title || s.id.includes(win.ProcessId.toString()));
      
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
    mainWindow.hide();
  }
});

ipcMain.on('show-toolbar', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }
});

// Handle manual window maximization
ipcMain.handle('maximize-target-window', async (event, handle) => {
  return await maximizeWindow(handle);
});

// Start FFmpeg recording
ipcMain.handle('start-recording', async (event, options) => {
  try {
    recorder = new FFmpegRecorder();
    let videoPath;
    
    if (options.type === 'window' && options.windowHandle) {
      // Get window title for FFmpeg (needs to be exact for title= prefix)
      const windows = await getWindows();
      const targetWindow = windows.find(w => w.Handle == options.windowHandle);
      
      if (!targetWindow) throw new Error('Window not found');

      // Maximize the window first
      await maximizeWindow(options.windowHandle);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for maximize animation
      
      videoPath = await recorder.startWindowRecording(targetWindow.Title);
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
    
    if (result && result.mouseData.length > 0) {
      const mouseDataPath = recorder.saveMouseData(result.mouseData);
      return {
        success: true,
        videoPath: result.videoPath,
        mouseDataPath
      };
    }
    
    return { success: true, videoPath: result?.videoPath };
  } catch (err) {
    console.error('Recording stop failed:', err);
    return { success: false, error: err.message };
  }
});
