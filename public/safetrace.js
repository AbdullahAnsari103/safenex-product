/**
 * SafeTrace Frontend - Production-Ready Risk-Aware Navigation
 * Optimized for performance and user experience
 */

// Configuration
const API_BASE = '/api/safetrace';
const UPDATE_INTERVAL = 10000; // 10 seconds for location updates
const DEVIATION_THRESHOLD = 50; // 50 meters
const MAX_ROUTE_DISTANCE_KM = 150; // OpenRouteService limit for walking routes
const DEBOUNCE_DELAY = 300; // ms for input debouncing
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache for geocoding (reduced from 5)
const AUTOCOMPLETE_CACHE_DURATION = 30 * 1000; // 30 seconds for autocomplete

// State
let map = null;
let userMarker = null;
let currentPosition = null;
let currentHeading = null; // Track user's heading/direction
let watchId = null;
let routes = [];
let selectedRoute = null;
let routeLayer = null;
let dangerZoneLayer = null;
let isNavigating = false;
// ✅ BUG 15 FIX: Removed unused updateTimer (never assigned anywhere)
// ✅ BUG 14 FIX: Removed unused autocompleteTimeout (local variable used instead)
let usingGPS = false;
let manualStartLocation = null;
let mapTheme = 'bright'; // Default theme
let tileLayer = null; // Store tile layer reference
let travelMode = 'foot-walking'; // Default travel mode
let sharedAudioContext = null; // ✅ BUG 11 FIX: Reuse single AudioContext across all alerts

// Performance optimization: Cache for geocoding results
const geocodeCache = new Map();

// Performance optimization: Request deduplication
const pendingRequests = new Map();

// Get auth token
function getToken() {
    // Try both token names for compatibility
    return localStorage.getItem('snx_token') || localStorage.getItem('token');
}

// API Helper with request deduplication and caching
async function apiCall(endpoint, options = {}) {
    const token = getToken();
    if (!token) {
        console.warn('No authentication token found');
        throw new Error('Authentication required');
    }

    // Create cache key for GET requests
    const cacheKey = options.method === 'GET' || !options.method ? endpoint : null;
    
    // Use shorter cache for autocomplete
    const cacheDuration = endpoint.includes('/autocomplete') ? AUTOCOMPLETE_CACHE_DURATION : CACHE_DURATION;
    
    // Check cache for GET requests
    if (cacheKey && geocodeCache.has(cacheKey)) {
        const cached = geocodeCache.get(cacheKey);
        if (Date.now() - cached.timestamp < cacheDuration) {
            console.log('Using cached response for:', endpoint);
            return cached.data;
        }
        geocodeCache.delete(cacheKey);
    }

    // Request deduplication: prevent duplicate simultaneous requests
    const requestKey = `${endpoint}-${options.body || ''}`; // ✅ BUG 8 FIX: body is already JSON string
    if (pendingRequests.has(requestKey)) {
        console.log('Reusing pending request for:', endpoint);
        return pendingRequests.get(requestKey);
    }

    const requestPromise = (async () => {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers
                }
            });

            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }

            if (!response.ok) {
                // If unauthorized, redirect to login
                if (response.status === 401 || response.status === 403) {
                    console.error('Authentication failed, redirecting to login');
                    setTimeout(() => {
                        window.location.href = '/onboarding.html';
                    }, 1000);
                }
                throw new Error(data?.message || data?.error || 'Request failed');
            }

            // Cache GET requests
            if (cacheKey) {
                geocodeCache.set(cacheKey, {
                    data: data,
                    timestamp: Date.now()
                });
            }

            return data;
        } catch (error) {
            console.error('API call error:', error);
            throw error;
        } finally {
            // Remove from pending requests
            pendingRequests.delete(requestKey);
        }
    })();

    // Store pending request
    pendingRequests.set(requestKey, requestPromise);
    
    return requestPromise;
}

// Initialize Map
function initMap() {
    try {
        console.log('Initializing map...');
        
        // Check if Leaflet is loaded
        if (typeof L === 'undefined') {
            console.error('Leaflet library not loaded!');
            showNotification('Map library failed to load. Please refresh the page.', 'error');
            return;
        }

        // Initialize map
        map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([19.0760, 72.8777], 13); // Default to Mumbai

        console.log('Map object created');

        // Load saved theme or default to bright
        mapTheme = localStorage.getItem('safetrace_map_theme') || 'bright';
        
        // Apply theme
        applyMapTheme(mapTheme);

        console.log('Tiles added');

        // Add zoom control to bottom right
        L.control.zoom({
            position: 'bottomright'
        }).addTo(map);

        // Initialize layers
        dangerZoneLayer = L.layerGroup().addTo(map);
        routeLayer = L.layerGroup().addTo(map);

        console.log('Map initialized successfully');

        // Hide loading indicator
        const mapLoading = document.getElementById('mapLoading');
        if (mapLoading) {
            mapLoading.style.display = 'none';
        }

        // Force map to resize
        setTimeout(() => {
            map.invalidateSize();
        }, 100);

        // Start location tracking
        startLocationTracking();
    } catch (error) {
        console.error('Map initialization error:', error);
        showNotification('Failed to initialize map: ' + error.message, 'error');
        
        // Hide loading indicator
        const mapLoading = document.getElementById('mapLoading');
        if (mapLoading) {
            mapLoading.innerHTML = '<p style="color: #EF4444;">Failed to load map. Please refresh the page.</p>';
        }
    }
}

// Apply Map Theme
function applyMapTheme(theme) {
    // Remove existing tile layer if present
    if (tileLayer) {
        map.removeLayer(tileLayer);
    }

    if (theme === 'dark') {
        // Dark theme tiles
        tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors, © CARTO'
        }).addTo(map);
    } else {
        // Bright theme tiles (default OpenStreetMap)
        tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }

    // Update button states
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    // Save preference
    localStorage.setItem('safetrace_map_theme', theme);
    mapTheme = theme;
}

// Toggle Map Theme
function toggleMapTheme(theme) {
    applyMapTheme(theme);
    showNotification(`Map theme changed to ${theme}`, 'success');
}

// Start Location Tracking with Progressive Enhancement
function startLocationTracking() {
    if (!navigator.geolocation) {
        showNotification('Geolocation is not supported by your browser', 'error');
        updateLocationStatus('Geolocation not supported. Please enter address manually.', 'error');
        return;
    }

    updateLocationStatus('Getting your location...', 'info');

    // ✅ BUG 2 FIX: Shared flag across all location attempts (not just fast path)
    let locationAcquired = false;

    const onSuccess = (position) => {
        if (locationAcquired) return; // ✅ Guard covers ALL paths
        locationAcquired = true;
        updateUserLocation(position);
        updateLocationStatus('GPS location active', 'success');
        console.log('Location acquired:', position.coords.accuracy, 'meters accuracy');
        startHighAccuracyWatch();
    };

    const onError = (error) => {
        if (locationAcquired) return;
        console.warn('Location attempt failed:', error);
        // Only show error if all attempts have failed
        handleGeolocationError(error);
    };

    // Step 1: Try fast cached location
    navigator.geolocation.getCurrentPosition(
        onSuccess,
        (error) => {
            if (locationAcquired) return;
            console.warn('Quick location failed, trying high accuracy...', error);
            // Step 2: Try high accuracy
            navigator.geolocation.getCurrentPosition(
                onSuccess,
                onError,
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 5000
                }
            );
        },
        {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 30000
        }
    );
}

// Start High Accuracy Watch (for continuous tracking)
function startHighAccuracyWatch() {
    // Clear existing watch if any
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }

    console.log('[GPS] Starting continuous location tracking...');

    // Watch position with optimized settings for real-time tracking
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            updateUserLocation(position);
            // Log significant updates
            if (position.coords.accuracy < 50) {
                console.log('[GPS] High accuracy update:', Math.round(position.coords.accuracy), 'meters');
            }
        },
        (error) => {
            console.warn('[GPS] Watch error:', error.message);
            // ✅ BUG 3 FIX: watchPosition error does NOT auto-clear the watch
            // Must clear it before restart or watchId check will always be truthy
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            setTimeout(() => {
                console.log('[GPS] Restarting watch after error...');
                startHighAccuracyWatch();
            }, 5000);
        },
        {
            enableHighAccuracy: true,
            timeout: 15000, // Reduced from 20s for faster updates
            maximumAge: 5000 // Reduced from 10s for fresher positions
        }
    );
    
    console.log('[GPS] Watch started with ID:', watchId);
}

// Handle Geolocation Errors
function handleGeolocationError(error) {
    let message = '';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = 'Location access denied. Please enable location or enter address manually.';
            break;
        case error.POSITION_UNAVAILABLE:
            message = 'Location unavailable. Please enter address manually.';
            break;
        case error.TIMEOUT:
            message = 'Location request timeout. Please enter address manually.';
            break;
        default:
            message = 'Unable to get location. Please enter address manually.';
    }
    updateLocationStatus(message, 'error');
    showNotification(message, 'warning');
    
    // Make input editable
    const startInput = document.getElementById('startInput');
    if (startInput) {
        startInput.placeholder = 'Enter your starting location...';
    }
}

// Update Location Status
function updateLocationStatus(message, type = 'info') {
    const statusElement = document.getElementById('locationStatus');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `input-hint ${type}`;
    }
}

