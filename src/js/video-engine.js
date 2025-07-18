class VideoEngine {
    constructor() {
        this.activeVideos = new Map(); // cueId -> video data
        this.videoPreview = null;
        this.fullscreenVideo = null;
        this.initialized = false;
        this.masterVolume = 1.0;
        this.videoTimeline = null;
    this.currentVideoCue = null;
    this.reversePlaybackInterval = null;
    this.currentPlayingVideo = null; // Track currently playing video
        
        this.initializeVideoEngine();
    }

    initializeVideoEngine() {
        try {
            // Get video preview element
            this.videoPreview = document.getElementById('video-preview');
            
            // Set up fullscreen handling
            this.setupFullscreenHandling();
            
            this.initialized = true;
            console.log('Video engine initialized');
        } catch (error) {
            console.error('Failed to initialize video engine:', error);
        }
    }

    setupFullscreenHandling() {
        // Handle fullscreen changes
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.fullscreenVideo) {
                this.exitFullscreen();
            }
        });

        // Set up fullscreen button
        const fullscreenBtn = document.getElementById('video-fullscreen');
        const closeBtn = document.getElementById('video-close');

        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideVideoPreview();
            });
        }
    }

    // Convert file path to proper URL format
    getFileUrl(filePath) {
        if (!filePath) return null;
        
        // If it's already a proper URL, return it
        if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:')) {
            return filePath;
        }
        
        // Handle file:// URLs
        if (filePath.startsWith('file://')) {
            return filePath;
        }
        
        // Convert Windows/Unix paths to file:// URLs
        let normalizedPath = filePath.replace(/\\/g, '/');
        
        // For Windows drive letters (C:, D:, etc.)
        if (normalizedPath.match(/^[A-Z]:/i)) {
            return `file:///${normalizedPath}`;
        }
        
        // For Unix-style absolute paths
        if (normalizedPath.startsWith('/')) {
            return `file://${normalizedPath}`;
        }
        
        // For relative paths, assume they're relative to the app
        return `file://${normalizedPath}`;
    }

    async loadVideoFile(filePath) {
        try {
            return this.getFileUrl(filePath);
        } catch (error) {
            console.error('Failed to load video file:', error);
            throw new Error(`Could not load video file: ${error.message}`);
        }
    }

    async playCue(cue, onComplete, onError) {
        try {
            if (!cue.filePath) {
                throw new Error('No video file specified');
            }

            console.log(`Playing video cue: ${cue.name}`);
            console.log(`File path: ${cue.filePath}`);

            // Load the video file
            const videoUrl = await this.loadVideoFile(cue.filePath);
            console.log(`Video URL: ${videoUrl}`);
            
            // Create video element for playback
            const video = document.createElement('video');
            video.src = videoUrl;
            
            // Calculate final volume (cue volume * master volume)
            const cueVolume = Math.max(0, Math.min(1, cue.volume || 1.0));
            const finalVolume = cueVolume * this.masterVolume;
            video.volume = finalVolume;
            
            video.loop = cue.loop || false;
            video.preload = 'auto';
            
            // Store video data with volume info
            const videoData = {
                video: video,
                cue: cue,
                cueVolume: cueVolume,
                onComplete: null
            };
            
            // Set start time
            if (cue.startTime && cue.startTime > 0) {
                video.addEventListener('loadeddata', () => {
                    video.currentTime = cue.startTime / 1000;
                }, { once: true });
            }
            
            // Handle aspect ratio
            this.setVideoAspectRatio(video, cue.aspectRatio);
            
            // Handle opacity
            video.style.opacity = cue.opacity || 1.0;
            
            // Apply fade-in if specified
            if (cue.fadeIn > 0) {
                video.style.opacity = '0';
                video.style.transition = `opacity ${cue.fadeIn}ms ease-in`;
                setTimeout(() => {
                    video.style.opacity = cue.opacity || 1.0;
                }, 10);
            }
            
            // Set up completion handling
            let completed = false;
            const handleEnd = () => {
                if (!completed) {
                    completed = true;
                    this.activeVideos.delete(cue.id);
                    if (video.parentNode) {
                        video.parentNode.removeChild(video);
                    }
                    console.log(`Video cue completed: ${cue.name}`);
                    if (onComplete) onComplete();
                }
            };
            
            videoData.onComplete = handleEnd;
            
            // Handle video events
            video.addEventListener('ended', handleEnd, { once: true });
            
            video.addEventListener('error', (e) => {
                const errorMsg = `Video playback error: ${video.error?.message || 'Unknown error'}`;
                console.error(errorMsg, e);
                console.error('Video error details:', video.error);
                if (onError) onError(new Error(errorMsg));
            });
            
            video.addEventListener('canplay', () => {
                console.log(`Video ready to play: ${cue.name}`);
            }, { once: true });

            video.addEventListener('loadstart', () => {
                console.log(`Video loading started: ${cue.name}`);
            });
            
            // Handle end time
            if (cue.endTime && cue.endTime > 0) {
                video.addEventListener('timeupdate', () => {
                    if (video.currentTime >= (cue.endTime / 1000)) {
                        video.pause();
                        handleEnd();
                    }
                });
            }
            
            // Apply fade-out if specified
            if (cue.fadeOut > 0 && cue.endTime) {
                const fadeOutStart = (cue.endTime - cue.fadeOut) / 1000;
                video.addEventListener('timeupdate', () => {
                    if (video.currentTime >= fadeOutStart) {
                        const fadeProgress = (video.currentTime - fadeOutStart) / (cue.fadeOut / 1000);
                        video.style.opacity = Math.max(0, (cue.opacity || 1.0) * (1 - fadeProgress));
                    }
                });
            }
            
            // Store reference
            this.activeVideos.set(cue.id, videoData);
            
            // Show video based on fullscreen setting
            if (cue.fullscreen) {
                await this.showFullscreenVideo(video);
            } else {
                this.showVideoInPreview(video);
            }
            
            // Load and start playback
            video.load();
            try {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
                console.log(`Video playback started successfully: ${cue.name}`);
            } catch (playError) {
                console.error('Video play() failed:', playError);
                // Remove from active videos on failure
                this.activeVideos.delete(cue.id);
                if (onError) onError(playError);
            }
            
        } catch (error) {
            console.error('Video playback error:', error);
            if (onError) onError(error);
        }
    }

    // Set volume for a specific cue
    setCueVolume(cueId, volume) {
        const videoData = this.activeVideos.get(cueId);
        if (videoData && videoData.video) {
            // Store the new cue volume
            videoData.cueVolume = Math.max(0, Math.min(1, volume));
            
            // Apply volume (cue volume * master volume)
            const finalVolume = videoData.cueVolume * this.masterVolume;
            videoData.video.volume = finalVolume;
            
            console.log(`Set video volume for cue ${cueId}: ${Math.round(videoData.cueVolume * 100)}% (final: ${Math.round(finalVolume * 100)}%)`);
            return true;
        }
        return false;
    }

    // Get volume for a specific cue
    getCueVolume(cueId) {
        const videoData = this.activeVideos.get(cueId);
        if (videoData) {
            return videoData.cueVolume;
        }
        return null;
    }

    // Master volume control
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        
        // Update all currently playing video volumes
        for (const [cueId, videoData] of this.activeVideos) {
            if (videoData.video) {
                const finalVolume = videoData.cueVolume * this.masterVolume;
                videoData.video.volume = finalVolume;
            }
        }
        
        console.log(`Master video volume set to: ${Math.round(this.masterVolume * 100)}%`);
    }

    getMasterVolume() {
        return this.masterVolume;
    }

    setVideoAspectRatio(video, aspectRatio) {
        switch (aspectRatio) {
            case '16:9':
                video.style.aspectRatio = '16/9';
                video.style.objectFit = 'contain';
                break;
            case '4:3':
                video.style.aspectRatio = '4/3';
                video.style.objectFit = 'contain';
                break;
            case 'stretch':
                video.style.objectFit = 'fill';
                break;
            case 'auto':
            default:
                video.style.objectFit = 'contain';
                break;
        }
    }

    showVideoInPreview(video) {
        const previewContainer = document.querySelector('.video-preview-container');
        const videoSection = document.getElementById('video-preview-section');
        
        // Clear existing preview videos (but keep the preview element)
        const existingVideos = previewContainer.querySelectorAll('video:not(#video-preview)');
        existingVideos.forEach(v => v.remove());
        
        // Style the video for preview
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        video.style.borderRadius = '4px';
        video.controls = true;
        video.id = 'playing-video-preview';
        
        // Add to preview container
        previewContainer.appendChild(video);
        
        // Show video section
        videoSection.style.display = 'flex';
    }

    async showFullscreenVideo(video) {
        // Create fullscreen container
        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: black;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        // Style video for fullscreen
        video.style.maxWidth = '100%';
        video.style.maxHeight = '100%';
        video.style.objectFit = 'contain';
        video.controls = true;
        
        fullscreenContainer.appendChild(video);
        document.body.appendChild(fullscreenContainer);
        
        this.fullscreenVideo = {
            container: fullscreenContainer,
            video: video
        };
        
        // Enter fullscreen mode
        try {
            await fullscreenContainer.requestFullscreen();
        } catch (error) {
            console.warn('Fullscreen not supported:', error);
        }
    }

    toggleFullscreen() {
        if (this.videoPreview && this.videoPreview.src) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                this.videoPreview.requestFullscreen().catch(console.error);
            }
        }
    }

    exitFullscreen() {
        if (this.fullscreenVideo) {
            if (this.fullscreenVideo.container.parentNode) {
                this.fullscreenVideo.container.parentNode.removeChild(this.fullscreenVideo.container);
            }
            this.fullscreenVideo = null;
        }
    }

    hideVideoPreview() {
        const videoSection = document.getElementById('video-preview-section');
        const previewContainer = document.querySelector('.video-preview-container');
        
        // Remove any playing videos in preview (but keep the preview element)
        const playingVideos = previewContainer.querySelectorAll('video:not(#video-preview)');
        playingVideos.forEach(video => {
            video.pause();
            video.remove();
        });
        
        // Reset the preview video element
        if (this.videoPreview) {
            this.videoPreview.src = '';
            this.videoPreview.load();
        }
        
        // Hide section
        videoSection.style.display = 'none';
    }

    stopCue(cueId) {
        console.log(`Stopping video cue: ${cueId}`);
        const videoData = this.activeVideos.get(cueId);
        if (videoData) {
            try {
                if (videoData.video) {
                    // Proper stop: pause and reset to beginning
                    videoData.video.pause();
                    videoData.video.currentTime = 0;
                    console.log(`Video cue ${cueId} stopped and reset to beginning`);
                }
                // Call completion handler to clean up
                videoData.onComplete();
            } catch (error) {
                console.warn('Error stopping video cue:', error);
                // Still remove from active videos even if stop failed
                this.activeVideos.delete(cueId);
            }
        } else {
            console.log(`Video cue ${cueId} not found in active videos`);
        }
    }

    pauseCue(cueId) {
        console.log(`Pausing video cue: ${cueId}`);
        const videoData = this.activeVideos.get(cueId);
        if (videoData && videoData.video) {
            try {
                videoData.video.pause();
                console.log(`Video cue ${cueId} paused at ${videoData.video.currentTime}s`);
            } catch (error) {
                console.warn('Error pausing video cue:', error);
            }
        } else {
            console.log(`Video cue ${cueId} not found in active videos`);
        }
    }

    resumeCue(cueId) {
        console.log(`Resuming video cue: ${cueId}`);
        const videoData = this.activeVideos.get(cueId);
        if (videoData && videoData.video) {
            try {
                const playPromise = videoData.video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log(`Video cue ${cueId} resumed from ${videoData.video.currentTime}s`);
                    }).catch(error => {
                        console.warn('Error resuming video cue:', error);
                    });
                }
            } catch (error) {
                console.warn('Error resuming video cue:', error);
            }
        } else {
            console.log(`Video cue ${cueId} not found in active videos`);
        }
    }

    stopAllCues() {
        console.log(`Stopping all video cues (${this.activeVideos.size} active)`);
        for (const [cueId, videoData] of this.activeVideos) {
            try {
                if (videoData.video) {
                    videoData.video.pause();
                    videoData.video.currentTime = 0;
                    // Remove video element from DOM to fully stop
                    if (videoData.video.parentNode) {
                        videoData.video.parentNode.removeChild(videoData.video);
                    }
                    console.log(`Video cue ${cueId} fully stopped and removed`);
                }
            } catch (error) {
                console.warn('Error stopping video cue:', cueId, error);
            }
        }
        this.activeVideos.clear();
        this.hideVideoPreview();
        this.exitFullscreen();
        console.log('All video cues stopped and cleared');
    }

    // Check if any video is currently playing
    hasActiveCues() {
        return this.activeVideos.size > 0;
    }

    // Get detailed status of all active cues
    getPlaybackStatus() {
        const status = {};
        for (const [cueId, videoData] of this.activeVideos) {
            if (videoData.video) {
                status[cueId] = {
                    paused: videoData.video.paused,
                    currentTime: videoData.video.currentTime,
                    duration: videoData.video.duration,
                    volume: videoData.video.volume,
                    cueVolume: videoData.cueVolume,
                    muted: videoData.video.muted
                };
            }
        }
        return status;
    }

    isPlaying(cueId) {
        const videoData = this.activeVideos.get(cueId);
        return videoData && !videoData.video.paused;
    }

    getActiveCues() {
        return Array.from(this.activeVideos.keys());
    }

    // Get video file metadata
    async getVideoFileInfo(filePath) {
        try {
            const videoUrl = this.getFileUrl(filePath);
            
            return new Promise((resolve, reject) => {
                const video = document.createElement('video');
                
                video.addEventListener('loadedmetadata', () => {
                    resolve({
                        duration: video.duration * 1000, // Convert to milliseconds
                        width: video.videoWidth,
                        height: video.videoHeight,
                        aspectRatio: video.videoWidth / video.videoHeight
                    });
                });
                
                video.addEventListener('error', (e) => {
                    reject(new Error(`Could not load video metadata: ${video.error?.message || 'Unknown error'}`));
                });
                
                video.src = videoUrl;
                video.load();
            });
        } catch (error) {
            console.error('Failed to get video file info:', error);
            return null;
        }
    }

    // Get supported video formats
    getSupportedVideoFormats() {
        const video = document.createElement('video');
        const formats = [];
        
        const testFormats = [
            { type: 'video/mp4', ext: 'mp4', name: 'MP4 (H.264)' },
            { type: 'video/mp4; codecs="avc1.42E01E"', ext: 'mp4', name: 'MP4 H.264 Baseline' },
            { type: 'video/mp4; codecs="avc1.4D401E"', ext: 'mp4', name: 'MP4 H.264 Main' },
            { type: 'video/mp4; codecs="avc1.64001E"', ext: 'mp4', name: 'MP4 H.264 High' },
            { type: 'video/webm', ext: 'webm', name: 'WebM' },
            { type: 'video/webm; codecs="vp8"', ext: 'webm', name: 'WebM VP8' },
            { type: 'video/webm; codecs="vp9"', ext: 'webm', name: 'WebM VP9' },
            { type: 'video/ogg', ext: 'ogv', name: 'OGG Theora' },
            { type: 'video/quicktime', ext: 'mov', name: 'QuickTime MOV' },
            { type: 'video/x-msvideo', ext: 'avi', name: 'AVI' },
            { type: 'video/x-ms-wmv', ext: 'wmv', name: 'Windows Media' }
        ];
        
        testFormats.forEach(format => {
            const canPlay = video.canPlayType(format.type);
            if (canPlay === 'probably' || canPlay === 'maybe') {
                formats.push({
                    ...format,
                    support: canPlay
                });
            }
        });
        
        console.log('Supported video formats:', formats);
        return formats;
    }

    // Enhanced video file info with codec detection
    async getVideoFileInfo(filePath) {
        try {
            const videoUrl = this.getFileUrl(filePath);
            console.log(`Getting video info for: ${filePath}`);
            console.log(`Video URL: ${videoUrl}`);
            
            return new Promise((resolve, reject) => {
                const video = document.createElement('video');
                
                video.addEventListener('loadedmetadata', () => {
                    const info = {
                        duration: video.duration * 1000, // Convert to milliseconds
                        durationSeconds: video.duration,
                        width: video.videoWidth,
                        height: video.videoHeight,
                        aspectRatio: video.videoWidth / video.videoHeight,
                        canPlay: true,
                        format: this.detectVideoFormat(filePath),
                        hasAudio: video.mozHasAudio !== false, // Firefox property
                        playbackRate: video.playbackRate
                    };
                    
                    console.log(`Video info loaded:`, info);
                    resolve(info);
                });
                
                video.addEventListener('error', (e) => {
                    const errorMsg = this.getVideoErrorMessage(video.error);
                    console.error(`Video info loading failed: ${errorMsg}`, e);
                    
                    // Try to provide helpful error information
                    const format = this.detectVideoFormat(filePath);
                    const supportedFormats = this.getSupportedVideoFormats();
                    const isSupported = supportedFormats.some(f => f.ext === format.toLowerCase());
                    
                    if (!isSupported) {
                        reject(new Error(`Unsupported video format: ${format}. Supported formats: ${supportedFormats.map(f => f.ext).join(', ')}`));
                    } else {
                        reject(new Error(`Video loading failed: ${errorMsg}. Try converting to MP4 H.264 for best compatibility.`));
                    }
                });
                
                video.addEventListener('loadstart', () => {
                    console.log(`Video loading started: ${filePath}`);
                });
                
                // Set source and load
                video.src = videoUrl;
                video.load();
                
                // Timeout after 15 seconds for videos
                setTimeout(() => {
                    reject(new Error('Video loading timeout - file may be corrupted or too large'));
                }, 15000);
            });
        } catch (error) {
            console.error('Failed to get video file info:', error);
            throw error;
        }
    }

    detectVideoFormat(filePath) {
        const ext = filePath.split('.').pop().toLowerCase();
        return ext;
    }

    getVideoErrorMessage(error) {
        if (!error) return 'Unknown video error';
        
        switch (error.code) {
            case 1: return 'MEDIA_ERR_ABORTED - Video loading was aborted';
            case 2: return 'MEDIA_ERR_NETWORK - Network error occurred';
            case 3: return 'MEDIA_ERR_DECODE - Video decoding error (codec not supported)';
            case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED - Video format not supported';
            default: return `Unknown error code: ${error.code}`;
        }
    }

    // Preview video in inspector
    previewVideoInInspector(filePath) {
        if (this.videoPreview && filePath) {
            const videoUrl = this.getFileUrl(filePath);
            this.videoPreview.src = videoUrl;
            const videoSection = document.getElementById('video-preview-section');
            videoSection.style.display = 'flex';
        }
    }
    // Enhanced Video Engine - Add these methods to your existing VideoEngine class
