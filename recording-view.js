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

    // Binary search for efficiency with high-frequency data
    function findMousePosition(time) {
        let low = 0;
        let high = mousePositions.length - 1;
        let bestIndex = -1;

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (mousePositions[mid].time >= time) {
                bestIndex = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return bestIndex !== -1 ? mousePositions[bestIndex] : null;
    }

    function updateCursor() {
        if (mousePositions.length === 0 || videoElement.paused) {
            requestAnimationFrame(updateCursor);
            return;
        }

        const currentTimeMs = videoElement.currentTime * 1000;
        const pos = findMousePosition(currentTimeMs);
        
        if (pos) {
            const container = document.getElementById('container');
            const containerRect = container.getBoundingClientRect();
            
            // Get video's actual rendered size and position within container
            const videoWidth = videoElement.clientWidth;
            const videoHeight = videoElement.clientHeight;
            
            const videoLeft = (containerRect.width - videoWidth) / 2;
            const videoTop = (containerRect.height - videoHeight) / 2;

            const screenWidth = window.screen.width; 
            const screenHeight = window.screen.height;

            const xRatio = videoWidth / screenWidth;
            const yRatio = videoHeight / screenHeight;

            // Simplified update for performance
            const targetX = videoLeft + (pos.x * xRatio);
            const targetY = videoTop + (pos.y * yRatio);
            
            cursor.style.transform = `translate(${targetX}px, ${targetY}px)`;
            cursor.style.display = 'block';
        }
        requestAnimationFrame(updateCursor);
    }
    
    // Start the animation loop
    requestAnimationFrame(updateCursor);
    
    document.getElementById('saveBtn').addEventListener('click', () => {
        ipcRenderer.send('save-video-to-downloads', currentVideoPath);
    });
});