// Use My Location Button Handler with Progressive Enhancement
function useMyLocation() {
    const btn = document.getElementById('useLocationBtn');
    const startInput = document.getElementById('startInput');
    
    if (!navigator.geolocation) {
        showNotification('Geolocation is not supported by your browser', 'error');
        updateLocationStatus('Geolocation not supported', 'error');
        return;
    }

    // Show loading state
    btn.classList.add('loading');
    btn.disabled = true;
    updateLocationStatus('Getting your location...', 'info');
    startInput.value = 'Getting location...';
    startInput.disabled = true;

    let locationAcquired = false;

    // Success handler
    const handleLocationSuccess = (position) => {
        if (locationAcquired) return; // Prevent duplicate handling
        locationAcquired = true;

        const { latitude, longitude, heading, accuracy } = position.coords;
        currentPosition = { latitude, longitude };
        usingGPS = true;
        manualStartLocation = null;
        
        // Store heading if available
        if (heading !== null && heading !== undefined) {
            currentHeading = heading;
        }

        // Update input
        startInput.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        startInput.disabled = false;
        
        // Update marker with directional arrow
        if (!userMarker) {
            createDirectionalMarker(latitude, longitude, heading, accuracy);
            map.setView([latitude, longitude], 15);
        } else {
            updateDirectionalMarker(latitude, longitude, heading, accuracy);
            map.setView([latitude, longitude], 15);
        }

        // Remove loading state
        btn.classList.remove('loading');
        btn.disabled = false;
        updateLocationStatus('GPS location active', 'success');
        showNotification('Location acquired successfully', 'success');

        // Start watching position if not already watching
        if (!watchId) {
            startHighAccuracyWatch();
        }
    };

    // Error handler
    const handleLocationError = (error) => {
        if (locationAcquired) return; // Already got location
        
        console.error('Geolocation error:', error);
        btn.classList.remove('loading');
        btn.disabled = false;
        startInput.value = '';
        startInput.disabled = false;
        handleGeolocationError(error);
    };

    // ✅ BUG 10 FIX: Single attempt — clean, no concurrent requests, no battery drain
    const fallbackTimer = setTimeout(() => {
        if (!locationAcquired) {
            handleLocationError({ code: 3, message: 'Location timeout' });
        }
    }, 12000);

    const originalSuccess = handleLocationSuccess;
    const wrappedSuccess = (position) => {
        clearTimeout(fallbackTimer);
        originalSuccess(position);
    };

    navigator.geolocation.getCurrentPosition(
        wrappedSuccess,
        (error) => {
            clearTimeout(fallbackTimer);
            handleLocationError(error);
        },
        {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 10000
        }
    );
}

// Update User Location
let activeRouteLine = null;
let lastTrimIndex = 0;
let travelledLine = null;
function updateUserLocation(position) {
    const { latitude, longitude, heading, accuracy } = position.coords;
    currentPosition = { latitude, longitude };
    updateProximityLocation(latitude, longitude); // ✅ BUG 2 FIX: Feed GPS into proximity detection
    
    console.log('[Location Update]', {
        lat: latitude.toFixed(6),
        lng: longitude.toFixed(6),
        accuracy: Math.round(accuracy) + 'm',
        heading: heading,
        isNavigating: isNavigating
    });
    
    // Update heading if available (from device compass)
    if (heading !== null && heading !== undefined) {
        currentHeading = heading;
    }

    // Only update input if using GPS mode
    if (usingGPS) {
        document.getElementById('startInput').value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }

    // Update or create marker with directional arrow
    if (!userMarker) {
        createDirectionalMarker(latitude, longitude, currentHeading, accuracy);
        
        // Center map on user location
        if (map) {
            map.setView([latitude, longitude], 15);
        }
    } else {
        updateDirectionalMarker(latitude, longitude, currentHeading, accuracy);
        
        // ✅ BUG 3 FIX: Offset user to lower third during navigation (Google Maps style)
        // panTo does NOT support offset — must use project/unproject to shift target point
        if (isNavigating) {
            const mapHeight = map.getSize().y;
            const offsetPixels = mapHeight * 0.25; // Push center up 25% so user is in lower third
            const currentZoom = map.getZoom();
            const targetPoint = map.project([latitude, longitude], currentZoom).subtract([0, offsetPixels]);
            const offsetLatLng = map.unproject(targetPoint, currentZoom);
            map.panTo(offsetLatLng, {
                animate: true,
                duration: 0.5,
                easeLinearity: 0.5
            });
        }
    }

    // ✅ BUG 10 FIX: Only check arrival when GPS is accurate enough to be reliable
    if (isNavigating && selectedRoute && accuracy <= 30) {
        checkArrival(latitude, longitude);
    }

    // ✅ BUG B FIX: Client-side route trimming
    if (isNavigating && selectedRoute && accuracy <= 50) {
        trimRouteFromBehind(latitude, longitude);
    }

    // Check for deviation if navigating
    if (isNavigating && selectedRoute) {
        throttledCheckDeviation(); // ✅ BUG 4 FIX: Throttled — not every GPS tick
    }
}

// Create Directional Marker with Arrow
function createDirectionalMarker(lat, lng, heading, accuracy) {
    const rotation = heading !== null && heading !== undefined ? heading : 0;
    previousPosition = { lat, lng }; // ✅ BUG 6 FIX: Seed previousPosition for bearing calc
    
    // ✅ BUG 6 FIX: Use consistent icon design with circle background
    const icon = L.divIcon({
        className: 'user-location-arrow',
        html: `
            <svg viewBox="0 0 24 24" fill="none" style="transform: rotate(${rotation}deg);
                transition: transform 0.4s ease;
                width: 40px; height: 40px;
                filter: drop-shadow(0 2px 6px rgba(59,130,246,0.5));">
                <circle cx="12" cy="12" r="10"
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3B82F6"
                    stroke-width="1.5"/>
                <path d="M12 5L7 17l5-2.5 5 2.5L12 5z"
                    fill="#3B82F6"
                    stroke="white"
                    stroke-width="1.5"
                    stroke-linejoin="round"/>
            </svg>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    userMarker = L.marker([lat, lng], { icon }).addTo(map);
}

// Calculate bearing between two points (for movement-based heading)
function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    
    return (θ * 180 / Math.PI + 360) % 360; // Convert to degrees and normalize
}

// Update Directional Marker
let previousPosition = null;
function updateDirectionalMarker(lat, lng, heading, accuracy) {
    // Calculate bearing from movement if we have previous position
    let rotation = 0;
    if (previousPosition && (lat !== previousPosition.lat || lng !== previousPosition.lng)) {
        rotation = calculateBearing(previousPosition.lat, previousPosition.lng, lat, lng);
        currentHeading = rotation; // Store calculated heading
    } else if (heading !== null && heading !== undefined) {
        rotation = heading; // Use device compass if available
        currentHeading = heading;
    } else {
        rotation = currentHeading || 0; // Use last known heading
    }
    
    // Store current position for next calculation
    previousPosition = { lat, lng };
    
    // ✅ BUG A FIX: Direct SVG DOM manipulation instead of setIcon()
    const markerElement = userMarker.getElement();
    if (markerElement) {
        const svg = markerElement.querySelector('svg');
        if (svg) {
            svg.style.transform = `rotate(${rotation}deg)`;
        }
    }

    userMarker.setLatLng([lat, lng]);
}

// ✅ BUG B FIX: Find closest point on route to user
function findClosestRoutePointIndex(userLat, userLng, routeCoordinates) {
    let minDistance = Infinity;
    let closestIndex = 0;
    
    // 🔧 FIX: Use detected axis order from selectedRoute
    const isGeoJSON = selectedRoute && selectedRoute._isGeoJSONOrder !== false;
    
    for (let i = 0; i < routeCoordinates.length; i++) {
        const coord = routeCoordinates[i];
        // 🔧 FIX: Extract lat/lng based on detected axis order
        const coordLat = isGeoJSON ? coord[1] : coord[0];
        const coordLng = isGeoJSON ? coord[0] : coord[1];
        const distance = calculateDistance(userLat, userLng, coordLat, coordLng);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }
    
    return closestIndex;
}

// ✅ BUG B & E FIX: Trim route from behind user (client-side)
function trimRouteFromBehind(userLat, userLng) {
    if (!selectedRoute || !selectedRoute.coordinates) return;
    
    const closestIndex = findClosestRoutePointIndex(userLat, userLng, selectedRoute.coordinates);
    
    // ✅ BUG 1 FIX: Only redraw if user has advanced at least 5 waypoints — prevents flicker
    // NOTE: Do NOT set lastTrimIndex before the redraw check
    if (closestIndex <= lastTrimIndex + 5) return;
    
    const remainingCoords = selectedRoute.coordinates.slice(closestIndex);
    const travelledCoords = selectedRoute.coordinates.slice(0, closestIndex + 1);
    
    if (remainingCoords.length < 2) return;
    
    // ✅ Set lastTrimIndex AFTER the guard check, not before
    lastTrimIndex = closestIndex;
    
    // 🔧 FIX: Use detected axis order
    const isGeoJSON = selectedRoute._isGeoJSONOrder !== false;
    const toLatLng = (coord) => isGeoJSON ? [coord[1], coord[0]] : [coord[0], coord[1]];
    
    const remainingLatLngs = remainingCoords.map(toLatLng);
    const travelledLatLngs = travelledCoords.map(toLatLng);
    
    if (activeRouteLine && travelledLine) {
        // ✅ Update existing polylines — no clear/redraw needed, no flicker
        activeRouteLine.setLatLngs(remainingLatLngs);
        travelledLine.setLatLngs(travelledLatLngs);
    } else {
        // First draw — create polyline objects
        routeLayer.clearLayers();
        
        // Grey dashed travelled path
        if (travelledLatLngs.length > 1) {
            travelledLine = L.polyline(travelledLatLngs, {
                color: '#64748B',
                weight: 4,
                opacity: 0.5,
                dashArray: '10, 10',
                lineJoin: 'round',
                lineCap: 'round'
            }).addTo(routeLayer);
        }
        
        // Purple remaining route
        activeRouteLine = L.polyline(remainingLatLngs, {
            color: '#8B5CF6',
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(routeLayer);
        
        // 🔧 FIX: Destination marker uses correct axis too
        const lastCoord = selectedRoute.coordinates[selectedRoute.coordinates.length - 1];
        const destLatLng = isGeoJSON ? [lastCoord[1], lastCoord[0]] : [lastCoord[0], lastCoord[1]];
        const destIcon = L.divIcon({
            className: 'destination-marker',
            html: `<div style="width:30px;height:30px;background:#EF4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        L.marker(destLatLng, { icon: destIcon }).addTo(routeLayer);
    }
}

// ✅ BUG H FIX: Check if user has arrived at destination
function checkArrival(userLat, userLng) {
    if (!selectedRoute || !selectedRoute.coordinates) return;
    
    const destination = selectedRoute.coordinates[selectedRoute.coordinates.length - 1];
    
    // 🔧 FIX: Use detected axis order for destination coordinates
    const isGeoJSON = selectedRoute._isGeoJSONOrder !== false;
    const destLat = isGeoJSON ? destination[1] : destination[0];
    const destLng = isGeoJSON ? destination[0] : destination[1];
    
    const distanceToDestination = calculateDistance(userLat, userLng, destLat, destLng);
    
    // User has arrived if within 30 meters
    if (distanceToDestination <= 30) {
        isNavigating = false;
        showNotification('🎉 You have arrived at your destination!', 'success');
        
        // Play arrival sound
        playArrivalSound();
        
        // ✅ BUG 4 FIX: Keep GPS watch running — user may want to start new navigation
        // Only stop NAVIGATION state, not location tracking itself
        // watchId remains active for proximity alerts and future navigation
        
        // Reset route display
        lastTrimIndex = 0;
        activeRouteLine = null;
        travelledLine = null;
    }
}

// Play arrival sound
function playArrivalSound() {
    try {
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
        const audioContext = sharedAudioContext;
        
        // Play cheerful arrival melody
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
        notes.forEach((freq, i) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = freq;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + i * 0.2);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.2 + 0.3);
            
            oscillator.start(audioContext.currentTime + i * 0.2);
            oscillator.stop(audioContext.currentTime + i * 0.2 + 0.3);
        });
    } catch (error) {
        console.warn('Audio not supported:', error);
    }
}

