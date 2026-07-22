'use strict';

/* ═══════════════════════════════════════════════════════════
   NEXA AI — Professional Emergency Assistant (Redesign)
   Voice-to-Text | Smart Detection | User-Friendly
   ═══════════════════════════════════════════════════════════ */

const API = '';

// ── State ──────────────────────────────────────────────────
const state = {
    user: null,
    config: null,
    isThinking: false,
    abortController: null,
    isRecording: false,
    recognition: null,
    conversationStarted: false,
    // Enhanced location tracking
    locationTracker: {
        watchId: null,
        coordinates: [], // Last 3 coordinates
        lastUpdate: null,
        isStationary: false,
        stationaryStartTime: null,
        stationaryThreshold: 6 * 60 * 1000, // 6 minutes in milliseconds
        movementThreshold: 10, // meters - consider stationary if moved less than this (reduced from 20 for accuracy)
    },
};

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('snx_token');
    if (!token) {
        console.log('[Nexa] No token, redirecting');
        return redirect();
    }

    try {
        const res = await fetch(`${API}/api/dashboard`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!res.ok) {
            localStorage.removeItem('snx_token');
            return redirect();
        }

        const { user } = await res.json();
        if (!user) return redirect();

        state.user = user;
        await loadConfig();
        initChat();
        initConfig();
        initVoiceRecognition();
        startLocationTracking(); // Start continuous location tracking
        
        // Show initial tracking toast notification (non-intrusive)
        setTimeout(() => {
            showToast('📍 GPS tracking started. Collecting location points...', 3000);
        }, 1000);
        
        console.log('[Nexa] Ready for', user.name);
    } catch (err) {
        console.error('[Nexa Boot]', err);
        showToast('Failed to initialize. Please refresh.');
        setTimeout(redirect, 2000);
    }
});

function redirect() {
    window.location.replace('/dashboard');
}

// ── Load Configuration ─────────────────────────────────────
async function loadConfig() {
    try {
        const token = localStorage.getItem('snx_token');
        const res = await fetch(`${API}/api/sos/config`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (res.ok) {
            const { config } = await res.json();
            state.config = config || getDefaultConfig();
        } else {
            state.config = getDefaultConfig();
        }
    } catch (err) {
        console.error('[Config Load]', err);
        state.config = getDefaultConfig();
    }
}

function getDefaultConfig() {
    return {
        primaryContact: '',
        secondaryContact: '',
        safeWords: ['help', 'emergency', 'danger', 'sos'],
    };
}

// ── Chat Interface ─────────────────────────────────────────
function initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const voiceBtn = document.getElementById('voiceBtn');

    sendBtn.addEventListener('click', () => {
        if (state.isThinking) {
            stopThinking();
        } else {
            sendMessage();
        }
    });
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!state.isThinking) sendMessage();
        }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    document.getElementById('backBtn')?.addEventListener('click', () => {
        window.location.href = '/dashboard';
    });
    settingsBtn.addEventListener('click', openConfig);
    voiceBtn.addEventListener('click', toggleVoiceRecording);
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || state.isThinking) return;

    // Hide welcome screen on first message
    if (!state.conversationStarted) {
        hideWelcomeScreen();
        state.conversationStarted = true;
    }

    // Add user message
    addMessage(text, 'user');
    input.value = '';
    input.style.height = 'auto';

    // Check for emergency keywords
    const detected = detectEmergencyKeyword(text);
    if (detected) {
        setTimeout(() => {
            addMessage(
                `I've detected the emergency keyword "${detected}". Activating emergency protocol now.`,
                'ai'
            );
            addEmergencyAlert();
        }, 500);

        setTimeout(() => {
            activateEmergency(detected);
        }, 2000);
    } else {
        // Normal AI conversation
        startThinking();

        try {
            const response = await getAIResponse(text);
            stopThinking();
            addMessage(response, 'ai');
        } catch (err) {
            console.error('[AI Response]', err);
            stopThinking();
            addMessage(
                'I\'m here to help. If you need emergency assistance, say "help", "emergency", or "danger".',
                'ai'
            );
        }
    }
}