// in src/js/video-engine.js

// Add these new methods to your existing VideoEngine class:

// Frame-accurate seeking support
async seekToFrame(video, frameNumber, frameRate = 30) {
    if (!video) return false;
    
    try {
        const targetTime = frameNumber / frameRate;
        const clampedTime = Math.max(0, Math.min(video.duration, targetTime));
        
        // Use precise seeking
        video.currentTime = clampedTime;
        
        // Wait for seek to complete
        await new Promise((resolve, reject) => {
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
                resolve();
            };
            
            const onError = () => {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
                reject(new Error('Seek failed'));
            };
            
            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onError, { once: true });
            
            // Fallback timeout
            setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
                resolve(); // Continue even if seek event doesn't fire
            }, 1000);
        });
        
        return true;
    } catch (error) {
        console.error('Frame seek failed:', error);
        return false;
    }
}

// Detect video frame rate
detectFrameRate(video) {
    // Try to get frame rate from video metadata
    try {
        // Check for common frame rates first
        const commonFrameRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
        
        // For now, default to 30fps
        // TODO: Implement proper frame rate detection from video metadata
        return 30;
    } catch (error) {
        console.warn('Could not detect frame rate:', error);
        return 30;
    }
}

// Generate video metadata
async getDetailedVideoInfo(filePath) {
    try {
        const videoUrl = this.getFileUrl(filePath);
        
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            
            video.addEventListener('loadedmetadata', () => {
                const frameRate = this.detectFrameRate(video);
                const totalFrames = Math.floor(video.duration * frameRate);
                
                resolve({
                    duration: video.duration * 1000, // Convert to milliseconds
                    durationSeconds: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight,
                    aspectRatio: video.videoWidth / video.videoHeight,
                    frameRate: frameRate,
                    totalFrames: totalFrames,
                    hasAudio: video.mozHasAudio !== false, // Firefox property
                    buffered: video.buffered,
                    seekable: video.seekable
                });
            });
            
            video.addEventListener('error', (e) => {
                reject(new Error(`Could not load video metadata: ${video.error?.message || 'Unknown error'}`));
            });
            
            video.src = videoUrl;
            video.load();
        });
    } catch (error) {
        console.error('Failed to get detailed video info:', error);
        return null;
    }
}

