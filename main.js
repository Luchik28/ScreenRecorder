const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const FFmpegRecorder = require('./ffmpeg-recorder');
const { getWindows, maximizeWindow, getWindowRect } = require('./window-utils');

let recorder = new FFmpegRecorder();

let mainWindow;

// Register custom protocol for local media
protocol.registerSchemesAsPrivileged([
  { 
    scheme: 'media', 
    privileges: { 
      bypassCSP: true, 
      stream: true, 
      secure: true, 
      supportFetchAPI: true, 
      corsEnabled: true 
    } 
  }
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile('index.html');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  
  // Prevent toolbar from appearing in any screen recording
  mainWindow.setContentProtection(true);
  
  // Ensure it doesn't minimize when losing focus
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
  });
}

// Global reference for the preview window to prevent garbage collection
let previewWindow;

app.whenReady().then(() => {
  // Simple and highly compatible protocol handler
  protocol.handle('media', async (request) => {
    try {
      // Extract path: media://C:/Users/... -> C:/Users/...
      const url = new URL(request.url);
      let p = decodeURIComponent(url.pathname);
      
      // On Windows, if pathname starts with /C:/, strip the leading /
      if (process.platform === 'win32' && p.startsWith('/') && p.includes(':')) {
        p = p.substring(1);
      }
      
      const absolutePath = path.resolve(p);

      if (!fs.existsSync(absolutePath)) {
        console.error(`[Media Protocol] Not found: ${absolutePath}`);
        return new Response('Not found', { status: 404 });
      }

      // Using pathToFileURL ensures the file path is correctly encoded for net.fetch
      const fileUrl = pathToFileURL(absolutePath).toString();
      return net.fetch(fileUrl);
    } catch (error) {
      console.error('[Media Protocol] Error:', error);
      return new Response('Error', { status: 500 });
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
    // Check if we have any other windows (like the editor) before quitting
    if (BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  }
});

ipcMain.handle('get-sources', async () => {
  try {
    // Apps that cannot be recorded (content-protected or system apps)
    const unrecordableApps = [
      'PromoCam',
      'Promo',
      'ScreenRecorder', 
      'Realtek Audio Console',
      'Windows Input Experience',
      'TextInputHost',
      'ApplicationFrameHost'
    ];
    
    // Get thumbnails from desktopCapturer
    const electronSources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'], 
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: true
    }).catch(() => []);

    const windows = await getWindows();
    
    // Filter out unrecordable apps
    const recordableWindows = windows.filter(win => {
      // Filter by process name
      if (win.ProcessName && unrecordableApps.some(app => 
        win.ProcessName.toLowerCase().includes(app.toLowerCase())
      )) {
        return false;
      }
      // Filter by window title
      if (unrecordableApps.some(app => 
        win.Title.toLowerCase().includes(app.toLowerCase())
      )) {
        return false;
      }
      return true;
    });
    
    const results = recordableWindows.map(win => {
      // Improved matching: try exact title, substring, then process name hints
      let match = electronSources.find(s => s.name === win.Title);
      if (!match) {
        match = electronSources.find(s => 
          win.Title.toLowerCase().includes(s.name.toLowerCase()) || 
          s.name.toLowerCase().includes(win.Title.toLowerCase())
        );
      }
      // Try matching by partial words in title
      if (!match) {
        const titleWords = win.Title.toLowerCase().split(/[\s\-–—|:]+/).filter(w => w.length > 3);
        match = electronSources.find(s => 
          titleWords.some(word => s.name.toLowerCase().includes(word))
        );
      }
      
      return {
        id: `win32:${win.Handle}`,
        name: win.Title,
        handle: win.Handle,
        processName: win.ProcessName || '',
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
// Save video to downloads (with optional trimming)
ipcMain.on('save-video-to-downloads', async (event, videoPath, trimInfo) => {
  const { shell } = require('electron');
  const downloadsPath = path.join(require('os').homedir(), 'Downloads');
  const fileName = `promo-${Date.now()}.mp4`;
  const destPath = path.join(downloadsPath, fileName);
  
  try {
    if (trimInfo && (trimInfo.start > 0 || trimInfo.duration)) {
      console.log('Trimming video:', trimInfo);
      const tempRecorder = new FFmpegRecorder();
      await FFmpegRecorder.trimVideo(
        videoPath, 
        destPath, 
        trimInfo.start, 
        trimInfo.duration,
        tempRecorder.ffmpegPath
      );
    } else {
      fs.copyFileSync(videoPath, destPath);
    }
    shell.showItemInFolder(destPath);
  } catch (err) {
    console.error('Failed to save/trim video:', err);
  }
});
// Start FFmpeg recording (Step 1: Video only)
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
    
    // We don't start mouse tracking here anymore - we wait for the trigger
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
      
      const query = `video=${encodeURIComponent(result.videoPath)}&mouse=${encodeURIComponent(mouseDataPath || '')}`;
      
      previewWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#1a1a1a',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
          devTools: true
        }
      });
      
      previewWindow.loadFile('recording.html', { search: query });
      previewWindow.maximize();

      previewWindow.on('closed', () => {
        previewWindow = null;
      });

      // Close toolbar window after preview opens to stay alive
      if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
      }
      
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

// Handle save dialog for export
ipcMain.handle('show-save-dialog', async (event, options) => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog(previewWindow || mainWindow, options);
});

// Export video with effects (cursor + zoom)
ipcMain.on('export-video-with-effects', async (event, exportOptions) => {
  const VideoExporter = require('./video-export');
  const exporter = new VideoExporter(recorder.ffmpegPath);
  
  try {
    await exporter.exportWithEffects(exportOptions, (progress) => {
      // Send progress updates to preview window
      if (previewWindow) {
        previewWindow.webContents.send('export-progress', progress);
      }
    });
    
    console.log('Export complete:', exportOptions.outputPath);
    
    // Show success notification
    if (previewWindow) {
      previewWindow.webContents.send('export-complete', { success: true, path: exportOptions.outputPath });
    }
    
    // Open folder containing exported file
    const { shell } = require('electron');
    shell.showItemInFolder(exportOptions.outputPath);
  } catch (err) {
    console.error('Export failed:', err);
    if (previewWindow) {
      previewWindow.webContents.send('export-complete', { success: false, error: err.message });
    }
  }
});