async function getAIResponse(userMessage) {
    try {
        state.abortController = new AbortController();
        const token = localStorage.getItem('snx_token');
        
        const res = await fetch(`${API}/api/sos/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ message: userMessage }),
            signal: state.abortController.signal,
        });

        if (!res.ok) throw new Error('Chat API failed');

        const { response } = await res.json();
        return response;
    } catch (err) {
        if (err.name === 'AbortError') {
            return 'Response stopped.';
        }
        throw err;
    }
}

function hideWelcomeScreen() {
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) {
        welcome.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => welcome.remove(), 300);
    }
}

function addMessage(text, sender) {
    const chat = document.getElementById('chatMessages');
    const time = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    const msg = document.createElement('div');
    msg.className = `nexa-message nexa-message--${sender}`;
    
    const avatarSVG = sender === 'ai' 
        ? '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="currentColor"/><path d="M12 8v4l3 2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    msg.innerHTML = `
        <div class="nexa-avatar nexa-avatar--${sender}">
            ${avatarSVG}
        </div>
        <div class="nexa-message-content">
            <div class="nexa-message-bubble">${escapeHtml(text)}</div>
            <div class="nexa-message-time">${time}</div>
        </div>
    `;

    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
}

function addEmergencyAlert() {
    const chat = document.getElementById('chatMessages');
    const alert = document.createElement('div');
    alert.className = 'nexa-message nexa-message--ai';
    alert.innerHTML = `
        <div class="nexa-avatar nexa-avatar--ai">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="currentColor"/>
                <path d="M12 8v4l3 2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <div class="nexa-message-content">
            <div class="nexa-alert">
                <div class="nexa-alert-header">
                    <div class="nexa-alert-icon">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div>
                        <div class="nexa-alert-title">Emergency Protocol</div>
                        <div class="nexa-alert-text">Contacting emergency services</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    chat.appendChild(alert);
    chat.scrollTop = chat.scrollHeight;
}

function detectEmergencyKeyword(text) {
    const lower = text.toLowerCase();
    const keywords = state.config?.safeWords || ['help', 'emergency', 'danger', 'sos'];

    for (const word of keywords) {
        if (lower.includes(word.toLowerCase())) {
            return word;
        }
    }
    return null;
}

// ── Thinking Animation ─────────────────────────────────────
function startThinking() {
    state.isThinking = true;
    
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const inputContainer = document.getElementById('inputContainer');
    
    input.disabled = true;
    input.placeholder = 'AI is thinking...';
    inputContainer.classList.add('disabled');
    
    // Change to stop button
    sendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
        </svg>
    `;
    sendBtn.classList.add('stop');
    
    // Add thinking indicator
    const chat = document.getElementById('chatMessages');
    const thinking = document.createElement('div');
    thinking.className = 'nexa-message nexa-message--ai';
    thinking.id = 'thinkingIndicator';
    thinking.innerHTML = `
        <div class="nexa-avatar nexa-avatar--ai">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="currentColor"/>
                <path d="M12 8v4l3 2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <div class="nexa-message-content">
            <div class="nexa-thinking">
                <div class="nexa-thinking-wave">
                    <div class="nexa-thinking-bar"></div>
                    <div class="nexa-thinking-bar"></div>
                    <div class="nexa-thinking-bar"></div>
                    <div class="nexa-thinking-bar"></div>
                    <div class="nexa-thinking-bar"></div>
                </div>
                <span class="nexa-thinking-text">Nexa AI is thinking...</span>
            </div>
        </div>
    `;
    
    chat.appendChild(thinking);
    chat.scrollTop = chat.scrollHeight;
}

function stopThinking() {
    state.isThinking = false;
    
    if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
    }
    
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const inputContainer = document.getElementById('inputContainer');
    
    input.disabled = false;
    input.placeholder = 'Type your message or use voice...';
    inputContainer.classList.remove('disabled');
    input.focus();
    
    // Restore send button
    sendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
    sendBtn.classList.remove('stop');
    
    // Remove thinking indicator
    const thinking = document.getElementById('thinkingIndicator');
    if (thinking) thinking.remove();
}

// ── Voice Recognition (Voice-to-Text) ──────────────────────
function initVoiceRecognition() {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn('[Voice] Web Speech API not supported');
        return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = false;
    state.recognition.lang = 'en-US';

    state.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log('[Voice] Recognized:', transcript);
        
        // Insert text into input field
        const input = document.getElementById('chatInput');
        input.value = transcript;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        input.focus();
        
        showToast('Voice converted to text');
    };

    state.recognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        state.isRecording = false;
        updateVoiceButton();
        
        if (event.error === 'no-speech') {
            showToast('No speech detected. Please try again.');
        } else if (event.error === 'not-allowed') {
            showToast('Microphone access denied');
        } else {
            showToast('Voice recognition failed');
        }
    };

    state.recognition.onend = () => {
        state.isRecording = false;
        updateVoiceButton();
    };
}

function toggleVoiceRecording() {
    if (!state.recognition) {
        showToast('Voice recognition not supported in this browser');
        return;
    }

    if (state.isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

function startVoiceRecording() {
    try {
        state.isRecording = true;
        updateVoiceButton();
        state.recognition.start();
        showToast('Listening... Speak now');
    } catch (err) {
        console.error('[Voice Start]', err);
        state.isRecording = false;
        updateVoiceButton();
        showToast('Failed to start voice recognition');
    }
}

function stopVoiceRecording() {
    if (state.recognition && state.isRecording) {
        state.recognition.stop();
        state.isRecording = false;
        updateVoiceButton();
    }
}

function updateVoiceButton() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (state.isRecording) {
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
                <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor"/>
            </svg>
        `;
    } else {
        voiceBtn.classList.remove('recording');
        voiceBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" stroke-width="1.5"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `;
    }
}

// ── Enhanced Location Tracking ─────────────────────────────
function startLocationTracking() {
    if (!navigator.geolocation) {
        console.warn('[Location] Geolocation not supported');
        return;
    }

    console.log('[Location] Starting continuous tracking...');

    // Use watchPosition for continuous tracking with high frequency
    state.locationTracker.watchId = navigator.geolocation.watchPosition(
        handleLocationUpdate,
        handleLocationError,
        {
            enableHighAccuracy: true,
            timeout: 30000, // Increased to 30 seconds
            maximumAge: 0, // Always get fresh location
        }
    );
    
    // Also request immediate location to start faster
    navigator.geolocation.getCurrentPosition(
        handleLocationUpdate,
        handleLocationError,
        {
            enableHighAccuracy: true,
            timeout: 30000, // Increased to 30 seconds
            maximumAge: 0,
        }
    );
}

function handleLocationUpdate(position) {
    const newCoord = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: Date.now(),
    };

    // Check if this is a duplicate (same coordinates as last)
    const lastCoord = state.locationTracker.coordinates[state.locationTracker.coordinates.length - 1];
    if (lastCoord && 
        Math.abs(lastCoord.latitude - newCoord.latitude) < 0.000001 &&
        Math.abs(lastCoord.longitude - newCoord.longitude) < 0.000001) {
        console.log('[Location] Duplicate coordinate, skipping...');
        
        // Request fresh location after 3 seconds
        setTimeout(() => {
            navigator.geolocation.getCurrentPosition(
                handleLocationUpdate,
                handleLocationError,
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0,
                }
            );
        }, 3000);
        return;
    }

    // Add to coordinates array (keep last 3)
    state.locationTracker.coordinates.push(newCoord);
    if (state.locationTracker.coordinates.length > 3) {
        state.locationTracker.coordinates.shift();
    }

    state.locationTracker.lastUpdate = Date.now();

    // Update GPS status indicator
    updateGPSStatus();

    // Show notification for coordinate collection
    const coordCount = state.locationTracker.coordinates.length;
    if (coordCount <= 3) {
        // Show small toast notification instead of chat messages
        if (coordCount === 1) {
            showToast('📍 GPS Point 1/3 tracked', 2000);
            // Request next location after 5 seconds
            setTimeout(requestFreshLocation, 5000);
        } else if (coordCount === 2) {
            showToast('📍 GPS Point 2/3 tracked', 2000);
            // Request next location after 5 seconds
            setTimeout(requestFreshLocation, 5000);
        } else if (coordCount === 3) {
            showToast('✅ All 3 GPS points tracked! Emergency system ready', 3000);
        }
    }

    // Check if user is stationary
    checkStationaryStatus();

    console.log('[Location] ═══════════════════════════════════════');
    console.log('[Location] GPS UPDATE #' + coordCount);
    console.log('[Location] Latitude:', newCoord.latitude.toFixed(6));
    console.log('[Location] Longitude:', newCoord.longitude.toFixed(6));
    console.log('[Location] Accuracy: ±' + Math.round(newCoord.accuracy) + 'm');
    console.log('[Location] Total tracked:', coordCount, 'points');
    console.log('[Location] All coordinates:', state.locationTracker.coordinates.map(c => 
        `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`
    ));
    console.log('[Location] Stationary:', state.locationTracker.isStationary);
    if (coordCount >= 2) {
        console.log('[Location] Direction:', calculateDirection());
    }
    console.log('[Location] ═══════════════════════════════════════');
}