// Enhanced preview with timeline
previewVideoWithTimeline(filePath, timelineCanvas) {
    if (this.videoPreview && filePath) {
        const videoUrl = this.getFileUrl(filePath);
        this.videoPreview.src = videoUrl;
        
        // Show video section
        const videoSection = document.getElementById('video-preview-section');
        videoSection.style.display = 'flex';
        
        // Initialize timeline if canvas provided
        if (timelineCanvas) {
            this.initializeVideoTimeline(this.videoPreview, timelineCanvas);
        }
    }
}

// Initialize video timeline integration
initializeVideoTimeline(video, canvas) {
    // Create timeline instance
    if (this.videoTimeline) {
        this.videoTimeline.destroy();
    }
    
    this.videoTimeline = new VideoTimeline(canvas, {
        showFrameThumbnails: true,
        showTimecode: true,
        showFrameNumbers: true
    });
    
    // Set up video timeline integration
    video.addEventListener('loadedmetadata', () => {
        this.videoTimeline.setVideo(video);
    });
    
    // Update timeline during playback
    video.addEventListener('timeupdate', () => {
        this.videoTimeline.updatePlayback(!video.paused, video.currentTime);
    });
    
    // Handle timeline events
    this.videoTimeline.on('seek', (time) => {
        video.currentTime = time;
    });
    
    this.videoTimeline.on('frameStep', (data) => {
        const frameRate = this.videoTimeline.frameRate;
        this.seekToFrame(video, data.frame, frameRate);
    });
    
    this.videoTimeline.on('playToggle', (data) => {
        if (data.direction === 0) {
            video.pause();
        } else if (data.direction === 1) {
            video.play();
        } else if (data.direction === -1) {
            // Reverse playback - simplified implementation
            video.playbackRate = -1;
            video.play();
        }
    });
    
    this.videoTimeline.on('trimChange', (trimPoints) => {
        // Emit trim change event for cue updates
        if (this.currentVideoCue) {
            console.log('Video trim changed:', trimPoints);
            // This would update the cue's start/end times
            window.app?.uiManager?.updateCueTrimPoints?.(this.currentVideoCue.id, trimPoints);
        }
    });
    
    console.log('Video timeline initialized');
}

