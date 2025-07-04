class DisplayManager {
    constructor() {
        this.displays = [];
        this.outputWindows = new Map(); // displayId -> windowId
        this.currentRouting = 'preview'; // 'preview' or displayId
        this.initialized = false;
        
        this.initializeDisplayManager();
    }

    async initializeDisplayManager() {
        try {
            await this.detectDisplays();
            this.initialized = true;
            console.log('Display manager initialized');
        } catch (error) {
            console.error('Failed to initialize display manager:', error);
        }
    }

    async detectDisplays() {
        try {
            // Use the secure API instead of direct ipcRenderer
            this.displays = await window.qlabAPI.getDisplays();
            
            console.log(`Detected ${this.displays.length} display(s):`);
            this.displays.forEach((display, index) => {
                console.log(`  ${index + 1}. ${display.name} - ${display.resolution} ${display.primary ? '(Primary)' : ''}`);
            });
            
            return this.displays;
        } catch (error) {
            console.error('Failed to detect displays:', error);
            this.displays = [];
            return [];
        }
    }

    getDisplays() {
        return this.displays.map(display => ({
            id: display.id,
            name: display.name,
            primary: display.primary,
            resolution: display.resolution,
            bounds: display.bounds,
            internal: display.internal
        }));
    }

    getCurrentRouting() {
        return this.currentRouting;
    }

    async setVideoRouting(routingTarget) {
        console.log(`Setting video routing to: ${routingTarget}`);
        
        if (routingTarget === 'preview') {
            // Route to preview window
            await this.closeAllOutputWindows();
            this.currentRouting = 'preview';
            console.log('Video routing set to preview window');
            return true;
        }
        
        // Route to external display
        const display = this.displays.find(d => d.id.toString() === routingTarget.toString());
        if (!display) {
            console.error(`Display not found: ${routingTarget}`);
            return false;
        }
        
        try {
            // Close any existing output windows
            await this.closeAllOutputWindows();
            
            // Create new output window for this display
            const windowId = await this.createOutputWindow(display);
            if (windowId) {
                this.outputWindows.set(display.id, windowId);
                this.currentRouting = display.id;
                console.log(`Video routing set to: ${display.name}`);
                return true;
            }
        } catch (error) {
            console.error('Failed to set video routing:', error);
        }
        
        return false;
    }

    async createOutputWindow(display) {
        try {
            const config = {
                displayName: display.name,
                bounds: display.bounds,
                resolution: display.resolution
            };
            
            // Use the secure API instead of direct ipcRenderer
            const windowId = await window.qlabAPI.createDisplayWindow(config);
            console.log(`Created output window for ${display.name}: ${windowId}`);
            
            // Show test pattern initially
            await this.sendToDisplay(windowId, {
                type: 'test-pattern',
                displayName: display.name,
                resolution: config.resolution
            });
            
            return windowId;
        } catch (error) {
            console.error(`Failed to create output window for ${display.name}:`, error);
            return null;
        }
    }

    async closeAllOutputWindows() {
        for (const [displayId, windowId] of this.outputWindows) {
            try {
                await window.qlabAPI.closeDisplayWindow(windowId);
                console.log(`Closed output window: ${windowId}`);
            } catch (error) {
                console.warn(`Failed to close output window ${windowId}:`, error);
            }
        }
        
        this.outputWindows.clear();
    }

    async sendToDisplay(windowId, content) {
        try {
            // Use the secure API instead of direct ipcRenderer
            const success = await window.qlabAPI.sendToDisplay({
                windowId: windowId,
                content: content
            });
            
            if (!success) {
                console.warn(`Failed to send content to display window: ${windowId}`);
            }
            
            return success;
        } catch (error) {
            console.error('Failed to send content to display:', error);
            return false;
        }
    }

    async playVideoOnOutput(cue) {
        console.log(`Playing video cue: ${cue.name} on ${this.currentRouting}`);
        
        if (this.currentRouting === 'preview') {
            // Play in preview window (existing functionality)
            console.log('Playing video in preview window');
            if (window.videoEngine && window.videoEngine.previewVideoInInspector) {
                window.videoEngine.previewVideoInInspector(cue.filePath);
            }
            return true;
        }
        
        // Play on external display
        const windowId = this.outputWindows.get(parseInt(this.currentRouting));
        if (!windowId) {
            console.error(`No output window found for display: ${this.currentRouting}`);
            return false;
        }
        
        const videoContent = {
            type: 'video',
            cueId: cue.id,
            filePath: cue.filePath,
            volume: cue.volume || 1.0,
            loop: cue.loop || false,
            startTime: cue.startTime || 0,
            endTime: cue.endTime || null,
            fadeIn: cue.fadeIn || 0,
            fadeOut: cue.fadeOut || 0,
            opacity: cue.opacity || 1.0,
            aspectRatio: cue.aspectRatio || 'auto'
        };
        
        const success = await this.sendToDisplay(windowId, videoContent);
        if (success) {
            console.log(`Video sent to output display: ${cue.name}`);
        }
        
        return success;
    }

    async stopVideoOnOutput(cueId) {
        if (this.currentRouting === 'preview') {
            // Stop preview video
            if (window.videoEngine && window.videoEngine.hideVideoPreview) {
                window.videoEngine.hideVideoPreview();
            }
            return true;
        }
        
        // Stop on external display
        const windowId = this.outputWindows.get(parseInt(this.currentRouting));
        if (windowId) {
            return await this.sendToDisplay(windowId, {
                type: 'stop',
                cueId: cueId
            });
        }
        
        return false;
    }

    async clearAllDisplays() {
        // Clear preview
        if (window.videoEngine && window.videoEngine.hideVideoPreview) {
            window.videoEngine.hideVideoPreview();
        }
        
        // Clear external displays
        for (const windowId of this.outputWindows.values()) {
            await this.sendToDisplay(windowId, { type: 'clear' });
        }
        
        console.log('Cleared all displays');
    }

    async showTestPattern(displayId = null) {
        if (displayId === null) {
            // Show test pattern on current routing
            if (this.currentRouting === 'preview') {
                console.log('Test pattern not available for preview window');
                return false;
            }
            displayId = this.currentRouting;
        }
        
        const windowId = this.outputWindows.get(parseInt(displayId));
        if (windowId) {
            const display = this.displays.find(d => d.id.toString() === displayId.toString());
            return await this.sendToDisplay(windowId, {
                type: 'test-pattern',
                displayName: display?.name || 'Unknown Display',
                resolution: display ? display.resolution : 'Unknown'
            });
        }
        
        return false;
    }

    // Get routing options for UI
    getRoutingOptions() {
        const options = [
            { id: 'preview', name: 'Preview Window', type: 'preview' }
        ];
        
        this.displays.forEach(display => {
            if (!display.primary || this.displays.length > 1) {
                options.push({
                    id: display.id,
                    name: display.name,
                    type: 'external',
                    resolution: display.resolution,
                    primary: display.primary
                });
            }
        });
        
        return options;
    }

    // Cleanup method
    async destroy() {
        await this.closeAllOutputWindows();
        this.displays = [];
        console.log('Display manager destroyed');
    }
}



// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DisplayManager;
} else {
    window.DisplayManager = DisplayManager;
}