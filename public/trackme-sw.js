/**
 * trackme-sw.js — SafeNex Track Me Service Worker
 * ─────────────────────────────────────────────────
 * Runs independently of any open browser tab.
 * Handles background location sync via periodic background sync and
 * offline ping queuing via IndexedDB.
 *
 * INSTALL this once via trackme-bg.js on any page load where the user
 * is authenticated.
 *
 * Architecture:
 *   - Listens for postMessage commands from the page: {type: 'TM_START'|'TM_STOP'|'TM_PING'}
 *   - On TM_PING: stores to IndexedDB queue, attempts immediate send
 *   - On background sync 'tm-location-sync': drains the IndexedDB queue
 *   - Persists tracking state in SW Cache (survives browser close)
 */

'use strict';

const SW_VERSION = 'tm-sw-v3';
const TM_STATE_CACHE = 'tm-sw-state-v1';
const DB_NAME = 'safenex-tm-db';
const DB_VERSION = 1;
const STORE_PINGS = 'pending_pings';
const STORE_STATE = 'sw_state';

// ─── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_PINGS)) {
                const store = db.createObjectStore(STORE_PINGS, { keyPath: 'id', autoIncrement: true });
                store.createIndex('sessionId', 'sessionId', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_STATE)) {
                db.createObjectStore(STORE_STATE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
    });
}

async function dbSet(storeName, key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put({ key, value });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function dbAddPing(ping) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PINGS, 'readwrite');
        tx.objectStore(STORE_PINGS).add(ping);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function dbGetAllPings() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PINGS, 'readonly');
        const req = tx.objectStore(STORE_PINGS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function dbDeletePings(ids) {
    if (!ids || ids.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PINGS, 'readwrite');
        const store = tx.objectStore(STORE_PINGS);
        ids.forEach(id => store.delete(id));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

// ─── State helpers ─────────────────────────────────────────────────────────────

async function getState() {
    const active        = await dbGet(STORE_STATE, 'tm_active');
    const sessionId     = await dbGet(STORE_STATE, 'tm_session_id');
    const startTime     = await dbGet(STORE_STATE, 'tm_start_time');
    const token         = await dbGet(STORE_STATE, 'tm_token');
    const pings         = await dbGet(STORE_STATE, 'tm_pings');
    return {
        active: active === true || active === 'true',
        sessionId,
        startTime,
        token,
        pings: parseInt(pings || '0'),
    };
}

async function setState(fields) {
    for (const [key, val] of Object.entries(fields)) {
        await dbSet(STORE_STATE, key, val);
    }
}

// ─── Service Worker lifecycle ──────────────────────────────────────────────────

self.addEventListener('install', (e) => {
    console.log('[TM-SW] Installed', SW_VERSION);
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('[TM-SW] Activated', SW_VERSION);
    e.waitUntil(self.clients.claim());
});

// ─── Message handler (from page) ──────────────────────────────────────────────
// The page sends postMessage to inform the SW of state changes.

self.addEventListener('message', async (e) => {
    const { type, payload } = e.data || {};

    if (type === 'TM_START') {
        // Page started a new tracking session
        await setState({
            tm_active: true,
            tm_session_id: payload.sessionId,
            tm_start_time: payload.startTime,
            tm_token: payload.token,
            tm_pings: 0,
        });
        // Register periodic background sync if supported
        if ('periodicSync' in self.registration) {
            try {
                await self.registration.periodicSync.register('tm-location-sync', {
                    minInterval: 30 * 1000, // 30 seconds
                });
            } catch (err) {
                console.warn('[TM-SW] periodicSync register failed:', err);
            }
        }
    }

    if (type === 'TM_STOP') {
        await setState({ tm_active: false });
        // Unregister periodic sync
        if ('periodicSync' in self.registration) {
            try { await self.registration.periodicSync.unregister('tm-location-sync'); } catch(e){}
        }
    }

    if (type === 'TM_TOKEN_UPDATE') {
        // Auth token refreshed — update SW copy
        await setState({ tm_token: payload.token });
    }

    if (type === 'TM_PING') {
        // Page is visible — queue ping from page message
        await handlePing(payload);
    }

    if (type === 'TM_SYNC_NOW') {
        // Page asks SW to drain the queue immediately (e.g. on reconnect)
        await drainQueue();
    }
});

// ─── Ping handler ──────────────────────────────────────────────────────────────

async function handlePing(payload) {
    const { sessionId, lat, lng, speed, token, timestamp } = payload;

    const ping = {
        sessionId,
        lat,
        lng,
        speed: speed || 0,
        token,
        timestamp: timestamp || new Date().toISOString(),
        attempts: 0,
    };

    // Queue in IndexedDB first (guarantees persistence)
    await dbAddPing(ping);

    // Try to send immediately; if offline, background sync will handle it
    try {
        await sendPing(ping);
    } catch(e) {
        // Network unavailable — will be retried by background sync / next ping
        console.warn('[TM-SW] Ping failed, queued for retry:', e.message);
        // Register one-shot background sync for when network comes back
        if ('sync' in self.registration) {
            try { await self.registration.sync.register('tm-send-queued'); } catch(e){}
        }
    }
}

// ─── Send a single ping to the server ─────────────────────────────────────────

async function sendPing(ping) {
    const state = await getState();
    const authToken = ping.token || state.token;
    if (!authToken) return;

    const res = await fetch('/api/trackme/ping', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
            sessionId: ping.sessionId || state.sessionId,
            lat: ping.lat,
            lng: ping.lng,
            speed: ping.speed || 0,
            timestamp: ping.timestamp,
        }),
    });

    if (res.status === 401 || res.status === 403) {
        // Auth expired — try to refresh
        await silentTokenRefresh();
        throw new Error('Auth expired, refreshing');
    }

    if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
    }

    return res.json();
}