// Professional video controls
stepFrame(video, direction) {
    if (!video) return;
    
    const frameRate = this.videoTimeline?.frameRate || 30;
    const currentFrame = Math.floor(video.currentTime * frameRate);
    const newFrame = currentFrame + direction;
    
    this.seekToFrame(video, newFrame, frameRate);
}

// J/K/L professional controls
// Fix for playback rate error in VideoEngine
// Replace the setPlaybackRate method in src/js/video-engine.js

setPlaybackRate(video, rate) {
    if (!video) return;
    
    try {
        if (rate === 0) {
            video.pause();
            this.stopReversePlayback();
        } else if (rate > 0) {
            // Forward playback
            this.stopReversePlayback();
            
            // Check if the playback rate is supported
            const supportedRates = this.getSupportedPlaybackRates(video);
            const clampedRate = this.clampPlaybackRate(rate, supportedRates);
            
            if (clampedRate !== rate) {
                console.warn(`Playback rate ${rate} not supported, using ${clampedRate}`);
            }
            
            video.playbackRate = clampedRate;
            video.play();
        } else {
            // Negative rate - use our reverse simulation
            this.simulateReversePlayback(video, Math.abs(rate));
        }
    } catch (error) {
        console.warn('Playback rate change failed, falling back to normal playback:', error);
        // Fallback: just play normally
        try {
            video.playbackRate = 1.0;
            if (rate !== 0) {
                video.play();
            }
        } catch (fallbackError) {
            console.error('Even fallback playback failed:', fallbackError);
        }
    }
}