function requestFreshLocation() {
    console.log('[Location] Requesting fresh location...');
    navigator.geolocation.getCurrentPosition(
        handleLocationUpdate,
        handleLocationError,
        {
            enableHighAccuracy: true,
            timeout: 30000, // Increased to 30 seconds
            maximumAge: 0,
        }
    );
}

function updateGPSStatus() {
    const gpsStatusText = document.getElementById('gpsStatusText');
    const gpsStatus = document.getElementById('gpsStatus');
    
    if (!gpsStatusText || !gpsStatus) return;
    
    const coordCount = state.locationTracker.coordinates.length;
    
    if (coordCount === 0) {
        gpsStatusText.textContent = 'GPS Ready';
        gpsStatus.classList.remove('tracking');
    } else if (coordCount === 1) {
        gpsStatusText.textContent = 'Tracking (1 point)';
        gpsStatus.classList.add('tracking');
    } else {
        gpsStatusText.textContent = `Tracking (${coordCount} points)`;
        gpsStatus.classList.add('tracking');
    }
}

function handleLocationError(error) {
    console.error('[Location] Error:', error.message);
    // Silently handle errors - don't show alerts to user
    // Just retry after a delay
    setTimeout(() => {
        if (state.locationTracker.coordinates.length < 3) {
            requestFreshLocation();
        }
    }, 5000);
}

