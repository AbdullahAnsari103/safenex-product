/**
 * trackme-bg.js — Persistent Background Tracking Layer (v2)
 * ──────────────────────────────────────────────────────────
 * Injected into EVERY page in SafeNex.
 *
 * Key changes in v2 vs v1:
 *   ✅ pagehide NO LONGER stops the session — tab close is NOT a stop event.
 *   ✅ On every page boot, checks the SERVER for active session (not just localStorage).
 *   ✅ Registers the Service Worker (trackme-sw.js) for true background operation.
 *   ✅ Syncs token into SW on every page load.
 *   ✅ Listens for SW TM_SYNCED messages and shows a "connection restored" toast.
 *   ✅ iOS Safari fallback: keeps tracking via watchPosition when app is in foreground.
 *
 * localStorage keys:
 *   tm_active      — 'true' | 'false'  (local optimistic cache — server is truth)
 *   tm_session_id  — active sessionId string
 *   tm_start_time  — ISO timestamp of session start (server value, used for timer)
 *   tm_pings       — cumulative ping count (running total across page navigations)
 *   tm_server_confirmed — 'true' when server confirmed session ACTIVE on last load
 */

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────
    const API_BASE = '/api/trackme';
    const PING_INTERVAL_FG = 5000;    // 5s when tab is visible
    const PING_INTERVAL_BG = 15000;   // 15s when tab is hidden

    // ─── Runtime state (per-page, recreated each navigation) ─────────────────
    let _bgWatchId   = null;
    let _bgPingTimer = null;
    let _bgPosition  = null;
    let _swRegistration = null;

    // ─── localStorage helpers ─────────────────────────────────────────────────
    function tmGet(key) { try { return localStorage.getItem(key); } catch(e){ return null; } }
    function tmSet(key, val) { try { localStorage.setItem(key, String(val)); } catch(e){} }
    function tmDel(key) { try { localStorage.removeItem(key); } catch(e){} }

    function isTrackingActive() { return tmGet('tm_active') === 'true'; }
    function getSessionId()     { return tmGet('tm_session_id'); }

    // ─── Auth ─────────────────────────────────────────────────────────────────
    function getToken() {
        return localStorage.getItem('snx_token') || localStorage.getItem('token');
    }

    // ─── Service Worker Registration ──────────────────────────────────────────
    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return null;
        try {
            const reg = await navigator.serviceWorker.register('/trackme-sw.js', { scope: '/' });
            _swRegistration = reg;

            // Listen for messages FROM the service worker
            navigator.serviceWorker.addEventListener('message', onSwMessage);

            // Sync current token into SW whenever SW becomes active
            const sw = reg.active || reg.waiting || reg.installing;
            if (sw) swPostMessage({ type: 'TM_TOKEN_UPDATE', payload: { token: getToken() } });

            return reg;
        } catch (e) {
            console.warn('[TrackMe BG] SW registration failed:', e.message);
            return null;
        }
    }

    function swPostMessage(msg) {
        try {
            if (navigator.serviceWorker?.controller) {
                navigator.serviceWorker.controller.postMessage(msg);
            }
        } catch(e) {}
    }

    function onSwMessage(e) {
        const { type, payload } = e.data || {};

        if (type === 'TM_SYNCED') {
            // SW synced queued location updates after reconnect
            if (payload?.count > 0) {
                showBanner(`Connection restored. ${payload.count} location update${payload.count !== 1 ? 's' : ''} synced.`, 'success');
                // Update ping counter
                const prev = parseInt(tmGet('tm_pings') || '0');
                tmSet('tm_pings', prev + payload.count);
                if (typeof window.tmBgPingCallback === 'function') {
                    window.tmBgPingCallback(prev + payload.count, null, null);
                }
            }
        }

        if (type === 'TM_REQUEST_TOKEN') {
            // SW needs a fresh auth token (e.g. after 401 on a ping)
            swPostMessage({ type: 'TM_TOKEN_UPDATE', payload: { token: getToken() } });
        }
    }

    // ─── Ping ─────────────────────────────────────────────────────────────────
    async function bgSendPing() {
        const sessionId = getSessionId();
        if (!sessionId || !_bgPosition) return;

        const { latitude: lat, longitude: lng, speed } = _bgPosition.coords;
        const token = getToken();
        if (!token) return;

        const timestamp = new Date().toISOString();

        // Send via page fetch AND mirror to SW (SW queues in IndexedDB for offline resilience)
        swPostMessage({
            type: 'TM_PING',
            payload: { sessionId, lat, lng, speed: speed || 0, token, timestamp },
        });

        try {
            const res = await fetch(`${API_BASE}/ping`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ sessionId, lat, lng, speed: speed || 0, timestamp }),
            });

            if (res.ok) {
                const pings = parseInt(tmGet('tm_pings') || '0') + 1;
                tmSet('tm_pings', pings);

                if (typeof window.tmBgPingCallback === 'function') {
                    window.tmBgPingCallback(pings, lat, lng);
                }

                // On successful ping, ask SW to drain any queued offline pings too
                swPostMessage({ type: 'TM_SYNC_NOW' });
            }

            if (res.status === 401 || res.status === 403) {
                // Auth expired — don't stop tracking, attempt silent recovery
                console.warn('[TrackMe BG] Auth expired on ping — awaiting token refresh');
                return;
            }
        } catch (e) {
            // Network error: sessions remain ACTIVE on server, pings queued in SW IndexedDB
            console.warn('[TrackMe BG] Ping failed (network), SW will retry:', e.message);

            // Show reconnecting indicator to page if it's the trackme page
            if (typeof window.tmBgConnLostCallback === 'function') {
                window.tmBgConnLostCallback();
            }
        }
    }

    function bgSchedulePing() {
        clearTimeout(_bgPingTimer);
        const interval = document.hidden ? PING_INTERVAL_BG : PING_INTERVAL_FG;
        _bgPingTimer = setTimeout(async () => {
            if (!isTrackingActive()) return;
            await bgSendPing();
            bgSchedulePing(); // chain
        }, interval);
    }

    // ─── Start/Resume GPS watch and pings ─────────────────────────────────────
    // ─── Start/Resume GPS watch and pings ─────────────────────────────────────
    function bgResumeTracking() {
        if (!navigator.geolocation) return;

        if (_bgWatchId !== null) {
            navigator.geolocation.clearWatch(_bgWatchId);
        }
        _bgWatchId = navigator.geolocation.watchPosition(
            (pos) => { _bgPosition = pos; },
            (err) => {
                console.warn('[TrackMe BG] High-accuracy watch error:', err.code);
                // Fallback watch: standard network accuracy
                if (err.code === 2 || err.code === 3) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => { _bgPosition = pos; },
                        null,
                        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
                    );
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );

        // Get initial position with high accuracy (7s timeout), fallback to network location
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                _bgPosition = pos;
                bgSendPing().then(() => bgSchedulePing());
            },
            () => {
                // Network fallback
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        _bgPosition = pos;
                        bgSendPing().then(() => bgSchedulePing());
                    },
                    () => { bgSchedulePing(); },
                    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
                );
            },
            { enableHighAccuracy: true, timeout: 7000, maximumAge: 10000 }
        );
    }

    // ─── Stop all tracking (page-side only; server session stays ACTIVE) ──────
    // This is called ONLY by window.tmBg.stop() which is called ONLY by the
    // user explicitly confirming stop on the trackme page.
    function bgStopTrackingLocally(callServer = false) {
        const sessionId = getSessionId();

        // Update SW state
        swPostMessage({ type: 'TM_STOP' });

        // Clear local state
        tmSet('tm_active', 'false');
        tmDel('tm_session_id');
        tmDel('tm_start_time');
        tmDel('tm_pings');
        tmDel('tm_server_confirmed');

        clearTimeout(_bgPingTimer);
        _bgPingTimer = null;

        if (_bgWatchId !== null) {
            navigator.geolocation.clearWatch(_bgWatchId);
            _bgWatchId = null;
        }
        _bgPosition = null;

        hideBadge();

        // Dismiss persistent notification if showing
        if ('serviceWorker' in navigator && _swRegistration) {
            _swRegistration.getNotifications({ tag: 'tm-tracking-active' }).then(notifs => {
                notifs.forEach(n => n.close());
            }).catch(() => {});
        }

        return sessionId;
    }

    // ─── Server status check — called on every page load ─────────────────────
    // This is the key to session persistence: server is the source of truth.
    async function checkServerStatus() {
        const token = getToken();
        if (!token) return;

        try {
            const res = await fetch(`${API_BASE}/session-status`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) return;
            const data = await res.json();

            if (data?.data?.active) {
                // Server says ACTIVE — regardless of what localStorage says
                const s = data.data;
                const wasLocallyInactive = tmGet('tm_active') !== 'true';

                tmSet('tm_active', 'true');
                tmSet('tm_session_id', s.sessionId);
                // Only set start_time if we don't already have one (preserve it across opens)
                if (!tmGet('tm_start_time') || wasLocallyInactive) {
                    tmSet('tm_start_time', s.startTime);
                }
                // Set ping count from server if higher than local (covers offline pings)
                const localPings = parseInt(tmGet('tm_pings') || '0');
                if (s.pingCount > localPings) {
                    tmSet('tm_pings', s.pingCount);
                }
                tmSet('tm_server_confirmed', 'true');

                // Sync token into SW
                swPostMessage({ type: 'TM_TOKEN_UPDATE', payload: { token } });
                swPostMessage({
                    type: 'TM_START',
                    payload: { sessionId: s.sessionId, startTime: s.startTime, token },
                });

                // Resume GPS tracking if not already running
                bgResumeTracking();
                injectBadge();

                // If the page just loaded and was previously inactive locally, this is a resume
                if (wasLocallyInactive && typeof window.tmBgResumedCallback === 'function') {
                    window.tmBgResumedCallback(s);
                }
            } else {
                // Server says INACTIVE — clear any stale local state
                if (isTrackingActive()) {
                    tmSet('tm_active', 'false');
                    tmDel('tm_session_id');
                    tmDel('tm_start_time');
                    tmDel('tm_pings');
                    hideBadge();
                }
            }
        } catch(e) {
            // Network unreachable — trust localStorage as fallback
            console.warn('[TrackMe BG] Server status check failed, using cached state:', e.message);
        }
    }

    // ─── Adapt to page visibility changes ─────────────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (!isTrackingActive()) return;
        clearTimeout(_bgPingTimer);
        bgSchedulePing();
    });

    // ─── pagehide — DO NOT STOP SESSION ───────────────────────────────────────
    // CRITICAL: We intentionally do NOT call /stop here.
    // The session is meant to survive browser close.
    // The only valid stop is the user explicitly toggling off on the Track Me page.
    // SW will continue attempting background sync.
    window.addEventListener('pagehide', (e) => {
        if (!isTrackingActive()) return;
        // Just clean up the page-local timers — do NOT call /stop
        clearTimeout(_bgPingTimer);
        _bgPingTimer = null;
        if (_bgWatchId !== null) {
            try { navigator.geolocation.clearWatch(_bgWatchId); } catch(e) {}
            _bgWatchId = null;
        }
        // No sendBeacon. No /stop. Session stays ACTIVE in DB.
    });

    // ─── Floating "Tracking Active" Badge ─────────────────────────────────────
    function injectBadge() {
        if (document.getElementById('tm-bg-badge')) return;

        const badge = document.createElement('a');
        badge.id    = 'tm-bg-badge';
        badge.href  = '/trackme';
        badge.title = 'Track Me is active — click to manage';
        badge.innerHTML = `
            <span class="tm-bg-dot"></span>
            <span class="tm-bg-label">Tracking Active</span>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #tm-bg-badge {
                position: fixed;
                bottom: 24px;
                right: 20px;
                display: flex;
                align-items: center;
                gap: 7px;
                background: rgba(16, 185, 129, 0.12);
                border: 1px solid rgba(16, 185, 129, 0.35);
                border-radius: 20px;
                padding: 7px 14px 7px 10px;
                text-decoration: none;
                z-index: 99999;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                box-shadow: 0 4px 16px rgba(0,0,0,0.35);
                transition: transform 0.2s, box-shadow 0.2s;
                cursor: pointer;
            }
            #tm-bg-badge:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(16, 185, 129, 0.25);
            }
            .tm-bg-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #10B981;
                box-shadow: 0 0 6px #10B981;
                flex-shrink: 0;
                animation: tmBgPulse 1.5s ease-in-out infinite;
            }
            .tm-bg-label {
                font-family: 'Inter', -apple-system, sans-serif;
                font-size: 12px;
                font-weight: 600;
                color: #10B981;
                letter-spacing: 0.01em;
                white-space: nowrap;
            }
            @keyframes tmBgPulse {
                0%, 100% { opacity: 1; box-shadow: 0 0 5px #10B981; }
                50%       { opacity: 0.7; box-shadow: 0 0 12px #10B981; }
            }
            /* Banner notification for sync events */
            #tm-bg-banner {
                position: fixed;
                bottom: 80px;
                right: 20px;
                max-width: 280px;
                background: rgba(16,185,129,0.15);
                border: 1px solid rgba(16,185,129,0.4);
                border-radius: 12px;
                padding: 10px 14px;
                font-family: 'Inter', -apple-system, sans-serif;
                font-size: 13px;
                color: #10B981;
                z-index: 99998;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.3s, transform 0.3s;
                pointer-events: none;
            }
            #tm-bg-banner.show { opacity: 1; transform: translateY(0); }
        `;

        document.head.appendChild(style);
        document.body.appendChild(badge);
    }

    function hideBadge() {
        const badge = document.getElementById('tm-bg-badge');
        if (badge) badge.remove();
    }

    let _bannerTimer = null;
    function showBanner(msg, type = 'info') {
        let el = document.getElementById('tm-bg-banner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'tm-bg-banner';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.className = 'show';
        clearTimeout(_bannerTimer);
        _bannerTimer = setTimeout(() => { el.className = ''; }, 4000);
    }

    // ─── Expose control surface for trackme.js ────────────────────────────────
    window.tmBg = {
        /**
         * Called by trackme.js after successfully starting a NEW session via the server.
         * sessionId and startTime come from the server response.
         * reconnectToken is stored for future session recovery.
         */
        start(sessionId, startTime, reconnectToken) {
            tmSet('tm_active', 'true');
            tmSet('tm_session_id', sessionId);
            tmSet('tm_start_time', startTime || new Date().toISOString());
            tmSet('tm_pings', '0');
            tmSet('tm_server_confirmed', 'true');

            // Tell service worker
            swPostMessage({
                type: 'TM_START',
                payload: { sessionId, startTime: tmGet('tm_start_time'), token: getToken() },
            });

            bgResumeTracking();
            injectBadge();

            // Show persistent notification on mobile if permission granted
            showTrackingNotification();
        },

        /**
         * Called by trackme.js when user EXPLICITLY confirms stopping.
         * Returns sessionId so trackme.js can call /api/trackme/stop.
         */
        stop() {
            const sessionId = bgStopTrackingLocally();
            return sessionId;
        },

        /** Returns true if tracking is active (server-confirmed or locally cached). */
        isActive() { return isTrackingActive(); },

        /** Returns stored sessionId. */
        getSessionId() { return getSessionId(); },

        /** Returns cumulative ping count across pages. */
        getPings() { return parseInt(tmGet('tm_pings') || '0'); },

        /** Returns ISO start time (server-side value). */
        getStartTime() { return tmGet('tm_start_time'); },
    };

    // ─── Persistent notification (keeps SW alive on Android) ──────────────────
    async function showTrackingNotification() {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        if (!_swRegistration) return;
        try {
            await _swRegistration.showNotification('SafeNex is monitoring your location', {
                body: 'Tracking is active. Tap to open the Track Me screen.',
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                tag: 'tm-tracking-active',
                renotify: false,
                silent: true,
                data: { url: '/trackme' },
                actions: [{ action: 'open', title: 'Open' }],
            });
        } catch(e) {
            // Notifications not supported or denied — fine, not critical
        }
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────
    // Runs as soon as DOM is ready on EVERY page.
    // 1. Register service worker (always, regardless of tracking state)
    // 2. Check server for active session (server is the truth)
    // 3. If active locally AND server check passes: resume pings + show badge
    async function boot() {
        // Always register SW — even when tracking is off — so it's ready
        await registerServiceWorker();

        const token = getToken();
        if (!token) return; // not logged in

        // Always check server — this is how we survive tab close + reopen
        await checkServerStatus();

        // If tracking is active (confirmed above), show badge and resume
        // (checkServerStatus already calls bgResumeTracking + injectBadge if active)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