// New method: Get supported playback rates
getSupportedPlaybackRates(video) {
    // Most browsers support these rates
    const commonRates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 4.0];
    const supportedRates = [];
    
    // Test each rate to see if it's supported
    const originalRate = video.playbackRate;
    
    for (const rate of commonRates) {
        try {
            video.playbackRate = rate;
            if (Math.abs(video.playbackRate - rate) < 0.01) {
                supportedRates.push(rate);
            }
        } catch (error) {
            // Rate not supported
        }
    }
    
    // Restore original rate
    try {
        video.playbackRate = originalRate;
    } catch (error) {
        video.playbackRate = 1.0;
    }
    
    return supportedRates.length > 0 ? supportedRates : [1.0];
}

// New method: Clamp playback rate to supported range
clampPlaybackRate(requestedRate, supportedRates) {
    if (supportedRates.includes(requestedRate)) {
        return requestedRate;
    }
    
    // Find closest supported rate
    let closest = supportedRates[0];
    let closestDiff = Math.abs(requestedRate - closest);
    
    for (const rate of supportedRates) {
        const diff = Math.abs(requestedRate - rate);
        if (diff < closestDiff) {
            closest = rate;
            closestDiff = diff;
        }
    }
    
    return closest;
}

// Enhanced reverse playback simulation with better error handling
simulateReversePlayback(video, rate = 1) {
    if (this.reversePlaybackInterval) {
        clearInterval(this.reversePlaybackInterval);
    }
    
    video.pause();
    
    const frameRate = this.videoTimeline?.frameRate || 30;
    const frameTime = Math.max(16, 1000 / frameRate / rate); // Minimum 16ms (60fps)
    
    console.log(`Starting reverse playback at ${rate}x speed`);
    
    this.reversePlaybackInterval = setInterval(() => {
        try {
            if (video.currentTime <= 0) {
                console.log('Reached beginning of video, stopping reverse playback');
                this.stopReversePlayback();
                return;
            }
            
            const newTime = Math.max(0, video.currentTime - (1 / frameRate * rate));
            video.currentTime = newTime;
            
            // Update timeline if available
            if (this.videoTimeline) {
                this.videoTimeline.updatePlayback(true, newTime);
            }
            
        } catch (error) {
            console.warn('Error during reverse playback:', error);
            this.stopReversePlayback();
        }
    }, frameTime);
}