function checkStationaryStatus() {
    const coords = state.locationTracker.coordinates;
    
    if (coords.length < 2) {
        // Not enough data, assume stationary
        state.locationTracker.isStationary = true;
        if (!state.locationTracker.stationaryStartTime) {
            state.locationTracker.stationaryStartTime = Date.now();
        }
        return;
    }

    // Calculate total distance moved across all coordinates
    let totalDistance = 0;
    for (let i = 1; i < coords.length; i++) {
        const distance = calculateDistance(
            coords[i - 1].latitude,
            coords[i - 1].longitude,
            coords[i].latitude,
            coords[i].longitude
        );
        totalDistance += distance;
    }
    
    // Calculate average distance per update
    const avgDistance = totalDistance / (coords.length - 1);
    
    // Also check max distance from first point
    const firstCoord = coords[0];
    let maxDistance = 0;
    for (let i = 1; i < coords.length; i++) {
        const distance = calculateDistance(
            firstCoord.latitude,
            firstCoord.longitude,
            coords[i].latitude,
            coords[i].longitude
        );
        maxDistance = Math.max(maxDistance, distance);
    }

    const wasStationary = state.locationTracker.isStationary;

    // User is stationary if:
    // 1. Total distance is less than threshold, OR
    // 2. Max distance from first point is less than threshold, OR
    // 3. Average distance per update is very small
    const isStationary = totalDistance < state.locationTracker.movementThreshold || 
                        maxDistance < state.locationTracker.movementThreshold ||
                        avgDistance < 5; // Less than 5m average movement

    if (isStationary) {
        if (!state.locationTracker.isStationary) {
            // Just became stationary
            state.locationTracker.isStationary = true;
            state.locationTracker.stationaryStartTime = Date.now();
            console.log('[Location] User is STATIONARY (total distance:', Math.round(totalDistance), 'm, max:', Math.round(maxDistance), 'm)');
        } else {
            // Check how long stationary
            const stationaryDuration = Date.now() - state.locationTracker.stationaryStartTime;
            
            if (stationaryDuration >= state.locationTracker.stationaryThreshold) {
                // User has been stationary for 6+ minutes
                if (!wasStationary || stationaryDuration % (2 * 60 * 1000) < 10000) {
                    // Alert every 2 minutes after threshold
                    console.log('[Location] User stationary for', Math.round(stationaryDuration / 60000), 'minutes');
                    showStationaryAlert(stationaryDuration);
                }
            }
        }
    } else {
        // User is moving
        if (state.locationTracker.isStationary) {
            console.log('[Location] User is MOVING (total distance:', Math.round(totalDistance), 'm, max:', Math.round(maxDistance), 'm)');
        }
        state.locationTracker.isStationary = false;
        state.locationTracker.stationaryStartTime = null;
    }
}