// Check Deviation from Route
let isRerouting = false;
async function checkDeviation() {
    if (!currentPosition || !selectedRoute || isRerouting) return;

    try {
        const response = await apiCall('/check-deviation', {
            method: 'POST',
            body: JSON.stringify({
                currentLat: currentPosition.latitude,
                currentLng: currentPosition.longitude,
                routeCoordinates: selectedRoute.coordinates,
                threshold: DEVIATION_THRESHOLD
            })
        });

        if (response.data.deviated) {
            // ✅ BUG G FIX: Pause navigation during reroute
            isRerouting = true;
            const wasNavigating = isNavigating;
            isNavigating = false;
            
            showNotification('You have deviated from the route. Recalculating...', 'warning');
            
            try {
                // Trigger reroute
                const destInput = document.getElementById('destInput');
                if (destInput.value) {
                    await findRoutes();
                }
            } catch (rerouteError) {
                console.error('Reroute failed:', rerouteError);
                showNotification('Failed to recalculate route. Continuing with original route.', 'error');
                isNavigating = wasNavigating; // Restore navigation state
            } finally {
                isRerouting = false;
            }
        } else if (response.data.remainingRoute) {
            // Update route to show only remaining path
            updateRemainingRoute(response.data.remainingRoute);
        }
    } catch (error) {
        console.error('Deviation check error:', error);
        isRerouting = false;
    }
}