// Enhanced J/K/L controls with better error handling
handleJKLControls(key, video) {
    if (!video) return;
    
    try {
        switch (key) {
            case 'KeyJ':
                // J key: Reverse or increase reverse speed
                this.jklState = this.jklState || { direction: 0, speed: 1 };
                
                if (this.jklState.direction >= 0) {
                    // Switch to reverse
                    this.jklState.direction = -1;
                    this.jklState.speed = 1;
                } else {
                    // Increase reverse speed
                    this.jklState.speed = Math.min(4, this.jklState.speed * 2);
                }
                
                this.setPlaybackRate(video, -this.jklState.speed);
                break;
                
            case 'KeyK':
                // K key: Pause
                this.jklState = { direction: 0, speed: 1 };
                this.setPlaybackRate(video, 0);
                break;
                
            case 'KeyL':
                // L key: Forward or increase forward speed
                this.jklState = this.jklState || { direction: 0, speed: 1 };
                
                if (this.jklState.direction <= 0) {
                    // Switch to forward
                    this.jklState.direction = 1;
                    this.jklState.speed = 1;
                } else {
                    // Increase forward speed
                    this.jklState.speed = Math.min(4, this.jklState.speed * 2);
                }
                
                this.setPlaybackRate(video, this.jklState.speed);
                break;
        }
        
        console.log(`JKL Control: ${key}, Direction: ${this.jklState?.direction}, Speed: ${this.jklState?.speed}`);
        
    } catch (error) {
        console.error('JKL control error:', error);
        // Reset to normal playback on error
        try {
            video.playbackRate = 1.0;
            if (key !== 'KeyK') {
                video.play();
            }
        } catch (fallbackError) {
            console.error('Fallback playback failed:', fallbackError);
        }
    }
}