function showStationaryAlert(duration) {
    const minutes = Math.round(duration / 60000);
    const chat = document.getElementById('chatMessages');
    
    const alert = document.createElement('div');
    alert.className = 'nexa-message nexa-message--ai';
    alert.innerHTML = `
        <div class="nexa-avatar nexa-avatar--ai">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="currentColor"/>
            </svg>
        </div>
        <div class="nexa-message-content">
            <div class="nexa-alert nexa-alert--warning">
                <div class="nexa-alert-header">
                    <div class="nexa-alert-icon">
                        <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M12 6v6M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <div>
                        <div class="nexa-alert-title">Stationary Alert</div>
                        <div class="nexa-alert-text">You've been stationary for ${minutes} minutes. Are you okay?</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    chat.appendChild(alert);
    chat.scrollTop = chat.scrollHeight;
    
    showToast(`⚠️ Stationary for ${minutes} minutes`, 4000);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    // Haversine formula to calculate distance in meters
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

function calculateDirection() {
    const coords = state.locationTracker.coordinates;
    
    if (coords.length < 2) return 'Unknown';

    // Method 1: Calculate bearing from first to last point (overall direction)
    const firstCoord = coords[0];
    const lastCoord = coords[coords.length - 1];
    
    // Check if there's significant movement (at least 15 meters)
    const totalDistance = calculateDistance(
        firstCoord.latitude,
        firstCoord.longitude,
        lastCoord.latitude,
        lastCoord.longitude
    );
    
    // If movement is too small, direction is unreliable due to GPS noise
    if (totalDistance < 15) {
        console.log('[Direction] Insufficient movement for accurate direction:', Math.round(totalDistance), 'm');
        return 'Insufficient movement';
    }

    // Calculate bearing using all consecutive points and average them
    let bearings = [];
    for (let i = 1; i < coords.length; i++) {
        const prevCoord = coords[i - 1];
        const currCoord = coords[i];
        
        // Calculate distance for this segment
        const segmentDistance = calculateDistance(
            prevCoord.latitude,
            prevCoord.longitude,
            currCoord.latitude,
            currCoord.longitude
        );
        
        // Only include segments with significant movement (> 5m)
        if (segmentDistance > 5) {
            const bearing = calculateBearing(
                prevCoord.latitude,
                prevCoord.longitude,
                currCoord.latitude,
                currCoord.longitude
            );
            bearings.push(bearing);
        }
    }
    
    // If no significant movements, return insufficient
    if (bearings.length === 0) {
        console.log('[Direction] No significant movements detected');
        return 'Insufficient movement';
    }
    
    // Calculate average bearing (handling circular nature of angles)
    const avgBearing = averageBearing(bearings);
    
    // Also calculate direct bearing from first to last for comparison
    const directBearing = calculateBearing(
        firstCoord.latitude,
        firstCoord.longitude,
        lastCoord.latitude,
        lastCoord.longitude
    );
    
    // Use direct bearing if it's more reliable (longer distance)
    const finalBearing = totalDistance > 30 ? directBearing : avgBearing;
    
    // Convert to cardinal direction with 16 points for better accuracy
    const direction = bearingToCardinal16(finalBearing);
    
    console.log('[Direction] Total distance:', Math.round(totalDistance), 'm');
    console.log('[Direction] Average bearing:', Math.round(avgBearing), '°');
    console.log('[Direction] Direct bearing:', Math.round(directBearing), '°');
    console.log('[Direction] Final bearing:', Math.round(finalBearing), '°');
    console.log('[Direction] Cardinal direction:', direction);
    
    return direction;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    // Convert to radians
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    // Calculate bearing
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    
    // Normalize to 0-360
    bearing = (bearing + 360) % 360;
    
    return bearing;
}

function averageBearing(bearings) {
    if (bearings.length === 0) return 0;
    if (bearings.length === 1) return bearings[0];
    
    // Convert bearings to unit vectors and average them
    let sumX = 0;
    let sumY = 0;
    
    bearings.forEach(bearing => {
        const rad = bearing * Math.PI / 180;
        sumX += Math.cos(rad);
        sumY += Math.sin(rad);
    });
    
    const avgX = sumX / bearings.length;
    const avgY = sumY / bearings.length;
    
    // Convert back to bearing
    let avgBearing = Math.atan2(avgY, avgX) * 180 / Math.PI;
    avgBearing = (avgBearing + 360) % 360;
    
    return avgBearing;
}

function bearingToCardinal16(bearing) {
    // 16-point compass for better accuracy
    const directions = [
        'N',   // 0° (337.5° - 22.5°)
        'NNE', // 22.5°
        'NE',  // 45°
        'ENE', // 67.5°
        'E',   // 90°
        'ESE', // 112.5°
        'SE',  // 135°
        'SSE', // 157.5°
        'S',   // 180°
        'SSW', // 202.5°
        'SW',  // 225°
        'WSW', // 247.5°
        'W',   // 270°
        'WNW', // 292.5°
        'NW',  // 315°
        'NNW'  // 337.5°
    ];
    
    // Each direction covers 22.5 degrees
    const index = Math.round(bearing / 22.5) % 16;
    
    return directions[index];
}

function getMovementTrail() {
    const coords = state.locationTracker.coordinates;
    
    if (coords.length === 0) return 'No location data';
    if (coords.length === 1) return 'Single location point';

    const trail = coords.map((coord, index) => {
        const time = new Date(coord.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
        });
        return `${index + 1}. ${coord.latitude.toFixed(6)}, ${coord.longitude.toFixed(6)} (${time})`;
    }).join('\n');

    return trail;
}

function stopLocationTracking() {
    if (state.locationTracker.watchId !== null) {
        navigator.geolocation.clearWatch(state.locationTracker.watchId);
        state.locationTracker.watchId = null;
        console.log('[Location] Tracking stopped');
    }
}

// ── Emergency Activation ───────────────────────────────────
async function activateEmergency(triggeredBy) {
    console.log('[Emergency] Activated by:', triggeredBy);

    // Validate config
    if (!state.config?.primaryContact) {
        showToast('Please configure emergency contact in settings first');
        setTimeout(openConfig, 1500);
        return;
    }

    // Get location
    showToast('Acquiring your location...');
    const location = await acquireLocation();

    // Prepare message
    const message = prepareEmergencyMessage(location);

    // Save emergency session to database
    await saveEmergencySession(triggeredBy, location);

    // Send via WhatsApp
    await sendWhatsAppMessage(message);
}

async function saveEmergencySession(triggeredBy, location) {
    try {
        const token = localStorage.getItem('snx_token');
        const sessionId = `sos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const sessionData = {
            sessionId,
            triggeredBy,
            startTime: new Date().toISOString(),
            endTime: null,
            events: [
                {
                    type: 'emergency_detected',
                    keyword: triggeredBy,
                    timestamp: new Date().toISOString(),
                },
                {
                    type: 'location_acquired',
                    coordinates: location ? location.trail?.length || 1 : 0,
                    timestamp: new Date().toISOString(),
                },
                {
                    type: 'whatsapp_initiated',
                    timestamp: new Date().toISOString(),
                },
            ],
            location: location ? {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                trail: location.trail || [],
                direction: location.direction,
                isStationary: location.isStationary,
                stationaryDuration: location.stationaryDuration,
            } : null,
        };

        const res = await fetch(`${API}/api/sos/session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(sessionData),
        });

        if (res.ok) {
            console.log('[Emergency] Session saved to database');
        } else {
            console.warn('[Emergency] Failed to save session');
        }
    } catch (err) {
        console.error('[Emergency] Error saving session:', err);
    }
}

async function acquireLocation() {
    // Use tracked coordinates if available
    const coords = state.locationTracker.coordinates;
    
    console.log('[Location] Acquiring location, tracked coords:', coords.length);
    
    if (coords.length > 0) {
        const latest = coords[coords.length - 1];
        const direction = coords.length > 1 ? calculateDirection() : 'Unknown';
        
        const locationData = {
            latitude: latest.latitude,
            longitude: latest.longitude,
            accuracy: latest.accuracy,
            trail: coords.length > 1 ? coords : [], // Only include trail if we have multiple points
            direction: direction,
            isStationary: state.locationTracker.isStationary,
            stationaryDuration: state.locationTracker.isStationary && state.locationTracker.stationaryStartTime
                ? Math.round((Date.now() - state.locationTracker.stationaryStartTime) / 60000)
                : 0,
        };
        
        console.log('[Location] Using tracked location:');
        console.log('[Location] - Coordinates:', coords.length, 'points');
        console.log('[Location] - Direction:', direction);
        console.log('[Location] - Stationary:', state.locationTracker.isStationary);
        
        return locationData;
    }

    // Fallback to single location request
    console.log('[Location] No tracked coords, requesting fresh location...');
    try {
        const position = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            });
        });

        const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            trail: [],
            direction: 'Unknown',
            isStationary: false,
            stationaryDuration: 0,
        };
        
        console.log('[Location] Fresh location acquired:', locationData);
        return locationData;
    } catch (err) {
        console.error('[Location] Error acquiring location:', err);
        return null;
    }
}

function prepareEmergencyMessage(location) {
    const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    let message = `🚨 EMERGENCY ALERT 🚨\n\n`;
    
    // User details
    message += `👤 Person: ${state.user.name}\n`;
    message += `🆔 SafeNex ID: ${state.user.safeNexID || 'N/A'}\n`;
    message += `📧 Email: ${state.user.email || 'N/A'}\n\n`;
    message += `⚠️ NEEDS IMMEDIATE HELP ⚠️\n\n`;
    
    if (location) {
        // Current location
        const mapLink = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
        message += `📍 CURRENT LOCATION:\n`;
        message += `${mapLink}\n`;
        message += `Coordinates: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}\n`;
        message += `Accuracy: ±${Math.round(location.accuracy)}m\n`;
        message += `Updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}\n\n`;
        
        // Movement trail with all details
        if (location.trail && location.trail.length > 1) {
            message += `🚶 MOVEMENT TRAIL (Last ${location.trail.length} locations):\n\n`;
            
            location.trail.forEach((coord, index) => {
                const time = new Date(coord.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                const coordMapLink = `https://www.google.com/maps?q=${coord.latitude},${coord.longitude}`;
                
                message += `Location ${index + 1} - ${time}\n`;
                message += `${coordMapLink}\n`;
                message += `Lat: ${coord.latitude.toFixed(6)}, Lon: ${coord.longitude.toFixed(6)}\n`;
                message += `Accuracy: ±${Math.round(coord.accuracy)}m\n`;
                
                // Distance from previous point
                if (index > 0) {
                    const prevCoord = location.trail[index - 1];
                    const distance = calculateDistance(
                        prevCoord.latitude,
                        prevCoord.longitude,
                        coord.latitude,
                        coord.longitude
                    );
                    const timeDiff = Math.round((coord.timestamp - prevCoord.timestamp) / 1000);
                    message += `Moved: ${Math.round(distance)}m in ${timeDiff}s\n`;
                }
                message += `\n`;
            });
            
            // Total distance
            let totalDistance = 0;
            for (let i = 1; i < location.trail.length; i++) {
                totalDistance += calculateDistance(
                    location.trail[i - 1].latitude,
                    location.trail[i - 1].longitude,
                    location.trail[i].latitude,
                    location.trail[i].longitude
                );
            }
            message += `Total Distance Traveled: ${Math.round(totalDistance)}m\n\n`;
        } else if (location.trail && location.trail.length === 1) {
            message += `📌 Single location tracked\n\n`;
        }
        
        // Direction
        if (location.direction && location.direction !== 'Unknown' && location.direction !== 'Insufficient movement') {
            message += `🧭 DIRECTION: Moving ${location.direction}\n\n`;
        } else if (location.direction === 'Insufficient movement') {
            message += `🧭 DIRECTION: Stationary (no significant movement)\n\n`;
        }
        
        // Stationary alert
        if (location.isStationary && location.stationaryDuration >= 6) {
            message += `🚨 CRITICAL: User stationary for ${location.stationaryDuration} minutes!\n`;
            message += `⚠️ May be unable to move - CHECK IMMEDIATELY\n\n`;
        } else if (location.isStationary && location.stationaryDuration > 0) {
            message += `⚠️ User is stationary (not moving)\n\n`;
        } else if (location.trail && location.trail.length > 1) {
            message += `✓ User is moving\n\n`;
        } else {
            message += `📌 Movement status: Unknown (single point)\n\n`;
        }
    } else {
        message += `📍 LOCATION: Unable to acquire GPS\n\n`;
    }
    
    message += `🕐 Alert Time: ${timestamp}\n`;
    message += `🔔 Triggered by: Keyword Detection\n`;
    message += `📱 Platform: SafeNex Nexa AI SOS\n\n`;
    message += `⚡ RESPOND IMMEDIATELY ⚡\n`;
    message += `Contact ${state.user.name} now!`;

    console.log('[Emergency] ═══════════════════════════════════════');
    console.log('[Emergency] PREPARED MESSAGE:');
    console.log(message);
    console.log('[Emergency] ═══════════════════════════════════════');
    console.log('[Emergency] Message length:', message.length, 'characters');
    console.log('[Emergency] Trail points:', location?.trail?.length || 0);
    
    return message;
}

