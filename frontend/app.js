/**
 * CORTEX - Voice Recorder PWA
 * Brain dump & memory extension app
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    API_BASE: '/api', // Backend API endpoint
    AUDIO_MIME_TYPE: 'audio/webm;codecs=opus',
    MAX_RECORDING_DURATION: 300000, // 5 minutes
    WAVEFORM_BAR_COUNT: 40,
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
    isRecording: false,
    isPaused: false,
    mediaRecorder: null,
    audioChunks: [],
    stream: null,
    audioContext: null,
    analyser: null,
    recordingStartTime: null,
    timerInterval: null,
    animationFrame: null,
    currentFolder: 'inbox',
    folders: [
        { name: 'inbox', count: 0, description: 'Uncategorized thoughts' },
        { name: 'ideas', count: 0, description: 'Creative ideas and concepts' },
        { name: 'tasks', count: 0, description: 'Things to do' },
        { name: 'journal', count: 0, description: 'Personal reflections' },
    ],
    entries: [],
    pendingRecordings: [], // For offline support
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═══════════════════════════════════════════════════════════════════════════

const elements = {
    recordBtn: document.getElementById('record-btn'),
    recordRings: document.getElementById('record-rings'),
    recordIcon: document.getElementById('record-icon'),
    timer: document.getElementById('timer'),
    status: document.getElementById('status'),
    waveformContainer: document.getElementById('waveform-container'),
    waveformCanvas: document.getElementById('waveform'),
    currentFolder: document.getElementById('current-folder'),
    btnChangeFolder: document.getElementById('btn-change-folder'),
    btnFolders: document.getElementById('btn-folders'),
    btnCloseFolders: document.getElementById('btn-close-folders'),
    folderPanel: document.getElementById('folder-panel'),
    folderPanelOverlay: document.getElementById('folder-panel-overlay'),
    folderList: document.getElementById('folder-list'),
    btnAddFolder: document.getElementById('btn-add-folder'),
    entriesList: document.getElementById('entries-list'),
    processingOverlay: document.getElementById('processing-overlay'),
    processingText: document.getElementById('processing-text'),
    toastContainer: document.getElementById('toast-container'),
    neuralBg: document.getElementById('neural-bg'),
};

// ═══════════════════════════════════════════════════════════════════════════
// SAFE DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
}

function createSvgElement(viewBox, paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');

    paths.forEach(d => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });

    return svg;
}

function clearElement(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// NEURAL BACKGROUND ANIMATION
// ═══════════════════════════════════════════════════════════════════════════

class NeuralBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.connections = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.resize();
        this.init();
        this.animate();

        window.addEventListener('resize', () => this.resize());
        document.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    init() {
        const particleCount = Math.floor((this.canvas.width * this.canvas.height) / 25000);
        this.particles = [];

        for (let i = 0; i < particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.2,
            });
        }
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Update and draw particles
        this.particles.forEach((p, i) => {
            // Move
            p.x += p.vx;
            p.y += p.vy;

            // Bounce off edges
            if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

            // Draw particle
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(0, 212, 170, ${p.opacity})`;
            this.ctx.fill();

            // Draw connections
            this.particles.slice(i + 1).forEach((p2) => {
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 120) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x, p.y);
                    this.ctx.lineTo(p2.x, p2.y);
                    this.ctx.strokeStyle = `rgba(0, 212, 170, ${0.15 * (1 - dist / 120)})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.stroke();
                }
            });
        });

        requestAnimationFrame(() => this.animate());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// RECORDING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function startRecording() {
    try {
        // Request microphone access
        state.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100,
            }
        });

        // Set up audio context for visualization
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        const source = state.audioContext.createMediaStreamSource(state.stream);
        source.connect(state.analyser);
        state.analyser.fftSize = 256;

        // Set up media recorder
        state.mediaRecorder = new MediaRecorder(state.stream, {
            mimeType: CONFIG.AUDIO_MIME_TYPE,
        });

        state.audioChunks = [];

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                state.audioChunks.push(e.data);
            }
        };

        state.mediaRecorder.onstop = handleRecordingComplete;

        // Start recording
        state.mediaRecorder.start(100); // Collect data every 100ms
        state.isRecording = true;
        state.recordingStartTime = Date.now();

        // Update UI
        updateRecordingUI(true);

        // Start timer
        startTimer();

        // Start waveform visualization
        startWaveformVisualization();

        showToast('Recording started', 'success');
    } catch (error) {
        console.error('Error starting recording:', error);
        showToast('Could not access microphone', 'error');
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.isRecording) {
        state.mediaRecorder.stop();
        state.isRecording = false;

        // Stop all tracks
        if (state.stream) {
            state.stream.getTracks().forEach(track => track.stop());
        }

        // Clean up audio context
        if (state.audioContext) {
            state.audioContext.close();
        }

        // Stop timer and visualization
        stopTimer();
        stopWaveformVisualization();

        // Update UI
        updateRecordingUI(false);
    }
}

async function handleRecordingComplete() {
    showProcessingOverlay('Transcribing...');

    try {
        // Create audio blob
        const audioBlob = new Blob(state.audioChunks, { type: CONFIG.AUDIO_MIME_TYPE });

        // Check if online
        if (navigator.onLine) {
            await processRecording(audioBlob);
        } else {
            // Store for later sync
            await storeOfflineRecording(audioBlob);
            showToast('Saved offline. Will sync when connected.', 'warning');
        }
    } catch (error) {
        console.error('Error processing recording:', error);
        showToast('Error processing recording', 'error');
    } finally {
        hideProcessingOverlay();
    }
}

async function processRecording(audioBlob) {
    try {
        // Create form data
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        formData.append('folder', state.currentFolder);
        formData.append('timestamp', new Date().toISOString());

        // Send to backend
        const response = await fetch(`${CONFIG.API_BASE}/transcribe`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error('Transcription failed');
        }

        const result = await response.json();

        updateProcessingText('AI is processing...');

        // AI processes the transcript
        const aiResponse = await fetch(`${CONFIG.API_BASE}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: result.transcript,
                folder: state.currentFolder,
                timestamp: result.timestamp,
            }),
        });

        if (!aiResponse.ok) {
            throw new Error('AI processing failed');
        }

        const aiResult = await aiResponse.json();

        // Add to entries
        addEntry({
            id: aiResult.id,
            preview: aiResult.preview || result.transcript.slice(0, 100),
            folder: aiResult.folder || state.currentFolder,
            timestamp: result.timestamp,
        });

        showToast('Thought captured successfully', 'success');

    } catch (error) {
        console.error('Error processing recording:', error);
        throw error;
    }
}

async function storeOfflineRecording(audioBlob) {
    // Convert blob to base64 for storage
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);

    reader.onloadend = () => {
        const pending = {
            id: Date.now(),
            audio: reader.result,
            folder: state.currentFolder,
            timestamp: new Date().toISOString(),
        };

        state.pendingRecordings.push(pending);
        localStorage.setItem('cortex_pending', JSON.stringify(state.pendingRecordings));
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UI UPDATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function updateRecordingUI(isRecording) {
    elements.recordBtn.classList.toggle('recording', isRecording);
    elements.recordRings.classList.toggle('active', isRecording);
    elements.status.classList.toggle('recording', isRecording);
    elements.timer.classList.toggle('active', isRecording);
    elements.waveformContainer.classList.toggle('active', isRecording);

    const statusText = elements.status.querySelector('.status-text');
    statusText.textContent = isRecording ? 'Recording...' : 'Ready to capture';
}

function startTimer() {
    elements.timer.textContent = '00:00';
    state.timerInterval = setInterval(() => {
        const elapsed = Date.now() - state.recordingStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        elements.timer.textContent =
            `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;

        // Auto-stop at max duration
        if (elapsed >= CONFIG.MAX_RECORDING_DURATION) {
            stopRecording();
        }
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

function startWaveformVisualization() {
    const canvas = elements.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const barWidth = canvas.width / CONFIG.WAVEFORM_BAR_COUNT;

    function draw() {
        if (!state.isRecording) return;

        state.animationFrame = requestAnimationFrame(draw);
        state.analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, '#00d4aa');
        gradient.addColorStop(0.5, '#00b4d8');
        gradient.addColorStop(1, '#00d4aa');

        for (let i = 0; i < CONFIG.WAVEFORM_BAR_COUNT; i++) {
            const dataIndex = Math.floor(i * bufferLength / CONFIG.WAVEFORM_BAR_COUNT);
            const value = dataArray[dataIndex];
            const barHeight = (value / 255) * canvas.height * 0.8;
            const x = i * barWidth + barWidth * 0.1;
            const y = (canvas.height - barHeight) / 2;

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth * 0.8, barHeight, 2);
            ctx.fill();
        }
    }

    draw();
}

function stopWaveformVisualization() {
    if (state.animationFrame) {
        cancelAnimationFrame(state.animationFrame);
        state.animationFrame = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FOLDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function openFolderPanel() {
    elements.folderPanel.classList.add('open');
    elements.folderPanelOverlay.classList.add('open');
    renderFolderList();
}

function closeFolderPanel() {
    elements.folderPanel.classList.remove('open');
    elements.folderPanelOverlay.classList.remove('open');
}

function renderFolderList() {
    clearElement(elements.folderList);

    state.folders.forEach(folder => {
        const button = createElement('button', `folder-item${folder.name === state.currentFolder ? ' selected' : ''}`);
        button.dataset.folder = folder.name;

        // Icon container
        const iconDiv = createElement('div', 'folder-item-icon');
        iconDiv.appendChild(createSvgElement('0 0 24 24', [
            'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z'
        ]));

        // Info container
        const infoDiv = createElement('div', 'folder-item-info');
        const nameDiv = createElement('div', 'folder-item-name', folder.name);
        const countDiv = createElement('div', 'folder-item-count', `${folder.count} thoughts`);
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(countDiv);

        button.appendChild(iconDiv);
        button.appendChild(infoDiv);

        button.addEventListener('click', () => selectFolder(folder.name));

        elements.folderList.appendChild(button);
    });
}

function selectFolder(folderName) {
    state.currentFolder = folderName;
    updateCurrentFolderDisplay();
    closeFolderPanel();
}

function updateCurrentFolderDisplay() {
    const folderSpan = elements.currentFolder.querySelector('span');
    folderSpan.textContent = state.currentFolder;
}

async function addNewFolder() {
    const name = prompt('Enter folder name:');
    if (name && name.trim()) {
        const folderName = name.trim().toLowerCase().replace(/\s+/g, '-');

        // Check if exists
        if (state.folders.find(f => f.name === folderName)) {
            showToast('Folder already exists', 'error');
            return;
        }

        state.folders.push({
            name: folderName,
            count: 0,
            description: '',
        });

        // Create folder on backend
        try {
            await fetch(`${CONFIG.API_BASE}/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: folderName }),
            });
        } catch (error) {
            console.error('Error creating folder:', error);
        }

        renderFolderList();
        showToast(`Folder "${folderName}" created`, 'success');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRIES FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function addEntry(entry) {
    state.entries.unshift(entry);

    // Update folder count
    const folder = state.folders.find(f => f.name === entry.folder);
    if (folder) folder.count++;

    renderEntries();
}

function renderEntries() {
    clearElement(elements.entriesList);

    if (state.entries.length === 0) {
        const emptyDiv = createElement('div', 'entries-empty');

        const svg = createSvgElement('0 0 24 24', [
            'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z',
            'M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z'
        ]);
        svg.classList.add('entries-empty-icon');

        const p = document.createElement('p');
        p.appendChild(document.createTextNode('No thoughts captured yet.'));
        p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode('Tap the button to start recording.'));

        emptyDiv.appendChild(svg);
        emptyDiv.appendChild(p);
        elements.entriesList.appendChild(emptyDiv);
        return;
    }

    state.entries.slice(0, 5).forEach((entry, i) => {
        const card = createElement('div', 'entry-card');
        card.style.animationDelay = `${i * 0.05}s`;
        card.dataset.id = entry.id;

        // Entry icon
        const iconDiv = createElement('div', 'entry-icon');
        iconDiv.appendChild(createSvgElement('0 0 24 24', [
            'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z',
            'M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5'
        ]));

        // Content
        const contentDiv = createElement('div', 'entry-content');
        const preview = createElement('p', 'entry-preview', entry.preview);

        const metaDiv = createElement('div', 'entry-meta');
        const timeSpan = createElement('span', null, formatTimestamp(entry.timestamp));

        const folderSpan = createElement('span', 'entry-folder');
        const folderIcon = createSvgElement('0 0 24 24', [
            'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z'
        ]);
        folderSpan.appendChild(folderIcon);
        folderSpan.appendChild(document.createTextNode(entry.folder));

        metaDiv.appendChild(timeSpan);
        metaDiv.appendChild(folderSpan);
        contentDiv.appendChild(preview);
        contentDiv.appendChild(metaDiv);

        card.appendChild(iconDiv);
        card.appendChild(contentDiv);

        elements.entriesList.appendChild(card);
    });
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY & TOAST FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function showProcessingOverlay(text) {
    elements.processingText.textContent = text;
    elements.processingOverlay.classList.add('active');
}

function updateProcessingText(text) {
    elements.processingText.textContent = text;
}

function hideProcessingOverlay() {
    elements.processingOverlay.classList.remove('active');
}

function showToast(message, type = 'success') {
    const toast = createElement('div', 'toast');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.classList.add('toast-icon', type);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (type === 'success') {
        path.setAttribute('d', 'M20 6L9 17l-5-5');
    } else if (type === 'error') {
        path.setAttribute('d', 'M18 6L6 18M6 6l12 12');
    } else {
        path.setAttribute('d', 'M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z');
    }
    svg.appendChild(path);

    const span = createElement('span', 'toast-message', message);

    toast.appendChild(svg);
    toast.appendChild(span);
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER & OFFLINE
// ═══════════════════════════════════════════════════════════════════════════

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration.scope);
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}

async function syncPendingRecordings() {
    const pending = localStorage.getItem('cortex_pending');
    if (!pending) return;

    const recordings = JSON.parse(pending);
    if (recordings.length === 0) return;

    for (const recording of recordings) {
        try {
            // Convert base64 back to blob
            const response = await fetch(recording.audio);
            const blob = await response.blob();
            await processRecording(blob);
        } catch (error) {
            console.error('Error syncing recording:', error);
        }
    }

    // Clear pending
    localStorage.removeItem('cortex_pending');
    state.pendingRecordings = [];
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

function initEventListeners() {
    // Record button
    elements.recordBtn.addEventListener('click', () => {
        if (state.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    // Folder panel
    elements.btnFolders.addEventListener('click', openFolderPanel);
    elements.btnCloseFolders.addEventListener('click', closeFolderPanel);
    elements.folderPanelOverlay.addEventListener('click', closeFolderPanel);
    elements.btnChangeFolder.addEventListener('click', openFolderPanel);
    elements.btnAddFolder.addEventListener('click', addNewFolder);

    // Online/offline events
    window.addEventListener('online', () => {
        showToast('Back online. Syncing...', 'success');
        syncPendingRecordings();
    });

    window.addEventListener('offline', () => {
        showToast('You are offline. Recordings will sync when connected.', 'warning');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            if (state.isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function init() {
    // Initialize neural background
    new NeuralBackground(elements.neuralBg);

    // Initialize event listeners
    initEventListeners();

    // Register service worker
    await registerServiceWorker();

    // Load pending recordings
    const pending = localStorage.getItem('cortex_pending');
    if (pending) {
        state.pendingRecordings = JSON.parse(pending);
    }

    // Sync if online
    if (navigator.onLine && state.pendingRecordings.length > 0) {
        syncPendingRecordings();
    }

    // Render initial state
    updateCurrentFolderDisplay();
    renderEntries();

    // Fetch folders and entries from backend
    try {
        const [foldersRes, entriesRes] = await Promise.all([
            fetch(`${CONFIG.API_BASE}/folders`),
            fetch(`${CONFIG.API_BASE}/entries?limit=5`),
        ]);

        if (foldersRes.ok) {
            state.folders = await foldersRes.json();
            renderFolderList();
        }

        if (entriesRes.ok) {
            state.entries = await entriesRes.json();
            renderEntries();
        }
    } catch (error) {
        console.log('Backend not available, using local state');
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