// Simulate reverse playback (since HTML5 video doesn't natively support it)
simulateReversePlayback(video, rate = 1) {
    if (this.reversePlaybackInterval) {
        clearInterval(this.reversePlaybackInterval);
    }
    
    video.pause();
    
    const frameRate = this.videoTimeline?.frameRate || 30;
    const frameTime = 1000 / frameRate / rate; // Milliseconds per frame
    
    this.reversePlaybackInterval = setInterval(() => {
        if (video.currentTime <= 0) {
            clearInterval(this.reversePlaybackInterval);
            this.reversePlaybackInterval = null;
            return;
        }
        
        video.currentTime = Math.max(0, video.currentTime - (1 / frameRate));
    }, frameTime);
}

// Stop reverse playback
stopReversePlayback() {
    if (this.reversePlaybackInterval) {
        clearInterval(this.reversePlaybackInterval);
        this.reversePlaybackInterval = null;
    }
}

// Enhanced playCue with timeline integration
async playCueWithTimeline(cue, onComplete, onError) {
    try {
        this.currentVideoCue = cue; // Store reference for timeline integration
        
        // Use existing playCue but with enhanced features
        await this.playCue(cue, onComplete, onError);
        
        // If we have a timeline, update it
        if (this.videoTimeline && this.currentPlayingVideo) {
            this.videoTimeline.setVideo(this.currentPlayingVideo);
            
            // Apply trim points if they exist
            if (cue.startTime || cue.endTime) {
                const duration = this.currentPlayingVideo.duration;
                const startNormalized = (cue.startTime || 0) / 1000 / duration;
                const endNormalized = cue.endTime ? (cue.endTime / 1000 / duration) : 1;
                
                this.videoTimeline.trimPoints = {
                    start: startNormalized,
                    end: endNormalized
                };
            }
        }
        
    } catch (error) {
        console.error('Enhanced video playback failed:', error);
        if (onError) onError(error);
    }
}

