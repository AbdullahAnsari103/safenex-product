/**
 * trackme.js — Track Me Client Logic (Page-Level UI Controller) v2
 * ─────────────────────────────────────────────────────────────────
 * This file controls the UI on the /trackme page ONLY.
 * All actual tracking (GPS pings, state persistence, SW) is handled
 * by trackme-bg.js which runs on every page.
 *
 * Communication with trackme-bg.js goes through window.tmBg:
 *   window.tmBg.start(sessionId, startTime, reToken) — begin tracking
 *   window.tmBg.stop()                               — stop + returns old sessionId
 *   window.tmBg.isActive()                           — true if currently tracking
 *   window.tmBg.getSessionId()                       — current session ID
 *   window.tmBg.getPings()                           — cumulative ping count
 *   window.tmBg.getStartTime()                       — ISO start time (server value)
 *
 * Callbacks set by this page on window:
 *   window.tmBgPingCallback(pings, lat, lng)  — on each successful ping
 *   window.tmBgConnLostCallback()             — on network failure
 *   window.tmBgResumedCallback(session)       — when server reports resumed session
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = '/api/trackme';

// ─── Device ID (stable per-browser fingerprint) ───────────────────────────────
function getDeviceId() {
    let did = localStorage.getItem('tm_device_id');
    if (!did) {
        did = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('tm_device_id', did);
    }
    return did;
}

// ─── Auth Helper ──────────────────────────────────────────────────────────────
function getToken() {
    return localStorage.getItem('snx_token') || localStorage.getItem('token');
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function apiCall(endpoint, options = {}) {
    const token = getToken();
    if (!token) {
        window.location.href = '/onboarding.html';
        throw new Error('No token');
    }
    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    });
    const data = await res.json();
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
            window.location.href = '/onboarding.html';
        }
        throw new Error(data?.message || 'Request failed');
    }
    return data;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'info') {
    const el = document.getElementById('tmToast');
    if (!el) return;
    el.textContent = msg;
    el.className = `tm-toast show ${type}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = 'tm-toast'; }, 4000);
}

// ─── Map ──────────────────────────────────────────────────────────────────────
let map = null;
let userMarker = null;

function initMap() {
    try {
        map = L.map('tmMap', {
            zoomControl: false,
            attributionControl: false,
            dragging: true,
            scrollWheelZoom: false,
        }).setView([19.076, 72.8777], 14);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors, © CARTO',
        }).addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);
        setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    } catch (e) {
        console.error('Map init error:', e);
    }
}

function updateMapPin(lat, lng) {
    if (!map) return;

    const pinIcon = L.divIcon({
        className: '',
        html: `<div class="tm-user-pin"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });

    if (!userMarker) {
        userMarker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
        map.setView([lat, lng], 15);
    } else {
        userMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng], { animate: true, duration: 0.5 });
    }

    reverseGeocode(lat, lng);
    const upd = document.getElementById('mapUpdated');
    if (upd) upd.textContent = 'LAST UPDATED: JUST NOW';
}

// ─── Reverse Geocode ──────────────────────────────────────────────────────────
let _geocodeTimer = null;
function reverseGeocode(lat, lng) {
    clearTimeout(_geocodeTimer);
    _geocodeTimer = setTimeout(async () => {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
                { headers: { 'Accept-Language': 'en' } }
            );
            const data = await res.json();
            const label = data?.address?.suburb || data?.address?.neighbourhood ||
                          data?.address?.city_district || data?.address?.town ||
                          data?.address?.city || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            const el = document.getElementById('mapLocationLabel');
            if (el) el.textContent = label;
            const addr = document.getElementById('tmCurrentAddress');
            if (addr) {
                const full = data?.display_name
                    ? data.display_name.split(',').slice(0, 3).join(', ')
                    : label;
                addr.textContent = `You are currently at: ${full}`;
            }
        } catch (e) {
            const el = document.getElementById('mapLocationLabel');
            if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }, 1000);
}

// ─── Duration Timer ───────────────────────────────────────────────────────────
// Always reads from server-provided start time → shows TOTAL duration including
// any time the browser was closed.
let _durationTimer = null;

function startDurationTimer() {
    const stored = window.tmBg?.getStartTime();
    const startMs = stored ? new Date(stored).getTime() : Date.now();

    _durationTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
        const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        const el = document.getElementById('sessionDuration');
        if (el) el.textContent = `${h}:${m}:${s}`;
    }, 1000);
}

function stopDurationTimer() {
    clearInterval(_durationTimer);
    _durationTimer = null;
    const el = document.getElementById('sessionDuration');
    if (el) el.textContent = '00:00:00';
}

// ─── Callbacks registered with trackme-bg.js ─────────────────────────────────

// Called on every successful ping
window.tmBgPingCallback = function (pings, lat, lng) {
    const pingEl = document.getElementById('pingCount');
    if (pingEl) pingEl.textContent = `${pings} Sent`;
    if (lat && lng) updateMapPin(lat, lng);

    const connLost = document.getElementById('connLost');
    if (connLost) connLost.hidden = true;
};

// Called when a network failure happens mid-tracking
window.tmBgConnLostCallback = function () {
    const connLost = document.getElementById('connLost');
    if (connLost) connLost.hidden = false;
};

// Called when trackme-bg.js detects the server has an ACTIVE session
// that the client wasn't aware of (i.e. app was closed and reopened)
window.tmBgResumedCallback = function (session) {
    setTrackingUI(true);

    const pingEl = document.getElementById('pingCount');
    if (pingEl) pingEl.textContent = `${session.pingCount || 0} Sent`;

    startDurationTimer();

    if (session.lastLat && session.lastLng) {
        updateMapPin(session.lastLat, session.lastLng);
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => updateMapPin(pos.coords.latitude, pos.coords.longitude),
            () => {},
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
        );
    }

    showToast('📍 Tracking resumed. You were monitored while the app was closed.', 'success');
};

// ─── Start Tracking ───────────────────────────────────────────────────────────
async function startTracking() {
    const permErr = document.getElementById('permError');
    if (permErr) permErr.hidden = true;

    if (!navigator.geolocation) {
        showPermError('Geolocation is not supported by your browser.');
        return;
    }

    // Check for iOS Safari — give friendly message about background limitations
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isIOS && isSafari) {
        showToast('💡 For continuous tracking on iOS, keep SafeNex open. You can lock your screen and tracking will continue.', 'info');
    }

    // ── Step 1: Toggle switches green (immediate visual feedback)
    const toggleBtn = document.getElementById('trackToggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-checked', 'true');

    // ── Step 2: Show loading indicator while GPS permission is requested
    setTrackingUI('loading');

    let initialPosition;
    try {
        initialPosition = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            });
        });
    } catch (err) {
        setTrackingUI(false);
        let msg = 'Please enable location access in your browser settings to use Track Me.';
        if (err.code === 1) msg = 'Location access denied. Please enable location in your browser settings.';
        if (err.code === 3) msg = 'Location request timed out. Please check your connection and try again.';
        showPermError(msg);
        return;
    }

    // ── Start backend session (server creates ACTIVE record)
    let sessionId, startTime, reconnectToken;
    try {
        const res = await apiCall('/start', {
            method: 'POST',
            body: JSON.stringify({ deviceId: getDeviceId() }),
        });
        sessionId = res.data.sessionId;
        startTime = res.data.startTime;
        reconnectToken = res.data.reconnectToken;
    } catch (e) {
        setTrackingUI(false);
        showToast('Failed to start tracking session. Please try again.', 'error');
        return;
    }

    // ── Hand off to the bg layer (handles SW, localStorage, GPS watch, pings)
    window.tmBg.start(sessionId, startTime, reconnectToken);

    // ── Step 3: Map fade-in + stats slide-down
    setTrackingUI(true);

    // ── Update map with initial position immediately
    const { latitude: lat, longitude: lng } = initialPosition.coords;
    updateMapPin(lat, lng);

    // Start page-local duration timer (reads server start_time from localStorage)
    startDurationTimer();

    // ── Request notification permission for persistent tracking notification
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }

    showToast('✅ Tracking started. Authorities can now see your location.', 'success');

    // ── Step 4: Generate Share Link & Notify Contacts (WhatsApp)
    // Read toggle ONCE at the moment tracking starts — this is the source of truth
    const shareWithContacts = document.getElementById('shareContactsToggle')?.checked || false;

    try {
        const linkRes = await apiCall('/generate-link', {
            method: 'POST',
            body: JSON.stringify({ sessionId, shareWithContacts })
        });

        if (linkRes.success && linkRes.data) {
            const { shareableLink, waUrls, contactCount } = linkRes.data;

            // Show share UI
            document.getElementById('tmShareSection').hidden = false;

            // Display URL only if it looks like a real deployed domain
            const lnk = shareableLink || '';
            const isLocalhost = lnk.includes('localhost') || lnk.includes('127.0.0.1');
            const input = document.getElementById('tmShareInput');
            if (input) {
                input.value = isLocalhost ? '' : lnk;
                input.placeholder = isLocalhost ? 'Link active (local session)' : lnk;
            }

            // WhatsApp share button — always show when link is active
            const waBtn = document.getElementById('tmWhatsappBtn');
            if (waBtn && waUrls && waUrls.length > 0) {
                waBtn.hidden = false;
                waBtn.onclick = () => {
                    openWhatsAppLink(waUrls[0]);
                };
            }

            // Automatically open WhatsApp on mobile or desktop if shareWithContacts is ON
            if (shareWithContacts && waUrls && waUrls.length > 0) {
                showToast('📲 Launching WhatsApp with your live tracking link...', 'success');
                setTimeout(() => {
                    openWhatsAppLink(waUrls[0]);
                }, 300);
            } else if (!shareWithContacts) {
                const bannerText = document.getElementById('tmShareBannerText');
                if (bannerText) bannerText.textContent = 'Tracking link active. Contacts will not be notified automatically.';
            }
        }
    } catch (e) {
        console.error('Failed to generate tracking link:', e);
        // Don't fail the whole tracking session if link generation fails
    }
}

// ─── Stop Tracking ────────────────────────────────────────────────────────────
async function stopTracking() {
    const pings     = window.tmBg?.getPings() || 0;
    const startISO  = window.tmBg?.getStartTime();
    const sessionId = window.tmBg?.getSessionId();

    // Tell bg layer to stop (clears localStorage, kills watchPosition + timer, notifies SW)
    window.tmBg.stop();
    stopDurationTimer();

    // Tell server — this is the ONLY valid way to set tracking_status = 'INACTIVE'
    if (sessionId) {
        // Read toggle at stop time — use the same toggle state
        const shareWithContacts = document.getElementById('shareContactsToggle')?.checked || false;

        try {
            await apiCall('/stop', {
                method: 'POST',
                body: JSON.stringify({ sessionId, endedNormally: true }),
            });

            // ── Step 5: Expire Share Link & Notify Contacts (ONLY if toggle is ON)
            const expRes = await apiCall('/expire-link', {
                method: 'POST',
                body: JSON.stringify({ startTime: startISO, pingCount: pings, shareWithContacts })
            });

            if (shareWithContacts && expRes.success && expRes.data?.waUrls?.length > 0) {
                const { waUrls } = expRes.data;
                waUrls.forEach((url, i) => {
                    setTimeout(() => { window.open(url, '_blank'); }, i * 300);
                });
                // Small delay to ensure tabs open before UI resets
                await new Promise(r => setTimeout(r, waUrls.length * 300));
            }
        } catch (e) {
            console.error('Stop session/expire link error:', e);
        }
    }

    showSessionSummary(startISO, pings);
}

// ─── Session Summary Card ─────────────────────────────────────────────────────
function showSessionSummary(startISO, pings) {
    let duration = '—';
    if (startISO) {
        const secs = Math.floor((Date.now() - new Date(startISO).getTime()) / 1000);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        duration = `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
    }

    const card = document.getElementById('sessionSummaryCard');
    if (!card) {
        setTrackingUI(false);
        showToast('Tracking stopped. You were monitored safely for this session.', 'info');
        return;
    }

    document.getElementById('sumDuration').textContent = duration;
    document.getElementById('sumPings').textContent = pings;

    card.hidden = false;
    card.classList.add('visible');

    setTimeout(() => {
        card.classList.remove('visible');
        setTimeout(() => {
            card.hidden = true;
            setTrackingUI(false);
            showToast('Tracking stopped. Emergency contacts notified.', 'info');
        }, 400);
    }, 4000);
}

// ─── UI State ─────────────────────────────────────────────────────────────────
function setTrackingUI(state) {
    const toggleBtn   = document.getElementById('trackToggle');
    const toggleCard  = document.getElementById('toggleCard');
    const statusText  = document.getElementById('statusText');
    const statusSub   = document.getElementById('statusSub');
    const statsRow    = document.getElementById('sessionStats');
    const stopWrap    = document.getElementById('stopWrap');
    const authBadge   = document.getElementById('authoritiesBadge');
    const mapSection  = document.getElementById('tmMapSection');
    const loadingEl   = document.getElementById('tmLoadingBar');
    const connLost    = document.getElementById('connLost');
    const bgInfo      = document.getElementById('tmBgInfo');
    const ambientGlow = document.getElementById('tmAmbientGlow');
    const shareSec    = document.getElementById('tmShareSection');

    if (state === 'loading') {
        if (toggleBtn) toggleBtn.setAttribute('aria-checked', 'true');
        if (toggleCard) toggleCard.classList.add('is-loading');
        if (statusText) statusText.textContent = 'Getting your location…';
        if (statusSub)  statusSub.textContent  = 'Requesting GPS permission…';
        if (loadingEl)  loadingEl.hidden = false;
        return;
    }

    if (loadingEl)  loadingEl.hidden = true;
    if (toggleCard) toggleCard.classList.remove('is-loading');

    if (state === true) {
        if (toggleBtn) toggleBtn.setAttribute('aria-checked', 'true');
        if (toggleCard) toggleCard.classList.add('is-live');
        if (ambientGlow) ambientGlow.classList.add('is-live');
        if (statusText) statusText.textContent = 'Tracking is LIVE';
        if (statusSub)  statusSub.textContent  = 'Authorities are monitoring your safety.';
        if (authBadge) { authBadge.textContent = 'ACTIVE'; authBadge.classList.add('active'); }
        if (statsRow)   statsRow.hidden  = false;
        if (stopWrap)   stopWrap.hidden  = false;
        if (mapSection) { mapSection.classList.add('map-visible'); setTimeout(() => { if (map) map.invalidateSize(); }, 350); }
        if (connLost)   connLost.hidden  = true;
        if (bgInfo)     bgInfo.hidden    = false; // "Tracking continues even when app is closed"
    } else {
        if (toggleBtn) toggleBtn.setAttribute('aria-checked', 'false');
        if (toggleCard) toggleCard.classList.remove('is-live');
        if (ambientGlow) ambientGlow.classList.remove('is-live');
        if (statusText) statusText.textContent = 'Tracking is OFF';
        if (statusSub)  statusSub.textContent  = 'Authorities cannot see your location.';
        if (authBadge) { authBadge.textContent = 'INACTIVE'; authBadge.classList.remove('active'); }
        if (statsRow)   statsRow.hidden  = true;
        if (stopWrap)   stopWrap.hidden  = true;
        if (mapSection) mapSection.classList.remove('map-visible');
        if (connLost)   connLost.hidden  = true;
        if (bgInfo)     bgInfo.hidden    = true;
        if (shareSec)   shareSec.hidden  = true;
        if (userMarker && map) { map.removeLayer(userMarker); userMarker = null; }
    }
}

// ─── Permission Error ─────────────────────────────────────────────────────────
function showPermError(msg) {
    const el  = document.getElementById('permError');
    const txt = document.getElementById('permErrorText');
    if (txt) txt.textContent = msg;
    if (el)  el.hidden = false;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function initEventListeners() {
    document.getElementById('backBtn')?.addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    document.getElementById('infoBtn')?.addEventListener('click', () => {
        document.getElementById('infoModal').hidden = false;
    });

    document.getElementById('closeInfoBtn')?.addEventListener('click', () => {
        document.getElementById('infoModal').hidden = true;
    });

    // Main toggle
    document.getElementById('trackToggle')?.addEventListener('click', async () => {
        if (window.tmBg.isActive()) {
            document.getElementById('stopModal').hidden = false;
        } else {
            await startTracking();
        }
    });

    // Stop button
    document.getElementById('stopBtn')?.addEventListener('click', () => {
        document.getElementById('stopModal').hidden = false;
    });

    // Confirm stop
    document.getElementById('confirmStopBtn')?.addEventListener('click', async () => {
        document.getElementById('stopModal').hidden = true;
        await stopTracking();
    });

    // Keep tracking
    document.getElementById('keepTrackingBtn')?.addEventListener('click', () => {
        document.getElementById('stopModal').hidden = true;
    });

    // Modal backdrops
    document.getElementById('stopModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) document.getElementById('stopModal').hidden = true;
    });

    document.getElementById('infoModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) document.getElementById('infoModal').hidden = true;
    });

    // Copy Share Link
    document.getElementById('tmCopyBtn')?.addEventListener('click', () => {
        const input = document.getElementById('tmShareInput');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value)
                .then(() => showToast('Link copied to clipboard', 'success'))
                .catch(() => showToast('Failed to copy', 'error'));
        }
    });

    // Contacts toggle — update the hint text live when flipped
    document.getElementById('shareContactsToggle')?.addEventListener('change', (e) => {
        updateContactsToggleHint(e.target.checked);
    });
}

// ─── WhatsApp Mobile & Desktop Launcher ──────────────────────────────────────
function openWhatsAppLink(url) {
    if (!url) return;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isCapacitor = !!window.Capacitor;

    // Ensure wa.me format for mobile deep linking
    let targetUrl = url;
    if (targetUrl.includes('api.whatsapp.com/send')) {
        targetUrl = targetUrl.replace('https://api.whatsapp.com/send?phone=', 'https://wa.me/')
                             .replace('https://api.whatsapp.com/send', 'https://wa.me/')
                             .replace('&text=', '?text=');
    }

    if (isMobile || isCapacitor) {
        try {
            window.location.href = targetUrl;
        } catch (_) {
            window.open(targetUrl, '_system');
        }
    } else {
        const win = window.open(targetUrl, '_blank');
        if (!win) {
            window.location.href = targetUrl;
        }
    }
}

// ─── Update contacts hint text ────────────────────────────────────────────────
function updateContactsToggleHint(isOn) {
    const hint = document.getElementById('contactsHint');
    if (!hint) return;
    if (isOn) {
        hint.textContent = 'Contacts will receive your live location link';
        hint.classList.add('is-on');
    } else {
        hint.textContent = 'Emergency contacts will not be notified';
        hint.classList.remove('is-on');
    }
}

// ─── Auth Guard & Init ────────────────────────────────────────────────────────
async function init() {
    if (!getToken()) {
        window.location.href = '/onboarding.html';
        return;
    }

    initEventListeners();
    initMap();

    // trackme-bg.js already ran checkServerStatus() in boot() which may have:
    //   a) set tmBgResumedCallback (for auto-resumed sessions) 
    //   b) called bgResumeTracking() + injectBadge()
    // We just need to sync the UI here.

    const isTracking = window.tmBg.isActive();

    if (isTracking) {
        setTrackingUI(true);

        const pings = window.tmBg.getPings();
        const pingEl = document.getElementById('pingCount');
        if (pingEl) pingEl.textContent = `${pings} Sent`;

        startDurationTimer();

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => updateMapPin(pos.coords.latitude, pos.coords.longitude),
                () => {},
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
            );
        }

        // Check for active share link to restore UI
        try {
            const linkRes = await apiCall('/session-link');
            if (linkRes.success && linkRes.data?.active) {
                document.getElementById('tmShareSection').hidden = false;
                document.getElementById('tmShareInput').value = linkRes.data.shareableLink;
                const shareUrl = linkRes.data.shareableLink;
                const waBtn = document.getElementById('tmWhatsappBtn');
                if (waBtn && shareUrl) {
                    const msg = encodeURIComponent(`🛡️ SafeNex Live Tracking Alert\n\nMonitor my live location here:\n${shareUrl}`);
                    waBtn.hidden = false;
                    waBtn.onclick = () => window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
                }
            }
        } catch (e) {
            console.warn('Failed to fetch session link status', e);
        }

    } else {
        // Even when off, show approximate location on map
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => updateMapPin(pos.coords.latitude, pos.coords.longitude),
                () => { const el = document.getElementById('mapLocationLabel'); if (el) el.textContent = 'Location unavailable'; },
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
            );
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