// Update Remaining Route
function updateRemainingRoute(remainingCoordinates) {
    if (!routeLayer) return;

    routeLayer.clearLayers();
    
    // ✅ BUG 1 FIX: Reset trim state — clearLayers removed the old polyline objects
    activeRouteLine = null;
    travelledLine = null;
    lastTrimIndex = 0;

    const latlngs = remainingCoordinates.map(coord => [coord[1], coord[0]]);
    
    // ✅ Store as activeRouteLine so trimRouteFromBehind can update it later
    activeRouteLine = L.polyline(latlngs, {
        color: '#8B5CF6',
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(routeLayer);

    // Add destination marker
    const lastCoord = remainingCoordinates[remainingCoordinates.length - 1];
    const destIcon = L.divIcon({
        className: 'destination-marker',
        html: `<div style="width:30px;height:30px;background:#EF4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([lastCoord[1], lastCoord[0]], { icon: destIcon }).addTo(routeLayer);
}

// ✅ BUG 5 FIX: Async location picker modal — replaces prompt() which is broken in PWA/WebView
function showLocationPickerModal(options) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;`;
        
        const modal = document.createElement('div');
        modal.style.cssText = `background: #0a0e1a; border: 1px solid rgba(139,92,246,0.4); border-radius: 12px; padding: 24px; max-width: 400px; width: 100%; max-height: 80vh; overflow-y: auto;`;
        
        modal.innerHTML = `
            <h3 style="color: #fff; margin: 0 0 8px; font-size: 16px;">Multiple locations found</h3>
            <p style="color: #94A3B8; font-size: 13px; margin: 0 0 16px;">Select the correct destination:</p>
            ${options.map((opt, i) => `
                <button data-index="${i}" style="display: block; width: 100%; text-align: left; padding: 12px 14px; margin: 0 0 8px; background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.25); border-radius: 8px; color: #fff; cursor: pointer; font-size: 13px; line-height: 1.4;">
                    ${opt.address}
                </button>
            `).join('')}
            <button id="cancelLocationPick" style="margin-top: 8px; color: #64748B; background: none; border: none; cursor: pointer; font-size: 13px; width: 100%; padding: 8px;">Cancel</button>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        modal.querySelectorAll('button[data-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.remove();
                resolve(options[parseInt(btn.dataset.index)]);
            });
        });
        
        const cancelBtn = document.getElementById('cancelLocationPick');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                overlay.remove();
                resolve(null);
            });
        }
    });
}

// Find Routes
async function findRoutes() {
    const startInput = document.getElementById('startInput');
    const destInput = document.getElementById('destInput');
    const startValue = startInput.value.trim();
    const destValue = destInput.value.trim();

    if (!destValue) {
        showNotification('Please enter a destination', 'error');
        return;
    }

    showLoading(true);

    try {
        let startLat, startLng;

        // Determine start location - prioritize manual input over GPS
        if (startValue && !startValue.includes('Getting location')) {
            // User has entered a manual address - use it regardless of GPS status
            // Check if it's coordinates format (lat, lng)
            const coordMatch = startValue.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            
            if (coordMatch) {
                // Direct coordinates provided
                startLat = parseFloat(coordMatch[1]);
                startLng = parseFloat(coordMatch[2]);
                console.log('Using coordinate input:', startLat, startLng);
            } else {
                // Address string - geocode it
                try {
                    const startGeocodeResponse = await apiCall('/geocode', {
                        method: 'POST',
                        body: JSON.stringify({ address: startValue })
                    });
                    const startLocation = startGeocodeResponse.data;
                    startLat = startLocation.latitude;
                    startLng = startLocation.longitude;
                    console.log('Geocoded start address:', startValue, '->', startLat, startLng);
                    
                    // Update manual start location
                    manualStartLocation = { latitude: startLat, longitude: startLng };
                    usingGPS = false; // Explicitly disable GPS mode
                    
                    // Update marker for manual location
                    if (!userMarker) {
                        const icon = L.divIcon({
                            className: 'user-location-marker',
                            html: `<div style="width: 20px; height: 20px; background: #F59E0B; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>`,
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        userMarker = L.marker([startLat, startLng], { icon }).addTo(map);
                    } else {
                        userMarker.setLatLng([startLat, startLng]);
                    }
                    map.setView([startLat, startLng], 14);
                } catch (error) {
                    showNotification('Could not find starting location. Please check the address.', 'error');
                    showLoading(false);
                    return;
                }
            }
        } else if (usingGPS && currentPosition) {
            // No manual input - use GPS location
            startLat = currentPosition.latitude;
            startLng = currentPosition.longitude;
            console.log('Using GPS location:', startLat, startLng);
        } else {
            showNotification('Please enter a starting location or use GPS', 'error');
            showLoading(false);
            return;
        }

        // STEP 2: Check if user picked from autocomplete — use exact coords
        let destination;
        
        // Check if user already picked from autocomplete — use those exact coords
        const storedLat = parseFloat(destInput.dataset.lat);
        const storedLng = parseFloat(destInput.dataset.lng);
        
        if (!isNaN(storedLat) && !isNaN(storedLng)) {
            // ✅ User picked from dropdown — skip geocoding entirely
            // These coords came directly from the autocomplete API and are exact
            console.log('[DEST] Using autocomplete coords — skipping geocoder:', storedLat, storedLng);
            destination = {
                latitude: storedLat,
                longitude: storedLng,
                address: destValue
            };
        } else {
            // User typed manually without picking — must geocode
            console.log('[DEST] No stored coords — geocoding manually typed address');
            
            const geocodeResponse = await apiCall('/geocode', {
                method: 'POST',
                body: JSON.stringify({ address: destValue, returnMultiple: true })
            });

            const results = Array.isArray(geocodeResponse.data) ? geocodeResponse.data : [geocodeResponse.data];
            
            console.log('Geocoding results:', results);

            // If we got multiple results, let user choose
            if (results.length > 1) {
                // Filter out vague results (just city/state)
                const specificResults = results.filter(r => {
                    const addr = r.address.toLowerCase();
                    const type = r.type ? r.type.toLowerCase() : '';
                    
                    // Reject if it's just a city, state, or country
                    if (type === 'city' || type === 'state' || type === 'country' || type === 'administrative') {
                        return false;
                    }
                    
                    // Reject if address is too short (likely just city name)
                    if (addr.split(',').length < 3) {
                        return false;
                    }
                    
                    return true;
                });

                if (specificResults.length === 0) {
                    showNotification('Location too vague. Please enter a more specific address (e.g., include road name, landmark, or area)', 'error');
                    showLoading(false);
                    return;
                }

                destination = await showLocationPickerModal(specificResults);
                if (!destination) {
                    showLoading(false);
                    return;
                }
            } else {
                destination = results[0];
                
                // Check if result is too vague
                const type = destination.type ? destination.type.toLowerCase() : '';
                const addrParts = destination.address.split(',');
                
                if (type === 'city' || type === 'state' || type === 'country' || type === 'administrative' || addrParts.length < 3) {
                    showNotification('Location too vague. Please enter a more specific address with road name, landmark, or area.', 'error');
                    showLoading(false);
                    return;
                }
            }

            console.log('Selected destination:', destination);
        }

        // Calculate distance
        const distance = calculateDistanceKm(
            startLat,
            startLng,
            destination.latitude,
            destination.longitude
        );

        // Check if distance is within limits
        if (distance > MAX_ROUTE_DISTANCE_KM) {
            showNotification(
                `Destination is too far (${distance.toFixed(1)}km). Walking routes are limited to ${MAX_ROUTE_DISTANCE_KM}km. Please choose a closer location.`,
                'error'
            );
            showLoading(false);
            return;
        }

        // Warn if distance is very long
        if (distance > 50) {
            showNotification(
                `Long distance route: ${distance.toFixed(1)}km. This may take a while to calculate.`,
                'warning'
            );
        }

        console.log('=== SENDING ROUTE REQUEST ===');
        console.log('Start:', { lat: startLat, lng: startLng, address: startValue });
        console.log('End:', { lat: destination.latitude, lng: destination.longitude, address: destValue });
        console.log('Travel mode:', travelMode);
        console.log('============================');

        // Store intended destination for validation
        const intendedDestination = {
            latitude: destination.latitude,
            longitude: destination.longitude,
            address: destination.address
        };

        // Get routes
        const routesResponse = await apiCall('/routes', {
            method: 'POST',
            body: JSON.stringify({
                startLat: startLat,
                startLng: startLng,
                endLat: destination.latitude,
                endLng: destination.longitude,
                travelMode: travelMode, // Pass selected travel mode
                startAddress: startValue || `${startLat.toFixed(5)}, ${startLng.toFixed(5)}`,
                endAddress: destValue
            })
        });

        console.log('Routes response:', routesResponse);

        // Validate response structure
        if (!routesResponse || !routesResponse.data) {
            throw new Error('Invalid response from server');
        }

        if (!routesResponse.data.routes || !Array.isArray(routesResponse.data.routes)) {
            throw new Error('No routes found in response');
        }

        // CRITICAL VALIDATION: Verify routes actually go to intended destination
        routes = routesResponse.data.routes; // ✅ Assign to GLOBAL routes, not const
        let validRoutes = [];
        
        for (const route of routes) {
            if (!route.coordinates || route.coordinates.length === 0) {
                console.warn('Route has no coordinates, skipping');
                continue;
            }
            
            // 🔧 FIX: Detect coordinate order from the route's START point, not the end point.
            // We know startLat and startLng exactly. Check both [0] and [1] of the first coordinate
            // to determine which axis order this backend uses. This self-calibrates automatically.
            const firstCoord = route.coordinates[0];
            const lastCoord = route.coordinates[route.coordinates.length - 1];

            // 🔧 FIX: Test BOTH possible orderings against the known start point.
            // GeoJSON standard: coord = [lng, lat] → lat=coord[1], lng=coord[0]
            // Some backends: coord = [lat, lng] → lat=coord[0], lng=coord[1]
            const distIfGeoJSON = calculateDistanceKm(
                firstCoord[1], firstCoord[0],  // treating as [lng, lat]
                startLat, startLng
            );
            const distIfSwapped = calculateDistanceKm(
                firstCoord[0], firstCoord[1],  // treating as [lat, lng]
                startLat, startLng
            );

            // 🔧 FIX: Whichever interpretation puts the route START near our known start point
            // is the correct axis order. Use that same order for the END point check.
            const isGeoJSONOrder = distIfGeoJSON <= distIfSwapped;

            console.log(`Route ${route.id} axis detection:`, {
                firstCoord,
                distIfGeoJSON: distIfGeoJSON.toFixed(3) + ' km',
                distIfSwapped: distIfSwapped.toFixed(3) + ' km',
                isGeoJSONOrder,
                detectedOrder: isGeoJSONOrder ? '[lng, lat]' : '[lat, lng]'
            });

            // 🔧 FIX: Now extract route end using the DETECTED correct axis order
            let routeEndLat, routeEndLng;
            if (isGeoJSONOrder) {
                // Standard GeoJSON: [lng, lat]
                routeEndLat = lastCoord[1];
                routeEndLng = lastCoord[0];
            } else {
                // Swapped backend: [lat, lng]
                routeEndLat = lastCoord[0];
                routeEndLng = lastCoord[1];
            }
            
            // Calculate distance between route end and intended destination
            const endPointDistance = calculateDistanceKm(
                routeEndLat,
                routeEndLng,
                intendedDestination.latitude,
                intendedDestination.longitude
            );
            
            console.log(`Route ${route.id} end validation:`, {
                routeEnd: { lat: routeEndLat, lng: routeEndLng },
                intendedDest: { lat: intendedDestination.latitude, lng: intendedDestination.longitude },
                distanceKm: endPointDistance.toFixed(3)
            });

            // 🔧 FIX: Attach detected axis order to route object so drawRoute() uses it correctly
            route._isGeoJSONOrder = isGeoJSONOrder;
            
            // Route must end within 500 meters of intended destination
            if (endPointDistance > 0.5) {
                console.error(`Route ${route.id} rejected — ends ${endPointDistance.toFixed(2)}km from destination`);
                continue; // Skip this invalid route
            }
            
            validRoutes.push(route);
        }
        
        // If NO routes go to the correct destination, STOP
        if (validRoutes.length === 0) {
            console.error('CRITICAL ERROR: No routes found that go to the intended destination!');
            console.error('Intended destination:', intendedDestination);
            console.error('All routes were rejected for not reaching the destination');
            
            showNotification(
                'ERROR: Routes found do not go to your intended destination. This may be due to:\n\n' +
                '1. Location name is ambiguous\n2. Routing service error\n3. No roads connect to exact location\n\n' +
                'Please try:\n• More specific address\n• Nearby landmark\n• Different location',
                'error'
            );
            showLoading(false);
            return;
        }
        
        // Warn user if some routes were rejected
        if (validRoutes.length < routes.length) {
            const rejectedCount = routes.length - validRoutes.length;
            console.warn(`${rejectedCount} route(s) rejected for not reaching intended destination`);
            showNotification(
                `${rejectedCount} route(s) filtered out for not reaching your exact destination. Showing ${validRoutes.length} valid route(s).`,
                'warning'
            );
        }
        
        // Use only valid routes
        routesResponse.data.routes = validRoutes;
        routes = validRoutes; // ✅ Sync back to global routes array

        const dangerZones = routesResponse.data.dangerZones || [];

        console.log('Routes received:', validRoutes.length);
        console.log('First route:', validRoutes[0]);
        console.log('AI Insights:', validRoutes[0]?.aiInsights);
        console.log('Navigation Guidance:', validRoutes[0]?.navigationGuidance);

        // Additional validation: routes must have coordinates
        validRoutes = validRoutes.filter(route => 
            route && route.coordinates && Array.isArray(route.coordinates) && route.coordinates.length > 0
        );
        routes = validRoutes; // ✅ BUG 3 FIX: Re-sync global after second filter pass

        if (validRoutes.length === 0) {
            throw new Error('No valid routes with coordinates found');
        }

        // Display routes
        displayRoutes(validRoutes);

        // Display danger zones
        displayDangerZones(dangerZones);

        // Auto-select recommended route
        if (routes.length > 0) {
            selectRoute(0);
        }

        showNotification(`Found ${routes.length} route${routes.length > 1 ? 's' : ''}`, 'success');
    } catch (error) {
        console.error('Route finding error:', error);
        
        // Show clear error message
        let errorMessage = error.message || 'Failed to find routes';
        showNotification(errorMessage, 'error');
    } finally {
        showLoading(false);
    }
}

// Calculate distance in kilometers
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in kilometers
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in kilometers
}

// Throttle function for performance optimization
function throttle(func, delay) {
    let lastCall = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            return func.apply(this, args);
        }
    };
}

// ✅ BUG 4 FIX: Throttled deviation check — max once every 10 seconds
const throttledCheckDeviation = throttle(checkDeviation, 10000);