async function sendWhatsAppMessage(message) {
    try {
        let contact = (state.config?.primaryContact || '').replace(/\D/g, '');
        
        if (!contact) {
            throw new Error('No emergency contact configured');
        }

        // Add default country code 91 if 10 digits
        if (contact.length === 10) {
            contact = '91' + contact;
        }

        const encodedMessage = encodeURIComponent(message);
        const waUrl = `https://wa.me/${contact}?text=${encodedMessage}`;
        
        console.log('[WhatsApp] Dispatching link:', waUrl);
        showToast('📲 Launching WhatsApp... Press Send to alert your contact', 4000);

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isCapacitor = !!window.Capacitor;

        if (isMobile || isCapacitor) {
            window.location.href = waUrl;
        } else {
            const win = window.open(waUrl, '_blank');
            if (!win) {
                window.location.href = waUrl;
            }
        }
    } catch (err) {
        console.error('[WhatsApp]', err);
        showToast('Failed to open WhatsApp. Please check your emergency contacts in settings.');
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }
}

// ── Configuration ──────────────────────────────────────────
function initConfig() {
    const modal = document.getElementById('configModal');
    const closeBtn = document.getElementById('configClose');
    const cancelBtn = document.getElementById('configCancel');
    const saveBtn = document.getElementById('configSave');

    closeBtn.addEventListener('click', closeConfig);
    cancelBtn.addEventListener('click', closeConfig);
    saveBtn.addEventListener('click', saveConfig);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeConfig();
    });
}

