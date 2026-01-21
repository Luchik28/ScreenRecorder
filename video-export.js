const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class VideoExporter {
    constructor(ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
        this.activeZooms = []; // Track active zoom animations
    }

    async exportWithEffects(options, progressCallback) {
        const { videoPath, outputPath, mouseData, trimStart, trimDuration, zoomEvents, cursorSettings, autoZoomEnabled, backgroundSettings } = options;
        
        // Store cursor settings for drawing
        this.cursorSettings = cursorSettings || { style: 'windows', color: '#a855f7', size: 24 };
        this.backgroundSettings = backgroundSettings || { wallpaper: 'none', os: 'none', appScale: 0.9, appX: 0, appY: 0 };
        
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
            
            // Use provided zoom events (already calculated by UI), adjust times for trim
            const adjustedZoomEvents = this.adjustZoomEventsForTrim(zoomEvents || [], trimStart * 1000);
            
            await this.processFrames(frames, tempFramesDir, mouseData, trimStart * 1000, autoZoomEnabled, adjustedZoomEvents, progressCallback);
            
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
    adjustZoomEventsForTrim(zoomEvents, trimStartMs) {
        const adjusted = [];
        let lastEventEndTime = -Infinity;
        
        for (const event of zoomEvents) {
            if (!event.enabled) continue;
            
            const startTime = event.time - trimStartMs;
            const zoomInEnd = startTime + event.zoomSpeed;
            const holdEnd = zoomInEnd + event.holdDuration;
            const zoomOutEnd = holdEnd + event.zoomSpeed;
            
            // Only add event if it starts after the last one ends (no overlap)
            // and is within the trimmed video range
            if (startTime >= 0 && startTime > lastEventEndTime) {
                adjusted.push({
                    startTime: startTime,
                    x: event.x,
                    y: event.y,
                    zoomLevel: event.zoomLevel,
                    zoomSpeed: event.zoomSpeed,
                    holdDuration: event.holdDuration,
                    zoomInEnd: zoomInEnd,
                    holdEnd: holdEnd,
                    zoomOutEnd: zoomOutEnd
                });
                lastEventEndTime = zoomOutEnd;
            }
        }
        console.log(`Using ${adjusted.length} zoom events for export`);
        return adjusted;
    }

    // Calculate current zoom state for a given frame time
    calculateZoomState(frameTime, zoomEvents) {
        for (const event of zoomEvents) {
            if (frameTime >= event.startTime && frameTime <= event.zoomOutEnd) {
                let scale = 1;
                let x = event.x;
                let y = event.y;
                
                if (frameTime < event.zoomInEnd) {
                    // Zooming in
                    const progress = (frameTime - event.startTime) / event.zoomSpeed;
                    const eased = this.easeInOutCubic(progress);
                    scale = 1 + (event.zoomLevel - 1) * eased;
                } else if (frameTime < event.holdEnd) {
                    // Holding zoom
                    scale = event.zoomLevel;
                } else {
                    // Zooming out
                    const progress = (frameTime - event.holdEnd) / event.zoomSpeed;
                    const eased = this.easeInOutCubic(progress);
                    scale = event.zoomLevel - (event.zoomLevel - 1) * eased;
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

    async processFrames(frames, framesDir, mouseData, trimStartMs, autoZoomEnabled, zoomEvents, progressCallback) {
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
                
                const bgEnabled = this.backgroundSettings && this.backgroundSettings.wallpaper && this.backgroundSettings.wallpaper !== 'none';

                if (!bgEnabled) {
                    // Original behavior: zoom crops the video content
                    const zoomState = autoZoomEnabled ? 
                        this.calculateZoomState(frameTime, zoomEvents) :
                        { scale: 1, active: false };

                    if (zoomState.active && zoomState.scale > 1) {
                        this.drawZoomedFrame(ctx, img, zoomState.x, zoomState.y, zoomState.scale);
                    } else {
                        ctx.drawImage(img, 0, 0);
                    }

                    if (pos) {
                        let cursorX = pos.x;
                        let cursorY = pos.y;

                        if (zoomState.active && zoomState.scale > 1) {
                            const width = img.width;
                            const height = img.height;
                            const scale = zoomState.scale;
                            const viewWidth = width / scale;
                            const viewHeight = height / scale;
                            let srcX = zoomState.x - viewWidth / 2;
                            let srcY = zoomState.y - viewHeight / 2;
                            srcX = Math.max(0, Math.min(width - viewWidth, srcX));
                            srcY = Math.max(0, Math.min(height - viewHeight, srcY));
                            cursorX = (pos.x - srcX) * scale;
                            cursorY = (pos.y - srcY) * scale;
                        }

                        this.drawCursor(ctx, cursorX, cursorY);
                    }
                } else {
                    // New behavior: render a scene (wallpaper + app window) and zoom the whole scene like a camera
                    const width = img.width;
                    const height = img.height;

                    // Camera zoom state (x/y are recorded coords; we map to scene below)
                    const zoomState = autoZoomEnabled ? this.calculateZoomState(frameTime, zoomEvents) : { scale: 1, x: 0, y: 0, active: false };
                    const cameraScale = (zoomState.active && zoomState.scale > 1) ? zoomState.scale : 1;

                    // App window geometry
                    const appScale = typeof this.backgroundSettings.appScale === 'number' ? this.backgroundSettings.appScale : 0.9;
                    const appX = (width / 2) - (width * appScale / 2) + (this.backgroundSettings.appX || 0);
                    const appY = (height / 2) - (height * appScale / 2) + (this.backgroundSettings.appY || 0);
                    const chromeTop = this.backgroundSettings.os === 'mac' ? (34 * appScale) : 0;
                    const chromeBottom = this.backgroundSettings.os === 'windows' ? (44 * appScale) : 0;

                    const windowW = width * appScale;
                    const windowH = height * appScale + chromeTop + chromeBottom;
                    const radius = 14 * appScale;

                    // Focus point for camera: map zoom focus from recorded coords into scene coords
                    // (point within the app content area)
                    const focusX = appX + (zoomState.x * appScale);
                    const focusY = appY + chromeTop + (zoomState.y * appScale);

                    const centerX = width / 2;
                    const centerY = height / 2;
                    const tx = centerX - cameraScale * focusX;
                    const ty = centerY - cameraScale * focusY;

                    ctx.setTransform(cameraScale, 0, 0, cameraScale, tx, ty);

                    // Draw wallpaper
                    this.drawWallpaper(ctx, width, height, this.backgroundSettings.wallpaper);

                    // Draw window chrome + app content
                    ctx.save();
                    this.roundRect(ctx, appX, appY, windowW, windowH, radius);
                    ctx.clip();

                    // Window background
                    ctx.fillStyle = 'rgba(17,17,17,0.98)';
                    ctx.fillRect(appX, appY, windowW, windowH);

                    // Chrome
                    if (chromeTop > 0) {
                        ctx.fillStyle = 'rgba(30,30,30,0.95)';
                        ctx.fillRect(appX, appY, windowW, chromeTop);
                        // mac dots
                        const dotY = appY + chromeTop / 2;
                        const dotX = appX + 16 * appScale;
                        const r = 6 * appScale;
                        ctx.fillStyle = '#ff5f57'; ctx.beginPath(); ctx.arc(dotX, dotY, r, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#febc2e'; ctx.beginPath(); ctx.arc(dotX + 16 * appScale, dotY, r, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#28c840'; ctx.beginPath(); ctx.arc(dotX + 32 * appScale, dotY, r, 0, Math.PI * 2); ctx.fill();
                    }
                    if (chromeBottom > 0) {
                        ctx.fillStyle = 'rgba(25,25,25,0.95)';
                        ctx.fillRect(appX, appY + windowH - chromeBottom, windowW, chromeBottom);
                        // simple taskbar pills
                        const baseY = appY + windowH - chromeBottom / 2;
                        const startX = appX + windowW / 2 - (30 * appScale);
                        ctx.fillStyle = 'rgba(255,255,255,0.25)';
                        for (let k = 0; k < 4; k++) {
                            ctx.fillRect(startX + k * (16 * appScale), baseY - (5 * appScale), 10 * appScale, 10 * appScale);
                        }
                    }

                    // App content (video frame)
                    ctx.drawImage(
                        img,
                        appX,
                        appY + chromeTop,
                        width * appScale,
                        height * appScale
                    );
                    ctx.restore();

                    // Draw cursor in scene coords
                    if (pos) {
                        const cursorX = appX + (pos.x * appScale);
                        const cursorY = appY + chromeTop + (pos.y * appScale);
                        this.drawCursor(ctx, cursorX, cursorY);
                    }

                    // Reset transform for next frame operations
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    drawWallpaper(ctx, width, height, wallpaper) {
        if (!wallpaper || wallpaper === 'none') {
            ctx.clearRect(0, 0, width, height);
            return;
        }

        // simple procedural wallpapers (no external assets)
        if (wallpaper === 'studio') {
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#0b0b10');
            grad.addColorStop(0.55, '#101018');
            grad.addColorStop(1, '#0b0b10');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            const g1 = ctx.createRadialGradient(width * 0.2, height * 0.15, 0, width * 0.2, height * 0.15, Math.max(width, height));
            g1.addColorStop(0, 'rgba(168,85,247,0.35)');
            g1.addColorStop(1, 'rgba(168,85,247,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, width, height);

            const g2 = ctx.createRadialGradient(width * 0.85, height * 0.2, 0, width * 0.85, height * 0.2, Math.max(width, height));
            g2.addColorStop(0, 'rgba(59,130,246,0.30)');
            g2.addColorStop(1, 'rgba(59,130,246,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, width, height);
            return;
        }

        if (wallpaper === 'sunset') {
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#130912');
            grad.addColorStop(0.55, '#1a0d2a');
            grad.addColorStop(1, '#0d0b12');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            const g1 = ctx.createRadialGradient(width * 0.15, height * 0.2, 0, width * 0.15, height * 0.2, Math.max(width, height));
            g1.addColorStop(0, 'rgba(255,122,24,0.35)');
            g1.addColorStop(1, 'rgba(255,122,24,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, width, height);

            const g2 = ctx.createRadialGradient(width * 0.8, height * 0.3, 0, width * 0.8, height * 0.3, Math.max(width, height));
            g2.addColorStop(0, 'rgba(255,45,85,0.25)');
            g2.addColorStop(1, 'rgba(255,45,85,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, width, height);
            return;
        }

        if (wallpaper === 'midnight') {
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#070a12');
            grad.addColorStop(0.55, '#0a1020');
            grad.addColorStop(1, '#070a12');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            const g1 = ctx.createRadialGradient(width * 0.3, height * 0.2, 0, width * 0.3, height * 0.2, Math.max(width, height));
            g1.addColorStop(0, 'rgba(34,197,94,0.18)');
            g1.addColorStop(1, 'rgba(34,197,94,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, width, height);

            const g2 = ctx.createRadialGradient(width * 0.8, height * 0.6, 0, width * 0.8, height * 0.6, Math.max(width, height));
            g2.addColorStop(0, 'rgba(59,130,246,0.22)');
            g2.addColorStop(1, 'rgba(59,130,246,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, width, height);
            return;
        }

        if (wallpaper === 'neon') {
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#07070c');
            grad.addColorStop(0.55, '#0c0818');
            grad.addColorStop(1, '#07070c');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            const g1 = ctx.createRadialGradient(width * 0.25, height * 0.25, 0, width * 0.25, height * 0.25, Math.max(width, height));
            g1.addColorStop(0, 'rgba(0,255,255,0.18)');
            g1.addColorStop(1, 'rgba(0,255,255,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, width, height);

            const g2 = ctx.createRadialGradient(width * 0.8, height * 0.2, 0, width * 0.8, height * 0.2, Math.max(width, height));
            g2.addColorStop(0, 'rgba(255,0,255,0.16)');
            g2.addColorStop(1, 'rgba(255,0,255,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, width, height);

            const g3 = ctx.createRadialGradient(width * 0.7, height * 0.8, 0, width * 0.7, height * 0.8, Math.max(width, height));
            g3.addColorStop(0, 'rgba(255,255,0,0.12)');
            g3.addColorStop(1, 'rgba(255,255,0,0)');
            ctx.fillStyle = g3;
            ctx.fillRect(0, 0, width, height);
            return;
        }
    }

    roundRect(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
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
        const settings = this.cursorSettings || { style: 'windows', color: '#a855f7', size: 24 };
        const size = settings.size;
        const color = settings.color;
        
        ctx.save();
        ctx.translate(x, y);
        
        // Add drop shadow for all cursor types
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        switch (settings.style) {
            case 'windows':
                // Windows cursor - classic arrow with proper proportions
                const winScale = size / 32;
                ctx.scale(winScale, winScale);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, 22);
                ctx.lineTo(6, 16);
                ctx.lineTo(10, 25);
                ctx.lineTo(13, 23.5);
                ctx.lineTo(9, 14.5);
                ctx.lineTo(17, 14.5);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
                break;
                
            case 'mac':
                // Mac cursor - sleeker arrow
                const macScale = size / 32;
                ctx.scale(macScale, macScale);
                ctx.beginPath();
                ctx.moveTo(2, 0);
                ctx.lineTo(2, 21);
                ctx.lineTo(8, 15);
                ctx.lineTo(11, 26);
                ctx.lineTo(13, 25);
                ctx.lineTo(10, 14);
                ctx.lineTo(16, 14);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.8;
                ctx.stroke();
                break;
                
            case 'dot':
                // Filled circle
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
                
            case 'ring':
                // Ring/circle outline
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2 - 3, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.stroke();
                // Inner white stroke
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2 - 3, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
                break;
                
            case 'square':
                // Rounded square
                const borderRadius = 3;
                ctx.beginPath();
                ctx.roundRect(1, 1, size - 2, size - 2, borderRadius);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
                
            case 'crosshair':
                // Crosshair
                const half = size / 2;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                // Vertical line
                ctx.beginPath();
                ctx.moveTo(half, 0);
                ctx.lineTo(half, size);
                ctx.stroke();
                // Horizontal line
                ctx.beginPath();
                ctx.moveTo(0, half);
                ctx.lineTo(size, half);
                ctx.stroke();
                // White outline
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(half - 1, 0);
                ctx.lineTo(half - 1, size);
                ctx.moveTo(half + 1, 0);
                ctx.lineTo(half + 1, size);
                ctx.moveTo(0, half - 1);
                ctx.lineTo(size, half - 1);
                ctx.moveTo(0, half + 1);
                ctx.lineTo(size, half + 1);
                ctx.stroke();
                break;
                
            default:
                // Default to windows style
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, 21);
                ctx.lineTo(4.5, 17);
                ctx.lineTo(8.5, 24);
                ctx.lineTo(11.5, 22);
                ctx.lineTo(7.5, 15);
                ctx.lineTo(15, 15);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
        }
        
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