// Debounce function for input optimization
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}
// Display Routes
function displayRoutes(routesList) {
    const routesSection = document.getElementById('routesSection');
    const routesListElement = document.getElementById('routesList');
    const routeCount = document.getElementById('routeCount');

    routesSection.style.display = 'block';
    routeCount.textContent = `${routesList.length} route${routesList.length > 1 ? 's' : ''}`;

    routesListElement.innerHTML = routesList.map((route, index) => `
        <div class="route-card ${route.recommended ? 'recommended' : ''}" data-index="${index}">
            <div class="route-header">
                <div class="route-title">Route ${index + 1}</div>
                <div class="risk-badge ${route.risk.riskLevel}">${route.risk.riskLevel}</div>
            </div>
            <div class="route-stats">
                <div class="route-stat">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M9 11a3 3 0 106 0 3 3 0 00-6 0z" stroke="currentColor" stroke-width="2"/>
                        <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    ${route.distanceKm} km
                </div>
                <div class="route-stat">
                    <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                        <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    ${route.durationDisplay || route.durationMin + ' min'}
                </div>
                <div class="route-stat">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    Risk: ${route.risk.totalRisk}
                </div>
            </div>
        </div>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.route-card').forEach(card => {
        card.addEventListener('click', () => {
            const index = parseInt(card.dataset.index);
            selectRoute(index);
        });
    });
}

// Select Route
function selectRoute(index) {
    selectedRoute = routes[index];
    
    // ✅ BUG 2 FIX: Reset trim state so new route draws from scratch
    lastTrimIndex = 0;
    activeRouteLine = null;
    travelledLine = null;

    // Update UI
    document.querySelectorAll('.route-card').forEach((card, i) => {
        card.classList.toggle('selected', i === index);
    });

    // Draw route on map
    drawRoute(selectedRoute);

    // ✅ BUG 4 FIX: Zoom to USER position at street level, not route center
    setTimeout(() => {
        if (map && isNavigating && currentPosition) {
            map.setView(
                [currentPosition.latitude, currentPosition.longitude],
                17,
                { animate: true }
            );
        }
    }, 1000);

    // Show intelligence panel
    showIntelligencePanel(selectedRoute);

    // Start navigation
    isNavigating = true;

    // Save to history
    saveRouteToHistory(selectedRoute);
}

// Draw Route on Map
function drawRoute(route) {
    if (!routeLayer) {
        console.error('Route layer not initialized');
        return;
    }

    if (!route) {
        console.error('No route provided to drawRoute');
        return;
    }

    if (!route.coordinates || !Array.isArray(route.coordinates) || route.coordinates.length === 0) {
        console.error('Route has no valid coordinates:', route);
        showNotification('Route data is invalid', 'error');
        return;
    }

    routeLayer.clearLayers();

    try {
        // 🔧 FIX: Use the axis order detected during route validation in findRoutes()
        // If _isGeoJSONOrder is true → coords are [lng, lat] → Leaflet needs [coord[1], coord[0]]
        // If _isGeoJSONOrder is false → coords are [lat, lng] → Leaflet needs [coord[0], coord[1]]
        const isGeoJSON = route._isGeoJSONOrder !== false; // default to GeoJSON if not set

        const latlngs = route.coordinates.map(coord => {
            if (!Array.isArray(coord) || coord.length < 2) {
                console.warn('Invalid coordinate:', coord);
                return null;
            }
            // 🔧 FIX: Apply correct axis extraction based on detected order
            return isGeoJSON ? [coord[1], coord[0]] : [coord[0], coord[1]];
        }).filter(coord => coord !== null);

        if (latlngs.length === 0) {
            throw new Error('No valid coordinates to draw');
        }

        // Draw route line
        const routeLine = L.polyline(latlngs, {
            color: '#8B5CF6',
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(routeLayer);

        // Add destination marker
        const lastCoord = route.coordinates[route.coordinates.length - 1];
        if (Array.isArray(lastCoord) && lastCoord.length >= 2) {
            // 🔧 FIX: Same axis correction for destination marker
            const destLatLng = isGeoJSON 
                ? [lastCoord[1], lastCoord[0]] 
                : [lastCoord[0], lastCoord[1]];

            const destIcon = L.divIcon({
                className: 'destination-marker',
                html: `<div style="width: 30px; height: 30px; background: #EF4444; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            L.marker(destLatLng, { icon: destIcon }).addTo(routeLayer);
        }

        // Fit map to route
        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    } catch (error) {
        console.error('Error drawing route:', error);
        showNotification('Failed to display route on map', 'error');
    }
}

// Display Danger Zones with performance optimization
function displayDangerZones(zones) {
    allDangerZones = zones || []; // ✅ Store zones for proximity checking
    if (!dangerZoneLayer) return;

    dangerZoneLayer.clearLayers();

    // Performance optimization: Limit number of zones displayed at once
    const MAX_ZONES_DISPLAY = 100;
    const zonesToDisplay = zones.slice(0, MAX_ZONES_DISPLAY);
    
    if (zones.length > MAX_ZONES_DISPLAY) {
        console.log(`Displaying ${MAX_ZONES_DISPLAY} of ${zones.length} danger zones for performance`);
    }

    // ✅ BUG 13 FIX: Removed unused fragment variable

    zonesToDisplay.forEach(zone => {
        // Determine color based on severity - DARKER COLORS
        const severityKey = zone.severity || 'medium';
        const color = {
            safe: '#059669',      // Darker green
            low: '#2563EB',       // Darker blue
            medium: '#D97706',    // Darker orange
            high: '#DC2626',      // Darker red
            critical: '#991B1B'   // Very dark red
        }[severityKey] || '#475569';

        // Different styling for verified vs user-reported zones
        const isVerified = zone.type === 'verified';
        const fillOpacity = isVerified ? 0.45 : 0.35; // Increased opacity for darker appearance
        const weight = isVerified ? 3 : 2;

        // Draw circle
        const circle = L.circle([zone.latitude, zone.longitude], {
            radius: zone.radius || zone.radius_meters || 200, // ✅ BUG 7 FIX: Normalize field names
            color: color,
            fillColor: color,
            fillOpacity: fillOpacity,
            weight: weight,
            opacity: 1.0, // Increased from 0.9/0.8 for darker borders
            className: isVerified ? 'verified-danger-zone' : 'user-danger-zone'
        }).addTo(dangerZoneLayer);

        // Create popup content - lazy load to improve initial render
        circle.on('click', function() {
            const popupContent = `
                <div style="padding: 8px; font-family: Inter, sans-serif; min-width: 200px;">
                    ${isVerified ? `
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                            <svg viewBox="0 0 24 24" fill="none" style="width: 16px; height: 16px; color: #10B981;">
                                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/>
                            </svg>
                            <span style="font-size: 11px; color: #10B981; font-weight: 600; text-transform: uppercase;">Verified Zone</span>
                        </div>
                    ` : ''}
                    <div style="font-weight: 700; margin-bottom: 4px; text-transform: capitalize; color: #0A0E1A;">
                        ${zone.placeName || zone.category.replace(/_/g, ' ')}
                    </div>
                    <div style="font-size: 12px; color: #64748B; margin-bottom: 8px;">
                        ${zone.description || 'No description'}
                    </div>
                    <div style="font-size: 11px; color: #94A3B8;">
                        <div style="margin-bottom: 4px;">
                            <span style="font-weight: 600;">Risk:</span> 
                            <span style="color: ${color}; font-weight: 600; text-transform: capitalize;">${severityKey}</span>
                        </div>
                        ${zone.activeHours ? `
                            <div style="margin-bottom: 4px;">
                                <span style="font-weight: 600;">Active Hours:</span> ${zone.activeHours}
                            </div>
                        ` : ''}
                        ${zone.reportCount ? `
                            <div style="margin-bottom: 4px;">
                                <span style="font-weight: 600;">Reports:</span> ${zone.reportCount}
                            </div>
                        ` : ''}
                        ${zone.source ? `
                            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #E5E7EB; font-size: 10px; color: #9CA3AF;">
                                Source: ${zone.source}
                            </div>
                        ` : ''}
                        ${zone.lastReported ? `
                            <div style="margin-top: 4px;">
                                <span style="font-weight: 600;">Last:</span> ${new Date(zone.lastReported).toLocaleDateString()}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            circle.bindPopup(popupContent).openPopup();
        });
    });
}

