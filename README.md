# Promo Screen Recorder 📹

A beautiful desktop application for creating promotional screenshots and screen recordings with automatic zoom effects. Built with Electron.

## Features

✨ **Frosted Glass Toolbar** - Elegant floating toolbar with frosted glass effect  
🎯 **Window Selection** - Hover and select any application window or entire screen  
⏺️ **Smart Recording** - Automatically zooms in/out based on user interactions  
🎬 **Auto Zoom Effects** - Smooth zoom animations when you click or type  
✏️ **Editable Timeline** - Adjust zoom points after recording  
⬇️ **Export Video** - Download your promotional video as WebM

## Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Application**
   ```bash
   npm start
   ```

## How to Use

### Step 1: Launch the App
Run `npm start` to launch the floating toolbar at the top of your screen.

### Step 2: Select Window
1. Click the **"Select Window"** button
2. Browse through available windows and screens
3. Click on the one you want to record
4. Hover over applications to see a visible outline (when implemented)

### Step 3: Start Recording
1. Click the **"Record"** button
2. Interact with your application:
   - Click anywhere to trigger zoom-in
   - Type to trigger zoom effects
   - The video automatically switches between zoomed-in and zoomed-out views

### Step 4: Stop & Edit
1. Click **"Stop Recording"** when done
2. Use the timeline editor to:
   - Drag zoom markers to adjust timing
   - Add new zoom points
   - Clear all zoom effects
3. Preview your video

### Step 5: Download
Click **"Download Video"** to save your promotional recording.

## Project Structure

```
ScreenRecorder/
├── main.js              # Electron main process
├── preload.js           # Main window preload script
├── recording-preload.js # Recording window preload script
├── index.html           # Toolbar UI
├── recording.html       # Recording interface
├── renderer.js          # Toolbar logic
├── recording.js         # Recording & zoom logic
├── styles.css           # Toolbar styles
├── package.json         # Project dependencies
└── README.md           # This file
```

## Technical Details

### Technologies Used
- **Electron** - Cross-platform desktop framework
- **MediaRecorder API** - Screen recording
- **DesktopCapturer API** - Window/screen selection
- **CSS Backdrop Filter** - Frosted glass effects

### Zoom System
The app automatically detects user interactions:
- Mouse clicks trigger zoom to clicked area
- Keyboard input triggers zoom effects
- Smooth CSS transitions with cubic-bezier easing
- Editable zoom timeline for fine-tuning

### Recording Format
- **Video Codec**: VP9 (VP8 fallback)
- **Container**: WebM
- **Resolution**: Up to 1920x1080

## Customization

### Adjust Zoom Intensity
Edit `recording.js` line 79:
```javascript
targetZoom = targetZoom === 1 ? 1.5 : 1; // Change 1.5 to your desired zoom level
```

### Change Zoom Animation Speed
Edit `recording.js` line 95:
```javascript
const duration = 500; // Change duration in milliseconds
```

### Modify Background Blur
Edit `styles.css` line 14:
```css
backdrop-filter: blur(20px); /* Adjust blur radius */
```

## Future Enhancements

- [ ] Real-time window outline when hovering
- [ ] Custom background gradients for zoomed-out view
- [ ] Multiple export formats (MP4, GIF)
- [ ] Add text overlays and annotations
- [ ] Webcam overlay support
- [ ] Audio recording with voiceover
- [ ] Cloud export options

## Troubleshooting

**App won't start?**
- Make sure Node.js is installed
- Run `npm install` first
- Check for Electron compatibility

**Recording not working?**
- Grant screen recording permissions in System Preferences (macOS)
- Ensure you've selected a source window

**Video quality issues?**
- Recording captures at source resolution
- Check your display resolution settings

## Development

To run in development mode with DevTools:
```bash
npm run dev
```

## License

MIT License - Feel free to use and modify!

---

Made with ❤️ using Electron