function openConfig() {
    // Populate fields
    document.getElementById('primaryContact').value = state.config.primaryContact || '';
    document.getElementById('secondaryContact').value = state.config.secondaryContact || '';

    document.getElementById('configModal').style.display = 'flex';
}

function closeConfig() {
    document.getElementById('configModal').style.display = 'none';
}

async function saveConfig() {
    const primaryInput = document.getElementById('primaryContact');
    const secondaryInput = document.getElementById('secondaryContact');
    const saveBtn = document.getElementById('configSave');
    const saveIcon = saveBtn?.querySelector('.nexa-save-icon');
    const saveSpinner = saveBtn?.querySelector('.nexa-save-spinner');
    const saveText = saveBtn?.querySelector('.nexa-save-text');

    const primaryContact = primaryInput?.value.trim() || '';
    const secondaryContact = secondaryInput?.value.trim() || '';

    if (!primaryContact) {
        showToast('⚠️ Primary emergency contact phone number is required');
        primaryInput?.focus();
        return;
    }

    const config = {
        primaryContact,
        secondaryContact,
        safeWords: state.config?.safeWords || ['help', 'emergency', 'danger', 'sos'],
    };

    // UI Loading state
    if (saveBtn) saveBtn.disabled = true;
    if (saveIcon) saveIcon.style.display = 'none';
    if (saveSpinner) saveSpinner.style.display = 'inline-block';
    if (saveText) saveText.textContent = 'Saving...';

    try {
        const token = localStorage.getItem('snx_token');
        const res = await fetch(`${API}/api/sos/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                ...config,
                messageTemplate: '',
                voiceActivationEnabled: false,
                liveBeaconEnabled: false,
                beaconUpdateInterval: 60,
                batteryLevelEnabled: true,
                timestampEnabled: true,
            }),
        });

        if (res.ok) {
            state.config = config;
            showToast('✅ Emergency contacts saved successfully');
            closeConfig();
        } else {
            showToast('Failed to save settings. Please try again.');
        }
    } catch (err) {
        console.error('[Config Save]', err);
        showToast('Failed to save settings. Connection error.');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (saveIcon) saveIcon.style.display = 'inline-block';
        if (saveSpinner) saveSpinner.style.display = 'none';
        if (saveText) saveText.textContent = 'Save Settings';
    }
}

// ── Utilities ──────────────────────────────────────────────
function showToast(msg, duration = 2600) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = msg;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