// Show Intelligence Panel
function showIntelligencePanel(route) {
    const panel = document.getElementById('intelligencePanel');
    const content = document.getElementById('panelContent');

    const risk = route.risk;
    const riskColor = {
        safe: '#10B981',
        low: '#3B82F6',
        medium: '#F59E0B',
        high: '#EF4444',
        critical: '#DC2626'
    }[risk.riskLevel] || '#64748B';

    let aiInsightsHTML = '';
    if (route.aiInsights && route.aiInsights.success) {
        const insights = route.aiInsights;
        
        // Clean up analysis text - remove any markdown formatting
        let analysisText = insights.analysis || '';
        analysisText = analysisText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
        
        // If analysis still looks like JSON, try to extract meaningful text
        if (analysisText.startsWith('{') || analysisText.startsWith('[')) {
            analysisText = 'Route analysis completed. See details below.';
        }
        
        aiInsightsHTML = `
            <div class="ai-insights-section">
                <div class="ai-header">
                    <svg viewBox="0 0 24 24" fill="none" style="width: 20px; height: 20px; color: #8B5CF6;">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    <h4>AI Route Analysis</h4>
                </div>
                <p class="ai-summary">${analysisText}</p>
                
                ${insights.keyInsights && insights.keyInsights.length > 0 ? `
                    <div class="ai-insights-list">
                        <h5>📌 Key Insights</h5>
                        ${insights.keyInsights.map((insight, index) => `
                            <div class="insight-item">
                                <span class="insight-number">${index + 1}</span>
                                <span class="insight-text">${insight}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                ${insights.safetyTips && insights.safetyTips.length > 0 ? `
                    <div class="safety-tips-list">
                        <h5>🛡️ Safety Tips</h5>
                        ${insights.safetyTips.map((tip, index) => `
                            <div class="safety-tip-item">
                                <span class="tip-number">${index + 1}</span>
                                <span class="tip-text">${tip}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                ${insights.timeRecommendations ? `
                    <div class="time-recommendations">
                        <h5>⏰ Best Time to Travel</h5>
                        <p>${insights.timeRecommendations}</p>
                    </div>
                ` : ''}
                
                ${insights.alternativeConsiderations ? `
                    <div class="alternative-considerations">
                        <h5>🔄 Alternative Route Considerations</h5>
                        <p>${insights.alternativeConsiderations}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }

    let navigationHTML = '';
    if (route.navigationGuidance && route.navigationGuidance.success && route.navigationGuidance.steps && route.navigationGuidance.steps.length > 0) {
        navigationHTML = `
            <div class="navigation-guidance-section">
                <div class="nav-header">
                    <svg viewBox="0 0 24 24" fill="none" style="width: 20px; height: 20px; color: #3B82F6;">
                        <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <h4>Step-by-Step Guidance</h4>
                </div>
                <div class="navigation-steps">
                    ${route.navigationGuidance.steps.map((step, index) => `
                        <div class="nav-step ${index === 0 ? 'nav-step-first' : ''} ${index === route.navigationGuidance.steps.length - 1 ? 'nav-step-last' : ''}">
                            <div class="nav-step-number">${step.stepNumber || index + 1}</div>
                            <div class="nav-step-content">
                                <div class="nav-step-instruction">${step.instruction}</div>
                                <div class="nav-step-meta">
                                    <span class="nav-distance">📍 ${step.distance}</span>
                                    ${step.estimatedTime ? `<span class="nav-time">⏱️ ${step.estimatedTime}</span>` : ''}
                                </div>
                                ${step.safetyNote ? `
                                    <div class="nav-step-safety">
                                        <svg viewBox="0 0 24 24" fill="none" style="width: 14px; height: 14px; color: #F59E0B; flex-shrink: 0;">
                                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2"/>
                                        </svg>
                                        <span>${step.safetyNote}</span>
                                    </div>
                                ` : ''}
                                ${step.landmark ? `
                                    <div class="nav-step-landmark">
                                        <svg viewBox="0 0 24 24" fill="none" style="width: 14px; height: 14px; color: #8B5CF6;">
                                            <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke="currentColor" stroke-width="2"/>
                                            <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" stroke-width="2"/>
                                        </svg>
                                        <span>${step.landmark}</span>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    content.innerHTML = `
        <div class="risk-summary">
            <div class="risk-score">
                <div class="risk-score-value" style="color: ${riskColor};">${risk.totalRisk}</div>
                <div>
                    <div style="font-weight: 600; font-size: 14px;">${risk.riskLevel.toUpperCase()} RISK</div>
                    <div style="font-size: 12px; color: #64748B;">${route.distanceKm} km • ${route.durationDisplay || route.durationMin + ' min'}</div>
                </div>
            </div>
            ${risk.riskFactors.length > 0 ? `
                <div class="risk-factors">
                    ${risk.riskFactors.map(factor => `
                        <div class="risk-factor">
                            <svg viewBox="0 0 24 24" fill="none">
                                <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/>
                            </svg>
                            ${factor}
                        </div>
                    `).join('')}
                </div>
            ` : '<div style="color: #10B981; font-size: 13px;">✓ No significant risk factors detected</div>'}
        </div>
        
        ${aiInsightsHTML}
        
        ${navigationHTML}
        
        ${risk.affectedZones.length > 0 ? `
            <div class="affected-zones">
                <h4>Affected Zones</h4>
                ${risk.affectedZones.map(zone => `
                    <div class="zone-item">
                        <div class="zone-item-header">
                            <span class="zone-category">${zone.category}</span>
                            <span class="risk-badge ${zone.severity}">${zone.severity}</span>
                        </div>
                        <div class="zone-description">${zone.description || 'No description'}</div>
                        <div style="font-size: 11px; color: #64748B; margin-top: 4px;">
                            ${zone.distance}m away${zone.reportCount ? ` • ${zone.reportCount} report${zone.reportCount > 1 ? 's' : ''}` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;

    panel.style.display = 'block';
}

// Save Route to History
async function saveRouteToHistory(route) {
    try {
        const startInput = document.getElementById('startInput').value;
        const destInput = document.getElementById('destInput').value;
        
        // Determine start coordinates
        let startLat, startLng;
        if (usingGPS && currentPosition) {
            startLat = currentPosition.latitude;
            startLng = currentPosition.longitude;
        } else if (manualStartLocation) {
            startLat = manualStartLocation.latitude;
            startLng = manualStartLocation.longitude;
        } else {
            // Fallback to current position if available
            if (currentPosition) {
                startLat = currentPosition.latitude;
                startLng = currentPosition.longitude;
            } else {
                console.warn('No start location available for history');
                return;
            }
        }

        await apiCall('/history', {
            method: 'POST',
            body: JSON.stringify({
                startLat: startLat,
                startLng: startLng,
                endLat: route.coordinates[route.coordinates.length - 1][1],
                endLng: route.coordinates[route.coordinates.length - 1][0],
                startAddress: startInput,
                endAddress: destInput,
                selectedRoute: route.id,
                riskScore: route.risk.totalRisk,
                distance: route.distance,
                duration: route.duration
            })
        });
    } catch (error) {
        console.error('Failed to save route history:', error);
    }
}

// Load Route History
async function loadRouteHistory() {
    // Check if user is authenticated first
    const token = getToken();
    if (!token) {
        console.log('No token found, skipping history load');
        return;
    }

    try {
        const response = await apiCall('/history');
        const history = response?.data?.history || []; // ✅ BUG 9 FIX: Safe access with fallback

        const historyList = document.getElementById('historyList');

        if (history.length === 0) {
            historyList.innerHTML = '<p class="empty-state">No recent routes</p>';
            return;
        }

        historyList.innerHTML = history.slice(0, 5).map(item => `
            <div class="history-item">
                <div class="history-item-title">${item.endAddress || 'Unknown destination'}</div>
                <div class="history-item-meta">
                    ${(item.distance / 1000).toFixed(2)} km • Risk: ${item.riskScore} • ${new Date(item.createdAt).toLocaleDateString()}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load history:', error);
        // Don't redirect on history load failure
    }
}

// Load All Verified Danger Zones on Map
async function loadAllDangerZones() {
    if (!map || !dangerZoneLayer) {
        console.warn('Map or danger zone layer not initialized');
        return;
    }

    try {
        console.log('Loading all verified danger zones...');
        
        // Fetch all verified danger zones
        const response = await apiCall('/danger-zones/all');
        
        if (response && response.data && response.data.zones) {
            const zones = response.data.zones;
            console.log(`Loaded ${zones.length} verified danger zones`);
            
            // Display zones on map
            displayDangerZones(zones);
            
            showNotification(`Loaded ${zones.length} verified danger zones`, 'success');
        } else {
            console.warn('No danger zones returned from API');
        }
    } catch (error) {
        console.error('Failed to load danger zones:', error);
        // Don't show error to user, zones will load when routes are calculated
    }
}

// Show Loading
function showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

// Show Notification with queue management to prevent spam
let notificationQueue = [];
let isShowingNotification = false;

function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Add to queue
    notificationQueue.push({ message, type });
    
    // Process queue if not already showing
    if (!isShowingNotification) {
        processNotificationQueue();
    }
}

function processNotificationQueue() {
    if (notificationQueue.length === 0) {
        isShowingNotification = false;
        return;
    }
    
    isShowingNotification = true;
    const { message, type } = notificationQueue.shift();
    
    const colors = {
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6'
    };

    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 84px;
        right: 20px;
        padding: 16px 20px;
        background: rgba(10, 14, 26, 0.98);
        border: 1px solid ${colors[type]};
        border-radius: 8px;
        color: white;
        font-size: 14px;
        z-index: 3000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        backdrop-filter: blur(20px);
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            notification.remove();
            processNotificationQueue(); // Process next in queue
        }, 300);
    }, 3000);
}

// Add CSS animations for notifications
if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}


// Setup Location Autocomplete with API
function setupLocationAutocomplete() {
    // Setup autocomplete for destination input
    setupAutocompleteForInput('destInput');
    
    // Setup autocomplete for start input
    setupAutocompleteForInput('startInput');
}

function setupAutocompleteForInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.id = `${inputId}Suggestions`;
    suggestionsDiv.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: rgba(10, 14, 26, 0.98);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-top: none;
        border-radius: 0 0 8px 8px;
        max-height: 400px;
        overflow-y: auto;
        z-index: 1000;
        display: none;
        backdrop-filter: blur(20px);
    `;
    
    // Make parent relative for positioning
    const parent = input.closest('.input-with-button') || input.parentElement;
    parent.style.position = 'relative';
    parent.appendChild(suggestionsDiv);

    let inputAutocompleteTimeout = null;

    input.addEventListener('input', async (e) => {
        // STEP 1: Clear stored coords when user types manually (prevents stale coords)
        input.dataset.lat = '';
        input.dataset.lng = '';
        
        const query = e.target.value.trim();
        
        // If this is start input and user is typing, disable GPS mode
        if (inputId === 'startInput' && query.length > 0 && !query.includes('Getting location')) {
            usingGPS = false;
            updateLocationStatus('Manual input mode', 'info');
        }
        
        // Clear previous timeout
        if (inputAutocompleteTimeout) {
            clearTimeout(inputAutocompleteTimeout);
        }
        
        if (query.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }

        // Show loading
        suggestionsDiv.innerHTML = '<div style="padding: 12px 16px; color: #94A3B8;">Searching...</div>';
        suggestionsDiv.style.display = 'block';

        // Debounce API calls
        inputAutocompleteTimeout = setTimeout(async () => {
            try {
                const response = await apiCall(`/autocomplete?query=${encodeURIComponent(query)}&limit=10`);
                const suggestions = response.data.suggestions || [];

                if (suggestions.length === 0) {
                    suggestionsDiv.innerHTML = '<div style="padding: 12px 16px; color: #94A3B8;">No locations found</div>';
                    return;
                }

                suggestionsDiv.innerHTML = suggestions.map(loc => `
                    <div class="location-suggestion" 
                         data-address="${loc.address.replace(/"/g, '&quot;')}"
                         data-lat="${loc.latitude}"
                         data-lng="${loc.longitude}"
                         style="
                        padding: 12px 16px;
                        cursor: pointer;
                        border-bottom: 1px solid rgba(139, 92, 246, 0.1);
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(139, 92, 246, 0.1)'" 
                       onmouseout="this.style.background='transparent'">
                        <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">${loc.name}</div>
                        <div style="font-size: 12px; color: #94A3B8;">
                            <span style="text-transform: capitalize; color: #8B5CF6;">${loc.type || loc.category}</span> • ${loc.address}
                        </div>
                    </div>
                `).join('');

                // Add click handlers
                suggestionsDiv.querySelectorAll('.location-suggestion').forEach(item => {
                    item.addEventListener('click', () => {
                        input.value = item.dataset.address;
                        input.dataset.lat = item.dataset.lat;
                        input.dataset.lng = item.dataset.lng;
                        suggestionsDiv.style.display = 'none';
                        
                        // If this is start input, mark as manual entry
                        if (inputId === 'startInput') {
                            usingGPS = false;
                            updateLocationStatus('Manual location selected', 'success');
                        }
                    });
                });

            } catch (error) {
                console.error('Autocomplete error:', error);
                suggestionsDiv.innerHTML = '<div style="padding: 12px 16px; color: #EF4444;">Failed to load suggestions</div>';
            }
        }, DEBOUNCE_DELAY); // Use constant for consistency
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
        }
    });
}

// Event Listeners
const findRoutesBtn = document.getElementById('findRoutesBtn');
if (findRoutesBtn) {
    findRoutesBtn.addEventListener('click', findRoutes);
}

const useLocationBtn = document.getElementById('useLocationBtn');
if (useLocationBtn) {
    useLocationBtn.addEventListener('click', useMyLocation);
}

// Theme toggle buttons
const brightThemeBtn = document.getElementById('brightThemeBtn');
if (brightThemeBtn) {
    brightThemeBtn.addEventListener('click', () => {
        toggleMapTheme('bright');
    });
}

const darkThemeBtn = document.getElementById('darkThemeBtn');
if (darkThemeBtn) {
    darkThemeBtn.addEventListener('click', () => {
        toggleMapTheme('dark');
    });
}

// Travel mode selection
document.querySelectorAll('.travel-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons
        document.querySelectorAll('.travel-mode-btn').forEach(b => b.classList.remove('active'));
        
        // Add active class to clicked button
        btn.classList.add('active');
        
        // Update travel mode
        travelMode = btn.dataset.mode;
        
        // Update hint text
        const modeNames = {
            'foot-walking': 'Walking mode selected',
            'cycling-regular': 'Cycling mode selected',
            'driving-car': 'Driving mode selected'
        };
        
        const travelModeHint = document.getElementById('travelModeHint');
        if (travelModeHint) {
            travelModeHint.textContent = modeNames[travelMode];
        }
        
        const btnText = btn.querySelector('span');
        if (btnText) {
            showNotification(`Travel mode changed to ${btnText.textContent}`, 'success');
        }
    });
});

// Set default active mode
const defaultModeBtn = document.querySelector('.travel-mode-btn[data-mode="foot-walking"]');
if (defaultModeBtn) {
    defaultModeBtn.classList.add('active');
}

// ✅ BUG 5 FIX: Removed duplicate startInput listener — setupAutocompleteForInput already handles this

const startInput = document.getElementById('startInput');
if (startInput) {
    startInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            findRoutes();
        }
    });
}

const destInput = document.getElementById('destInput');
if (destInput) {
    destInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            findRoutes();
        }
    });
}

