const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let mousePositions = [];
let videoElement = document.getElementById('player');
let cursor = document.getElementById('purple-cursor');
let currentVideoPath = '';

window.addEventListener('DOMContentLoaded', async () => {
    // Get path details from the URL/Query
    const params = new URLSearchParams(window.location.search);
    currentVideoPath = params.get('video');
    const mouseDataPath = params.get('mouse');

    if (currentVideoPath) {
        // Use custom media protocol to bypass security restrictions
        const formattedPath = currentVideoPath.replace(/\\/g, '/');
        videoElement.src = `media:///${formattedPath}`;
        
        videoElement.load();
        videoElement.play().catch(err => {
            console.warn('Autoplay blocked or failed:', err);
        });
    }

    videoElement.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    });

    if (mouseDataPath) {
        try {
            const data = JSON.parse(fs.readFileSync(mouseDataPath, 'utf8'));
            mousePositions = data.positions;
            cursor.style.display = 'block';
        } catch (e) {
            console.error('Failed to load mouse data:', e);
        }
    }

    // Update cursor position based on video time
    videoElement.addEventListener('timeupdate', () => {
        if (mousePositions.length === 0) return;
        
        const currentTimeMs = videoElement.currentTime * 1000;
        
        // Find closest mouse position
        const pos = mousePositions.find(p => p.time >= currentTimeMs);
        
        if (pos) {
            const container = document.getElementById('container');
            const containerRect = container.getBoundingClientRect();
            
            // Get video's actual rendered size and position within container
            const videoWidth = videoElement.clientWidth;
            const videoHeight = videoElement.clientHeight;
            
            // Re-calculate based on intrinsic video size if possible
            const vW = videoElement.videoWidth || 1920;
            const vH = videoElement.videoHeight || 1080;

            const videoLeft = (containerRect.width - videoWidth) / 2;
            const videoTop = (containerRect.height - videoHeight) / 2;

            // These should match the screen resolution during recording
            // For now we use the current screen resolution as a proxy
            const screenWidth = window.screen.width; 
            const screenHeight = window.screen.height;

            const xRatio = videoWidth / screenWidth;
            const yRatio = videoHeight / screenHeight;

            cursor.style.left = `${videoLeft + (pos.x * xRatio)}px`;
            cursor.style.top = `${videoTop + (pos.y * yRatio)}px`;
        }
    });
    
    document.getElementById('saveBtn').addEventListener('click', () => {
        ipcRenderer.send('save-video-to-downloads', currentVideoPath);
    });
});
