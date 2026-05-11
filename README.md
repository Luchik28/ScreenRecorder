# Promo Screen Recorder

Promo Screen Recorder is a desktop app for capturing product demos, walkthroughs, and polished promo clips. It is built with Electron and is designed to make source selection, recording, and post-recording editing feel fast and focused.

Live demo: https://promocam.vercel.app/

## What it does

The app gives you a floating toolbar to pick a window or the entire screen, start a short countdown, and record your capture. After recording, a built-in editor opens so you can review the clip, trim it, adjust zoom events, and export the final video.

## Key features

- Floating always-on-top toolbar with quick source selection
- Window capture or full-screen capture
- Short countdown before recording starts
- FFmpeg-backed recording pipeline for reliable output
- Built-in preview/editor for trimming and playback
- Cursor and zoom controls for promo-style edits
- Export helpers that save the finished video to your Downloads folder

## Tech stack

- Electron for the desktop shell
- FFmpeg for capture and export
- Browser APIs for preview and timeline editing
- Native desktop capture APIs for source enumeration

## Prerequisites

- Node.js 18 or newer is recommended
- npm, which is included with Node.js

Depending on your platform, some native window-selection features may behave differently. Full-screen capture is the safest option if native window enumeration is limited on your desktop environment.

## Onboarding

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm start
```

4. If you want the development entrypoint used by this repo, run:

```bash
npm run dev
```

## How to use

### 1. Open the toolbar

Run the app and the floating toolbar appears near the top of the screen.

### 2. Choose what to record

- Click `Window` to browse available application windows.
- Click `Full Screen` to capture the whole display.
- Once a source is selected, the `Record` button becomes available.

### 3. Start recording

- Click `Record`.
- The app prepares FFmpeg and shows a short countdown.
- Recording starts after the countdown completes.

### 4. Capture your demo

- Interact with the app you are recording.
- The recording workflow is designed for promo-style screen capture.
- If you are recording a window, the app attempts to maximize it for a cleaner frame.

### 5. Stop and review

- Click `Stop` when you are done.
- A preview/editor window opens with the recorded clip.
- Use the timeline and controls to trim, scrub, and fine-tune the result.

### 6. Export

- Save the final video from the editor.
- Exports are written to your Downloads folder and the folder is opened for convenience.

## Outputs

The repository currently supports two practical output flows:

- The main Electron workflow records with FFmpeg and exports an MP4 copy to Downloads.
- The preview/editor can also work with trim ranges and cursor/zoom effects before exporting.

## Project structure

```text
ScreenRecorder/
├── main.js
├── preload.js
├── recording-preload.js
├── recording-view.js
├── recording.js
├── ffmpeg-recorder.js
├── video-export.js
├── window-utils.js
├── index.html
├── recording.html
├── renderer.js
├── styles.css
├── package.json
└── README.md
```

## Development notes

- `main.js` wires up the Electron app, source selection, and recording/export IPC.
- `renderer.js` drives the floating toolbar UI.
- `recording-view.js` powers the post-recording preview and editing experience.
- `recording.js` contains the lighter browser-side recording demo flow used by the recording page.

If you are changing the recording pipeline, test both the source-selection flow and the preview/export flow. They are connected, but they are not the same code path.

## Troubleshooting

### The app does not start

- Confirm Node.js is installed.
- Run `npm install` again to make sure dependencies are present.
- Check whether Electron is blocked by local platform policies.

### No windows appear in the picker

- Some desktop environments expose fewer native windows than others.
- Try `Full Screen` if the window list is empty.
- Make sure the target app is visible and not minimized.

### Recording looks wrong

- Record at the resolution you actually want to ship.
- If window capture behaves unexpectedly, try full-screen capture instead.
- On some systems, permissions or compositor settings can affect capture quality.

### Exported file is missing

- The app opens the destination folder after export.
- Check your Downloads folder for a file named like `promo-<timestamp>.mp4`.

## Contributing

Contributions are welcome. A good first pass is to open an issue or PR that improves the capture flow, editor UX, or export reliability.

## License

MIT