// ─── Drain IndexedDB queue (batch send) ───────────────────────────────────────

async function drainQueue() {
    const pending = await dbGetAllPings();
    if (pending.length === 0) return { sent: 0 };

    const state = await getState();
    if (!state.active || !state.sessionId) {
        // Session ended while offline - clear the queue
        await dbDeletePings(pending.map(p => p.id));
        return { sent: 0, cleared: pending.length };
    }

    const sent = [];
    for (const ping of pending) {
        try {
            await sendPing({ ...ping, token: state.token });
            sent.push(ping.id);
        } catch (e) {
            // Stop on first failure — will retry next sync
            break;
        }
    }

    if (sent.length > 0) {
        await dbDeletePings(sent);
        // Update page clients about synced count
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
            client.postMessage({
                type: 'TM_SYNCED',
                payload: { count: sent.length },
            });
        });
    }

    return { sent: sent.length };
}

// ─── Background Sync (fires when network restores) ────────────────────────────

self.addEventListener('sync', async (e) => {
    if (e.tag === 'tm-send-queued') {
        e.waitUntil(drainQueue());
    }
});

// ─── Periodic Background Sync (fires every ~30s even with app closed) ─────────

self.addEventListener('periodicsync', async (e) => {
    if (e.tag === 'tm-location-sync') {
        e.waitUntil(drainQueue());
    }
});

// ─── Push notifications (for tracking active banner) ──────────────────────────

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = e.notification.data?.url || '/trackme';
    e.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            const existing = clients.find(c => c.url.includes('/trackme'));
            if (existing) return existing.focus();
            return self.clients.openWindow(url);
        })
    );
});

// ─── Silent Token Refresh ──────────────────────────────────────────────────────
// If the auth token expired, try to get a fresh one from any open page client.

async function silentTokenRefresh() {
    const clients = await self.clients.matchAll({ type: 'window' });
    if (clients.length === 0) return;
    // Ask first available client to send us a fresh token
    clients[0].postMessage({ type: 'TM_REQUEST_TOKEN' });
}