const locateBtn = document.getElementById('locateBtn');
if (locateBtn) {
    locateBtn.addEventListener('click', () => {
        if (currentPosition && userMarker) {
            map.setView([currentPosition.latitude, currentPosition.longitude], 15);
        }
    });
}

const reportBtn = document.getElementById('reportBtn');
if (reportBtn) {
    reportBtn.addEventListener('click', () => {
        const reportModal = document.getElementById('reportModal');
        if (reportModal) {
            reportModal.style.display = 'flex';
        }
    });
}

const closeReportModal = document.getElementById('closeReportModal');
if (closeReportModal) {
    closeReportModal.addEventListener('click', () => {
        const reportModal = document.getElementById('reportModal');
        if (reportModal) {
            reportModal.style.display = 'none';
        }
    });
}

const submitReportBtn = document.getElementById('submitReportBtn');
if (submitReportBtn) {
    submitReportBtn.addEventListener('click', async () => {
        if (!currentPosition) {
            showNotification('Location not available', 'error');
            return;
        }

        const reportSeverity = document.getElementById('reportSeverity');
        const reportCategory = document.getElementById('reportCategory');
        const reportDescription = document.getElementById('reportDescription');
        
        if (!reportSeverity || !reportCategory || !reportDescription) {
            showNotification('Report form elements not found', 'error');
            return;
        }

        const severity = reportSeverity.value;
        const category = reportCategory.value;
        const description = reportDescription.value.trim();

        try {
            await apiCall('/danger-zones', {
                method: 'POST',
                body: JSON.stringify({
                    latitude: currentPosition.latitude,
                    longitude: currentPosition.longitude,
                    severity,
                    category,
                    description
                })
            });

            showNotification('Danger zone reported successfully', 'success');
            const reportModal = document.getElementById('reportModal');
            if (reportModal) {
                reportModal.style.display = 'none';
            }
            if (reportDescription) {
                reportDescription.value = '';
            }
        } catch (error) {
            showNotification(error.message || 'Failed to report danger zone', 'error');
        }
    });
}

const closePanel = document.getElementById('closePanel');
if (closePanel) {
    closePanel.addEventListener('click', () => {
        const intelligencePanel = document.getElementById('intelligencePanel');
        if (intelligencePanel) {
            intelligencePanel.style.display = 'none';
        }
    });
}

const menuBtn = document.getElementById('menuBtn');
if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.add('active');
        }
    });
}

const closeSidebar = document.getElementById('closeSidebar');
if (closeSidebar) {
    closeSidebar.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.remove('active');
        }
    });
}