// Capture video frame as thumbnail
async captureFrame(video, time) {
    try {
        // Create a canvas for frame capture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Seek to the specified time
        const originalTime = video.currentTime;
        video.currentTime = time;
        
        await new Promise((resolve) => {
            video.addEventListener('seeked', resolve, { once: true });
        });
        
        // Draw the frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Restore original time
        video.currentTime = originalTime;
        
        // Return as data URL
        return canvas.toDataURL('image/jpeg', 0.8);
        
    } catch (error) {
        console.error('Frame capture failed:', error);
        return null;
    }
}

// Get video buffering status
getBufferingStatus(video) {
    if (!video) return { buffered: 0, total: 0 };
    
    try {
        const buffered = video.buffered;
        const duration = video.duration;
        
        if (buffered.length === 0) return { buffered: 0, total: duration };
        
        // Calculate total buffered time
        let totalBuffered = 0;
        for (let i = 0; i < buffered.length; i++) {
            totalBuffered += buffered.end(i) - buffered.start(i);
        }
        
        return {
            buffered: totalBuffered,
            total: duration,
            percentage: duration > 0 ? (totalBuffered / duration) * 100 : 0,
            ranges: Array.from({ length: buffered.length }, (_, i) => ({
                start: buffered.start(i),
                end: buffered.end(i)
            }))
        };
    } catch (error) {
        console.error('Error getting buffering status:', error);
        return { buffered: 0, total: 0 };
    }
}

// Enhanced stop with timeline cleanup
stopCueWithTimeline(cueId) {
    this.stopCue(cueId);
    this.stopReversePlayback();
    
    if (this.videoTimeline) {
        this.videoTimeline.updatePlayback(false, 0);
    }
    
    this.currentVideoCue = null;
}

// Enhanced stop all with timeline cleanup
stopAllCuesWithTimeline() {
    this.stopAllCues();
    this.stopReversePlayback();
    
    if (this.videoTimeline) {
        this.videoTimeline.updatePlayback(false, 0);
    }
    
    this.currentVideoCue = null;
}

// Get frame-accurate position info
getFrameInfo(video) {
    if (!video) return null;
    
    const frameRate = this.videoTimeline?.frameRate || this.detectFrameRate(video);
    const currentFrame = Math.floor(video.currentTime * frameRate);
    const totalFrames = Math.floor(video.duration * frameRate);
    
    return {
        currentTime: video.currentTime,
        currentFrame: currentFrame,
        totalFrames: totalFrames,
        frameRate: frameRate,
        timecode: this.formatTimecode(video.currentTime, frameRate),
        progress: video.duration > 0 ? video.currentTime / video.duration : 0
    };
}

// Format timecode (SMPTE format)
formatTimecode(seconds, frameRate = 30) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * frameRate);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

// Enhanced cleanup
destroy() {
    this.stopAllCuesWithTimeline();
    
    if (this.videoTimeline) {
        this.videoTimeline.destroy();
        this.videoTimeline = null;
    }
    
    if (this.reversePlaybackInterval) {
        clearInterval(this.reversePlaybackInterval);
        this.reversePlaybackInterval = null;
    }
    
    this.currentVideoCue = null;
}

    // Cleanup method
    destroy() {
        this.stopAllCues();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoEngine;
} else {
    window.VideoEngine = VideoEngine;
}