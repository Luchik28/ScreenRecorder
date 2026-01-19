const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class VideoExporter {
    constructor(ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
        this.activeZooms = []; // Track active zoom animations
    }

    async exportWithEffects(options, progressCallback) {
        const { videoPath, outputPath, mouseData, trimStart, trimDuration, zoomLevel, zoomDuration, autoZoomEnabled } = options;
        
        const tempFramesDir = path.join(path.dirname(outputPath), `temp_frames_${Date.now()}`);
        fs.mkdirSync(tempFramesDir, { recursive: true });

        try {
            // Step 1: Extract frames from video using FFmpeg
            progressCallback({ stage: 'extracting', progress: 0 });
            
            await this.extractFrames(videoPath, tempFramesDir, trimStart, trimDuration);
            
            // Step 2: Process each frame (draw cursor, apply zoom)
            progressCallback({ stage: 'processing', progress: 0 });
            
            const frames = fs.readdirSync(tempFramesDir)
                .filter(f => f.endsWith('.png'))
                .sort();
            
            // Pre-calculate zoom events from mouse data for the trimmed portion
            const zoomEvents = this.calculateZoomEvents(mouseData, trimStart * 1000, zoomDuration, 1000);
            
            await this.processFrames(frames, tempFramesDir, mouseData, trimStart * 1000, zoomLevel, zoomDuration, autoZoomEnabled, zoomEvents, progressCallback);
            
            // Step 3: Re-encode video from processed frames
            progressCallback({ stage: 'encoding', progress: 0 });
            
            await this.encodeVideo(tempFramesDir, outputPath, progressCallback);
            
            progressCallback({ stage: 'complete', progress: 100 });
            
        } finally {
            // Cleanup temp frames
            if (fs.existsSync(tempFramesDir)) {
                fs.rmSync(tempFramesDir, { recursive: true, force: true });
            }
        }
    }

    extractFrames(videoPath, outputDir, trimStart, trimDuration) {
        return new Promise((resolve, reject) => {
            const args = [
                '-ss', trimStart.toString(),
                '-t', trimDuration.toString(),
                '-i', videoPath,
                '-vf', 'fps=60',
                path.join(outputDir, 'frame_%05d.png')
            ];

            const process = spawn(this.ffmpegPath, args);
            
            process.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Frame extraction failed with code ${code}`));
            });

            process.on('error', reject);
        });
    }

    // Calculate zoom events (when clicks happen) for the entire video
    // Only creates one zoom event per click, prevents overlapping zooms
    calculateZoomEvents(mouseData, trimStartMs, zoomDuration, holdDuration) {
        const events = [];
        let lastEventEndTime = -Infinity;
        
        for (let i = 0; i < mouseData.length; i++) {
            if (mouseData[i].click) {
                const clickTime = mouseData[i].time - trimStartMs;
                const eventEndTime = clickTime + zoomDuration + holdDuration + zoomDuration;
                
                // Only add event if it starts after the last one ends (no overlap)
                // and is within the trimmed video range
                if (clickTime >= 0 && clickTime > lastEventEndTime) {
                    events.push({
                        startTime: clickTime,
                        x: mouseData[i].x,
                        y: mouseData[i].y,
                        zoomInEnd: clickTime + zoomDuration,
                        holdEnd: clickTime + zoomDuration + holdDuration,
                        zoomOutEnd: eventEndTime
                    });
                    lastEventEndTime = eventEndTime;
                }
            }
        }
        console.log(`Created ${events.length} zoom events`);
        return events;
    }

    // Calculate current zoom state for a given frame time
    calculateZoomState(frameTime, zoomEvents, zoomLevel, zoomDuration) {
        for (const event of zoomEvents) {
            if (frameTime >= event.startTime && frameTime <= event.zoomOutEnd) {
                let scale = 1;
                let x = event.x;
                let y = event.y;
                
                if (frameTime < event.zoomInEnd) {
                    // Zooming in
                    const progress = (frameTime - event.startTime) / zoomDuration;
                    const eased = this.easeInOutCubic(progress);
                    scale = 1 + (zoomLevel - 1) * eased;
                } else if (frameTime < event.holdEnd) {
                    // Holding zoom
                    scale = zoomLevel;
                } else {
                    // Zooming out
                    const progress = (frameTime - event.holdEnd) / zoomDuration;
                    const eased = this.easeInOutCubic(progress);
                    scale = zoomLevel - (zoomLevel - 1) * eased;
                }
                
                return { scale, x, y, active: true };
            }
        }
        return { scale: 1, x: 0, y: 0, active: false };
    }

    // Smooth easing function
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    async processFrames(frames, framesDir, mouseData, trimStartMs, zoomLevel, zoomDuration, autoZoomEnabled, zoomEvents, progressCallback) {
        const { createCanvas, loadImage } = require('canvas');
        
        for (let i = 0; i < frames.length; i++) {
            const framePath = path.join(framesDir, frames[i]);
            
            try {
                const img = await loadImage(framePath);
                
                const canvas = createCanvas(img.width, img.height);
                const ctx = canvas.getContext('2d');
                
                // Calculate time for this frame (60 fps) relative to trim start
                const frameTime = (i / 60) * 1000;
                
                // Find interpolated mouse position for smooth movement
                const pos = this.findMousePositionInterpolated(mouseData, frameTime + trimStartMs);
                
                // Calculate zoom state for this frame
                const zoomState = autoZoomEnabled ? 
                    this.calculateZoomState(frameTime, zoomEvents, zoomLevel, zoomDuration) :
                    { scale: 1, active: false };
                
                // Draw the frame (with zoom if active)
                if (zoomState.active && zoomState.scale > 1) {
                    this.drawZoomedFrame(ctx, img, zoomState.x, zoomState.y, zoomState.scale);
                } else {
                    ctx.drawImage(img, 0, 0);
                }
                
                // Draw cursor if mouse position exists
                if (pos) {
                    // Adjust cursor position if zoomed
                    let cursorX = pos.x;
                    let cursorY = pos.y;
                    
                    if (zoomState.active && zoomState.scale > 1) {
                        // Transform cursor position to match zoomed frame
                        const width = img.width;
                        const height = img.height;
                        const scale = zoomState.scale;
                        
                        // Calculate the source view rectangle (same as in drawZoomedFrame)
                        const viewWidth = width / scale;
                        const viewHeight = height / scale;
                        
                        let srcX = zoomState.x - viewWidth / 2;
                        let srcY = zoomState.y - viewHeight / 2;
                        srcX = Math.max(0, Math.min(width - viewWidth, srcX));
                        srcY = Math.max(0, Math.min(height - viewHeight, srcY));
                        
                        // Transform cursor from source coordinates to screen coordinates
                        cursorX = (pos.x - srcX) * scale;
                        cursorY = (pos.y - srcY) * scale;
                    }
                    
                    this.drawCursor(ctx, cursorX, cursorY);
                }
                
                // Save processed frame
                const buffer = canvas.toBuffer('image/png');
                fs.writeFileSync(framePath, buffer);
                
                // Free memory
                canvas.width = 1;
                canvas.height = 1;
                
                if (i % 10 === 0) {
                    progressCallback({ stage: 'processing', progress: (i / frames.length) * 100 });
                }
            } catch (err) {
                console.error(`Error processing frame ${i}:`, err);
                throw err;
            }
        }
    }

    // Interpolated mouse position for smooth cursor movement
    findMousePositionInterpolated(mouseData, time) {
        if (!mouseData || mouseData.length === 0) return null;
        if (mouseData.length === 1) return mouseData[0];
        
        // Binary search for surrounding positions
        let low = 0;
        let high = mouseData.length - 1;
        
        while (low < high) {
            let mid = Math.floor((low + high) / 2);
            if (mouseData[mid].time < time) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        
        const nextIndex = low;
        const prevIndex = Math.max(0, nextIndex - 1);
        
        const prev = mouseData[prevIndex];
        const next = mouseData[nextIndex];
        
        if (prevIndex === nextIndex || prev.time === next.time) {
            return prev;
        }
        
        // Linear interpolation with slight smoothing
        const t = Math.max(0, Math.min(1, (time - prev.time) / (next.time - prev.time)));
        
        return {
            x: prev.x + (next.x - prev.x) * t,
            y: prev.y + (next.y - prev.y) * t,
            time: time,
            click: prev.click || next.click
        };
    }

    drawZoomedFrame(ctx, img, zoomX, zoomY, scale) {
        const width = img.width;
        const height = img.height;
        
        // Calculate zoom focus point (where to center the zoom)
        // We want zoomX, zoomY to stay in the same position on screen after zooming
        
        // Calculate how much of the original image we can see when zoomed
        const viewWidth = width / scale;
        const viewHeight = height / scale;
        
        // Calculate the source rectangle (what part of image to show)
        // Center it on the click point, but clamp to image bounds
        let srcX = zoomX - viewWidth / 2;
        let srcY = zoomY - viewHeight / 2;
        
        // Clamp to ensure we don't go outside the image
        srcX = Math.max(0, Math.min(width - viewWidth, srcX));
        srcY = Math.max(0, Math.min(height - viewHeight, srcY));
        
        // Draw the zoomed portion scaled to fill the canvas
        ctx.drawImage(
            img,
            srcX, srcY, viewWidth, viewHeight,  // Source rectangle
            0, 0, width, height                   // Destination (full canvas)
        );
    }

    drawCursor(ctx, x, y) {
        // Draw a proper arrow cursor matching the preview
        ctx.save();
        ctx.translate(x, y);
        
        // Scale cursor to be visible (24px like in preview)
        const scale = 1;
        ctx.scale(scale, scale);
        
        // Draw the arrow pointer shape
        ctx.beginPath();
        // Arrow pointer path (matches the SVG in recording.html)
        ctx.moveTo(0, 0);           // Tip of arrow
        ctx.lineTo(0, 21);          // Down the left side
        ctx.lineTo(4.5, 17);        // Notch
        ctx.lineTo(8.5, 24);        // Bottom point of tail
        ctx.lineTo(11.5, 22);       // Right side of tail
        ctx.lineTo(7.5, 15);        // Back to notch
        ctx.lineTo(15, 15);         // Right wing tip
        ctx.closePath();
        
        // Fill with purple
        ctx.fillStyle = '#a855f7';
        ctx.fill();
        
        // White stroke/outline
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.restore();
    }

    encodeVideo(framesDir, outputPath, progressCallback) {
        return new Promise((resolve, reject) => {
            const args = [
                '-framerate', '60',
                '-i', path.join(framesDir, 'frame_%05d.png'),
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '18',
                '-pix_fmt', 'yuv420p',
                '-y',
                outputPath
            ];

            const process = spawn(this.ffmpegPath, args);
            
            process.stderr.on('data', (data) => {
                const output = data.toString();
                if (output.includes('frame=')) {
                    progressCallback({ stage: 'encoding', progress: 50 });
                }
            });

            process.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Video encoding failed with code ${code}`));
            });

            process.on('error', reject);
        });
    }
}

module.exports = VideoExporter;