// Clear old cache entries
function clearOldCache() {
    const now = Date.now();
    let cleared = 0;
    
    for (const [key, value] of geocodeCache.entries()) {
        const cacheDuration = key.includes('/autocomplete') ? AUTOCOMPLETE_CACHE_DURATION : CACHE_DURATION;
        if (now - value.timestamp > cacheDuration) {
            geocodeCache.delete(key);
            cleared++;
        }
    }
    
    if (cleared > 0) {
        console.log(`Cleared ${cleared} old cache entries`);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing SafeTrace...');
    
    // Clear old cache entries on page load
    clearOldCache();
    setInterval(clearOldCache, 60 * 1000); // ✅ BUG 9 FIX: Evict stale cache entries every 60s
    
    // Check authentication
    const token = getToken();
    if (!token) {
        console.error('No authentication token found');
        
        // Show error in map container
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #94A3B8;">
                    <svg viewBox="0 0 24 24" fill="none" style="width: 64px; height: 64px; margin-bottom: 16px; color: #EF4444;">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="2"/>
                        <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <h3 style="font-size: 20px; margin-bottom: 8px; color: #fff;">Authentication Required</h3>
                    <p style="margin-bottom: 24px;">Please login to use SafeTrace</p>
                    <a href="/onboarding.html" style="padding: 12px 24px; background: linear-gradient(135deg, #8B5CF6, #06B6D4); color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
                        Go to Login
                    </a>
                </div>
            `;
        }
        return;
    }
    
    // Check if map container exists
    const mapContainer = document.getElementById('map');
    if (!mapContainer) {
        console.error('Map container not found!');
        return;
    }
    
    console.log('Map container found, initializing map...');
    initMap();
    loadRouteHistory();
    loadAllDangerZones(); // Load verified danger zones on map
    setupLocationAutocomplete();
    startProximityMonitoring(); // ✅ BUG 8 FIX: Start backup interval for proximity checks
    
    // ✅ BUG 1 FIX: Removed duplicate startLocationTracking() call
    // initMap() already calls it internally - calling twice creates zombie watcher
    
    // Mobile-specific enhancements
    if (window.innerWidth <= 768) {
        initMobileEnhancements();
    }
});

// Mobile Enhancements
function initMobileEnhancements() {
    console.log('Initializing mobile enhancements...');
    
    // Bottom sheet for intelligence panel
    setupBottomSheet();
    
    // Swipeable route cards
    setupSwipeableRoutes();
    
    // Pull to refresh
    setupPullToRefresh();
    
    // Haptic feedback simulation
    setupHapticFeedback();
    
    // Gesture controls
    setupGestureControls();
}

// Bottom Sheet Intelligence Panel
function setupBottomSheet() {
    const panel = document.getElementById('intelligencePanel');
    if (!panel) return;
    
    const header = panel.querySelector('.panel-header');
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    
    header.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        panel.style.transition = 'none';
    });
    
    header.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        
        if (diff > 0) {
            panel.style.transform = `translateY(${diff}px)`;
        }
    });
    
    header.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        panel.style.transition = 'transform 0.3s ease';
        
        const diff = currentY - startY;
        if (diff > 100) {
            panel.classList.add('minimized');
            panel.style.transform = '';
        } else if (diff < -50) {
            panel.classList.remove('minimized');
            panel.style.transform = '';
        } else {
            panel.style.transform = '';
        }
    });
    
    // Tap to toggle
    header.addEventListener('click', () => {
        panel.classList.toggle('minimized');
    });
}

// Swipeable Route Cards
function setupSwipeableRoutes() {
    const routesList = document.getElementById('routesList');
    if (!routesList) return;
    
    let isScrolling = false;
    let startX = 0;
    let scrollLeft = 0;
    
    routesList.addEventListener('touchstart', (e) => {
        isScrolling = true;
        startX = e.touches[0].pageX - routesList.offsetLeft;
        scrollLeft = routesList.scrollLeft;
    });
    
    routesList.addEventListener('touchmove', (e) => {
        if (!isScrolling) return;
        e.preventDefault();
        const x = e.touches[0].pageX - routesList.offsetLeft;
        const walk = (x - startX) * 2;
        routesList.scrollLeft = scrollLeft - walk;
    }, { passive: false }); // ✅ BUG 18 FIX: Must be non-passive to allow preventDefault
    
    routesList.addEventListener('touchend', () => {
        isScrolling = false;
    });
    
    // Snap to nearest card
    routesList.addEventListener('scroll', debounce(() => {
        const cards = routesList.querySelectorAll('.route-card');
        const scrollPosition = routesList.scrollLeft;
        const cardWidth = cards[0]?.offsetWidth || 0;
        const gap = 12;
        const nearestIndex = Math.round(scrollPosition / (cardWidth + gap));
        
        if (cards[nearestIndex]) {
            cards[nearestIndex].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }
    }, 100));
}

// Pull to Refresh
function setupPullToRefresh() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    
    let startY = 0;
    let isPulling = false;
    let refreshNotificationShown = false; // ✅ BUG 5 FIX: Only show once per pull gesture
    
    sidebar.addEventListener('touchstart', (e) => {
        if (sidebar.scrollTop === 0) {
            startY = e.touches[0].clientY;
            isPulling = true;
        }
    });
    
    sidebar.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        
        if (diff > 80 && sidebar.scrollTop === 0 && !refreshNotificationShown) {
            refreshNotificationShown = true; // ✅ Show only once
            showNotification('Release to refresh', 'info');
        }
    });
    
    sidebar.addEventListener('touchend', (e) => {
        if (!isPulling) return;
        isPulling = false;
        refreshNotificationShown = false; // ✅ Reset for next pull gesture
        
        const currentY = e.changedTouches[0].clientY;
        const diff = currentY - startY;
        
        if (diff > 80 && sidebar.scrollTop === 0) {
            loadRouteHistory();
            showNotification('Refreshed', 'success');
        }
    });
}

// Haptic Feedback Simulation
function setupHapticFeedback() {
    // Vibrate on button press (if supported)
    const buttons = document.querySelectorAll('.btn-primary, .control-btn, .route-card, .quick-action-btn');
    
    buttons.forEach(button => {
        button.addEventListener('touchstart', () => {
            if ('vibrate' in navigator) {
                navigator.vibrate(10); // 10ms vibration
            }
        }, { passive: true }); // Mark as passive for better performance
    });
}

// Gesture Controls
function setupGestureControls() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    
    let touchStartX = 0;
    let touchStartY = 0;
    
    mapContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true }); // Mark as passive
    
    mapContainer.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        
        // Swipe from left edge to open sidebar
        if (touchStartX < 50 && diffX > 100 && Math.abs(diffY) < 50) {
            document.getElementById('sidebar').classList.add('active');
        }
        
        // Swipe from right to close sidebar
        if (touchStartX > window.innerWidth - 50 && diffX < -100 && Math.abs(diffY) < 50) {
            document.getElementById('sidebar').classList.remove('active');
        }
    }, { passive: true }); // Mark as passive
}

// ✅ BUG 12 FIX: Removed duplicate debounce definition (first one is correct)

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
    // ✅ BUG 15 FIX: Removed updateTimer cleanup (variable never assigned)
});


// ═══════════════════════════════════════════════════════════════════════════
// DANGER ZONE PROXIMITY DETECTION & ALERTS
// ═══════════════════════════════════════════════════════════════════════════

let allDangerZones = [];
let userCurrentLocation = null;
let proximityCheckInterval = null;
let alertedZones = new Set(); // Track which zones we've already alerted for

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
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

// Check if user is near any danger zones
function checkDangerZoneProximity() {
    if (!userCurrentLocation || allDangerZones.length === 0) return;

    const { lat, lng } = userCurrentLocation;
    const alertThreshold = 500;

    // ✅ BUG 16 & 17 FIX: Sort by severity so critical zones always alert first
    const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, safe: 1 };
    const sortedZones = [...allDangerZones].sort((a, b) =>
        (severityOrder[b.risk_level || b.severity] || 0) - (severityOrder[a.risk_level || a.severity] || 0)
    );

    for (const zone of sortedZones) {
        const distance = calculateDistance(lat, lng, zone.latitude, zone.longitude);
        const zoneRadius = zone.radius_meters || zone.radius || 200;
        
        // ✅ BUG 17 FIX: Use compound key so undefined id doesn't collapse all zones
        const zoneKey = zone.id ?? `${zone.latitude}-${zone.longitude}-${zone.category}`;
        
        if (distance <= (zoneRadius + alertThreshold)) {
            if (!alertedZones.has(zoneKey)) {
                alertedZones.add(zoneKey);
                showDangerZoneAlert(zone, distance);
                break; // ✅ Safe to break — highest severity is now first
            }
        } else if (distance > (zoneRadius + alertThreshold + 200)) {
            alertedZones.delete(zoneKey); // Allow re-alert if user returns
        }
    }
}

// Show danger zone alert modal
function showDangerZoneAlert(zone, distance) {
    const modal = document.getElementById('dangerZoneAlertModal');
    if (!modal) return;

    // Populate modal with zone information
    document.getElementById('dangerZoneName').textContent = zone.place_name || zone.placeName || 'Unknown Location';
    
    // Risk level badge
    const riskBadge = document.getElementById('dangerZoneRiskBadge');
    const riskLevel = (zone.risk_level || zone.riskLevel || 'medium').toLowerCase();
    riskBadge.textContent = riskLevel.toUpperCase();
    riskBadge.className = `risk-badge ${riskLevel}`;
    
    // Category
    const categoryMap = {
        'vehicular_fatality_zone': 'Vehicular Fatality Zone',
        'freight_collision_zone': 'Freight Collision Zone',
        'pedestrian_accident_zone': 'Pedestrian Accident Zone',
        'crime_hotspot': 'Crime Hotspot',
        'theft': 'Theft Area',
        'harassment': 'Harassment Zone',
        'general': 'General Danger'
    };
    document.getElementById('dangerZoneCategory').textContent = categoryMap[zone.category] || zone.category || 'General';
    
    // Distance
    const distanceText = distance < 1000 
        ? `${Math.round(distance)} meters away`
        : `${(distance / 1000).toFixed(1)} km away`;
    document.getElementById('dangerZoneDistance').textContent = distanceText;
    
    // Description
    document.getElementById('dangerZoneDescription').textContent = 
        zone.description || 'This area has been identified as a high-risk zone. Exercise caution when traveling through this area.';
    
    // Active hours
    document.getElementById('dangerZoneActiveHours').textContent = 
        zone.active_hours || zone.activeHours || '24/7';
    
    // Update recommendations based on risk level
    const recommendations = document.getElementById('dangerZoneRecommendations');
    let recommendationsList = [];
    
    if (riskLevel === 'critical') {
        recommendationsList = [
            '🚨 Avoid this area if possible - find an alternative route',
            '📱 Keep emergency contacts readily accessible',
            '👥 Travel in groups if you must pass through',
            '🚗 Use a vehicle instead of walking',
            '⚡ Stay on main roads and avoid shortcuts'
        ];
    } else if (riskLevel === 'high') {
        recommendationsList = [
            '⚠️ Exercise extreme caution in this area',
            '👀 Stay alert and aware of your surroundings',
            '📱 Keep your phone charged and accessible',
            '🌙 Avoid traveling through this area at night',
            '👥 Consider traveling with others'
        ];
    } else if (riskLevel === 'medium') {
        recommendationsList = [
            '👀 Stay alert and aware of your surroundings',
            '💡 Stick to well-lit and populated areas',
            '📱 Keep your phone accessible',
            '🚶 Avoid isolated areas and shortcuts'
        ];
    } else {
        recommendationsList = [
            '👀 Stay aware of your surroundings',
            '💡 Stick to main roads when possible',
            '📱 Keep your phone accessible',
            '🚶 Exercise normal caution'
        ];
    }
    
    recommendations.innerHTML = recommendationsList.map(rec => `<li>${rec}</li>`).join('');
    
    // Update alert title based on distance
    const alertTitle = document.getElementById('dangerZoneAlertTitle');
    const alertSubtitle = document.getElementById('dangerZoneAlertSubtitle');
    
    const zoneRadius = zone.radius_meters || zone.radius || 200; // ✅ BUG 7 FIX: Normalized
    if (distance < zoneRadius) {
        alertTitle.textContent = '🚨 You Are In A Danger Zone';
        alertSubtitle.textContent = 'Exercise extreme caution';
    } else if (distance < 200) {
        alertTitle.textContent = '⚠️ Danger Zone Ahead';
        alertSubtitle.textContent = 'You are approaching a high-risk area';
    } else {
        alertTitle.textContent = '⚠️ Danger Zone Nearby';
        alertSubtitle.textContent = 'A high-risk area is in your vicinity';
    }
    
    // Show modal
    modal.style.display = 'flex';
    
    // Play alert sound (optional)
    playAlertSound();
}

// Play loud alert sound for danger zones
function playAlertSound() {
    try {
        // ✅ BUG 11 FIX: Reuse shared AudioContext
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
        const audioContext = sharedAudioContext;
        
        // Create a more urgent, louder alert sound
        // Play three beeps in succession
        const times = [0, 0.3, 0.6]; // Three beeps
        
        times.forEach((startTime) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Higher frequency for urgency
            oscillator.frequency.value = 1200;
            oscillator.type = 'square'; // Square wave for more piercing sound
            
            // Louder volume
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + startTime + 0.2);
            
            oscillator.start(audioContext.currentTime + startTime);
            oscillator.stop(audioContext.currentTime + startTime + 0.2);
        });
        
        // Add a final longer beep for emphasis
        setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 1000;
            oscillator.type = 'square';
            
            gainNode.gain.setValueAtTime(0.6, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        }, 800);
        
    } catch (error) {
        // Silently fail if audio not supported
        console.warn('Audio alert not supported:', error);
    }
}

// Close danger zone alert
document.getElementById('closeDangerZoneAlert')?.addEventListener('click', () => {
    document.getElementById('dangerZoneAlertModal').style.display = 'none';
});

document.getElementById('continueAnyway')?.addEventListener('click', () => {
    document.getElementById('dangerZoneAlertModal').style.display = 'none';
});

document.getElementById('viewAlternativeRoute')?.addEventListener('click', () => {
    document.getElementById('dangerZoneAlertModal').style.display = 'none';
    if (routes && routes.length > 1) {
        // ✅ BUG 6 FIX: Use actual risk data instead of undefined dangerZoneCount
        const severityScore = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
        const safestRoute = routes.reduce((prev, current) => {
            const prevScore = severityScore[prev.risk?.riskLevel] ?? 99;
            const currScore = severityScore[current.risk?.riskLevel] ?? 99;
            return prevScore <= currScore ? prev : current;
        });
        selectRoute(routes.indexOf(safestRoute));
        showNotification('Switched to safer route', 'success');
    } else {
        showNotification('No alternative routes available', 'info');
    }
});

// Start proximity monitoring when user location is available
function startProximityMonitoring() {
    if (proximityCheckInterval) {
        clearInterval(proximityCheckInterval);
    }
    
    // Check every 10 seconds
    proximityCheckInterval = setInterval(checkDangerZoneProximity, 10000);
    
    // Also check immediately
    checkDangerZoneProximity();
}

// Update proximity location and check danger zones
function updateProximityLocation(lat, lng) {
    userCurrentLocation = { lat, lng };
    checkDangerZoneProximity();
}

// ✅ Removed monkey-patch - allDangerZones now stored directly in displayDangerZones()

// ✅ Removed zombie watchPosition - location tracking handled by startHighAccuracyWatch()
