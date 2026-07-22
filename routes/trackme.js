/**
 * Track Me Routes — SafeNex
 * Voluntary live location tracking feature.
 * Follows the exact same patterns as routes/silentroom-new.js and routes/admin.js
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const store = require('../store/db');

// All routes require authentication
router.use(protect);

/**
 * POST /api/trackme/start
 * Start a new tracking session.
 * Returns sessionId to be used in subsequent pings.
 */
router.post('/start', async (req, res, next) => {
    try {
        const user = req.user;
        const io = req.app.get('io');
        const deviceId = req.body.deviceId || null;

        const result = await store.startTrackMeSession(
            user._id,
            user.name,
            user.safeNexId,
            deviceId
        );

        // Notify all admin watchers that a new user started tracking
        if (io) {
            io.to('trackme:admin').emit('trackme:userStarted', {
                sessionId: result.sessionId,
                userId: user._id,
                userName: user.name,
                safeNexId: user.safeNexId || null,
                startTime: result.startTime,
                lastLat: null,
                lastLng: null,
                pingCount: 0,
                trackingStatus: 'ACTIVE',
            });
        }

        res.json({
            success: true,
            data: {
                sessionId: result.sessionId,
                startTime: result.startTime,
                reconnectToken: result.reconnectToken,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trackme/ping
 * Send a location update for an active session.
 * Body: { sessionId, lat, lng, speed?, timestamp? }
 */
router.post('/ping', async (req, res, next) => {
    try {
        const { sessionId, lat, lng, speed } = req.body;
        const user = req.user;
        const io = req.app.get('io');

        if (!sessionId || lat === undefined || lng === undefined) {
            return res.status(400).json({
                success: false,
                message: 'sessionId, lat, and lng are required',
            });
        }

        // STEP 1 — GPS JITTER FILTER: Check distance from last stored position
        const session = await store.getTrackMeSession(sessionId);
        if (session && session.lastLat !== null && session.lastLng !== null) {
            const distanceFromLast = haversineDistance(
                lat, lng, 
                session.lastLat, session.lastLng
            );
            
            // If movement is less than 5 meters, discard this ping (GPS jitter)
            if (distanceFromLast < 5) {
                return res.json({
                    success: true,
                    data: {
                        filtered: true,
                        reason: 'GPS jitter (< 5m movement)',
                        inDanger: session.inDanger || false,
                        dangerZoneId: session.dangerZoneId || null,
                        pingCount: session.pingCount || 0,
                    },
                });
            }
        }

        // Check if this location is inside any danger zone
        let inDanger = false;
        let dangerZoneId = null;
        let dangerZoneName = null;

        try {
            const zones = await store.getAllDangerZones();
            for (const zone of zones) {
                const dist = haversineDistance(lat, lng, zone.latitude, zone.longitude);
                if (dist <= (zone.radius || 200)) {
                    inDanger = true;
                    dangerZoneId = zone.id;
                    dangerZoneName = zone.placeName || zone.description || 'Danger Zone';
                    break;
                }
            }
        } catch (e) {
            // Non-critical — danger zone check failure doesn't break ping
            console.error('Danger zone check error:', e.message);
        }

        const result = await store.updateTrackMeSession(
            sessionId, user._id, lat, lng, speed, inDanger, dangerZoneId
        );

        // Emit live location update to admin room
        if (io) {
            const payload = {
                sessionId,
                userId: user._id,
                userName: user.name,
                safeNexId: user.safeNexId || null,
                lat,
                lng,
                speed: speed || 0,
                timestamp: new Date().toISOString(),
                inDanger,
                dangerZoneId,
                pingCount: result ? result.pingCount : 0,
            };
            io.to('trackme:admin').emit('trackme:locationUpdate', payload);

            // If user just entered a danger zone — send separate alert
            if (inDanger) {
                io.to('trackme:admin').emit('trackme:dangerZoneAlert', {
                    sessionId,
                    userId: user._id,
                    userName: user.name,
                    safeNexId: user.safeNexId || null,
                    lat,
                    lng,
                    dangerZoneId,
                    dangerZoneName,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        res.json({
            success: true,
            data: {
                inDanger,
                dangerZoneId,
                dangerZoneName,
                pingCount: result ? result.pingCount : 0,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trackme/stop
 * End the tracking session.
 * Body: { sessionId, endedNormally? }
 */
router.post('/stop', async (req, res, next) => {
    try {
        const { sessionId, endedNormally = true } = req.body;
        const user = req.user;
        const io = req.app.get('io');

        if (!sessionId) {
            return res.status(400).json({ success: false, message: 'sessionId is required' });
        }

        await store.endTrackMeSession(sessionId, endedNormally);

        // Notify admin that this user stopped tracking
        if (io) {
            io.to('trackme:admin').emit('trackme:userStopped', {
                sessionId,
                userId: user._id,
                userName: user.name,
                endedNormally,
                timestamp: new Date().toISOString(),
            });
        }

        res.json({ success: true, message: 'Tracking session ended' });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trackme/session-status
 * Check if the authenticated user has an ACTIVE tracking session on the server.
 * Called by the client on every page load to detect if tracking should be resumed.
 * This is the server-side source of truth — NOT localStorage.
 */
router.get('/session-status', async (req, res, next) => {
    try {
        const session = await store.getActiveSessionForUser(req.user._id);
        if (!session) {
            return res.json({ success: true, data: { active: false } });
        }
        res.json({
            success: true,
            data: {
                active: true,
                sessionId: session.sessionId,
                startTime: session.startTime,
                lastLat: session.lastLat,
                lastLng: session.lastLng,
                lastPingAt: session.lastPingAt,
                pingCount: session.pingCount,
                reconnectToken: session.reconnectToken,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trackme/active
 * Admin: get all currently active tracking sessions.
 */
router.get('/active', async (req, res, next) => {
    try {
        const sessions = await store.getActiveTrackMeSessions();
        res.json({ success: true, data: sessions });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trackme/history
 * Get the current user's past tracking sessions.
 */
router.get('/history', async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const sessions = await store.getTrackMeSessionHistory(req.user._id, limit);
        res.json({ success: true, data: sessions });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trackme/danger-zones
 * Return all danger zones for the client mini-map overlay.
 * This avoids needing CORS-exempt safetrace calls from trackme page.
 */
router.get('/danger-zones', async (req, res, next) => {
    try {
        const zones = await store.getAllDangerZones();
        res.json({ success: true, data: zones });
    } catch (error) {
        next(error);
    }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/trackme/generate-link
 * Generate a shareable live tracking link for the active session.
 * Also builds wa.me URLs for each emergency contact to open in new tabs.
 * Body: { sessionId, userName } (optional — falls back to req.user)
 */
router.post('/generate-link', async (req, res, next) => {
    try {
        const user = req.user;

        // Base URL for shareable live tracking link — defaults to production vercel URL
        const rawBaseUrl = process.env.PUBLIC_URL || process.env.DEV_TUNNEL_URL || process.env.BASE_URL || 'https://safenex-six.vercel.app';
        const baseUrl = rawBaseUrl.replace(/\/+$/, '');

        // Generate & persist token in DB
        const result = await store.generateShareLink(user._id);
        if (!result) {
            return res.status(400).json({
                success: false,
                message: 'No active tracking session found. Start tracking first.',
            });
        }

        const shareableLink = `${baseUrl}/live/${result.token}`;

        // Fetch emergency contacts from SOS config
        const sosConfig = await store.getSOSConfig(user._id);
        let contacts = [
            sosConfig?.primaryContact,
            sosConfig?.secondaryContact,
        ].filter(Boolean).map(n => n.replace(/\D/g, '')); // digits only

        // Normalize 10-digit numbers to include country code (defaulting to 91 for India if 10 digits)
        contacts = contacts.map(num => (num.length === 10 ? '91' + num : num));

        const displayName = user.name || 'Someone you know';

        // Build WhatsApp start message
        const startMsgText = `🛡️ SafeNex Live Tracking Alert\n\n${displayName} has started live location tracking.\n\nMonitor their real-time location here:\n${shareableLink}\n\nThis link is active until they stop tracking. No app or login needed — just open the link.`;
        const startMsg = encodeURIComponent(startMsgText);

        // Build WhatsApp URLs: targeted contacts or universal share URL
        let waUrls = [];
        if (contacts.length > 0) {
            waUrls = contacts.map(phone => `https://wa.me/${phone}?text=${startMsg}`);
        } else {
            // Fallback universal WhatsApp share link if no contacts pre-configured
            waUrls = [`https://wa.me/?text=${startMsg}`];
        }

        res.json({
            success: true,
            data: {
                shareableLink,
                token: result.token,
                waUrls,
                contactCount: contacts.length,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/trackme/expire-link
 * Expire the active share link when user stops tracking.
 * Body: { startTime? } — used to compute session duration for the stop message
 */
router.post('/expire-link', async (req, res, next) => {
    try {
        const user = req.user;
        const { startTime, pingCount = 0 } = req.body;

        await store.expireShareLink(user._id);

        // Compute duration string
        let durationStr = 'a session';
        if (startTime) {
            const secs = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            const s = secs % 60;
            durationStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
        }

        // Fetch emergency contacts
        const sosConfig = await store.getSOSConfig(user._id);
        const contacts = [
            sosConfig?.primaryContact,
            sosConfig?.secondaryContact,
        ].filter(Boolean).map(n => n.replace(/\D/g, ''));

        const displayName = user.name || 'Someone you know';

        const stopMsg = encodeURIComponent(
            `✅ SafeNex Tracking Ended\n\n${displayName} has safely ended their tracking session.\n\nThe live link is no longer active.\nThey were monitored for: ${durationStr}`
        );

        const waUrls = contacts.map(phone => `https://wa.me/${phone}?text=${stopMsg}`);

        res.json({
            success: true,
            data: { waUrls, contactCount: contacts.length },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/trackme/session-link
 * Return the active share link for the current user (if any).
 * Used to restore the link display on page reload.
 */
router.get('/session-link', async (req, res, next) => {
    try {
        const rawBaseUrl = process.env.PUBLIC_URL || process.env.DEV_TUNNEL_URL || process.env.BASE_URL || 'https://safenex-six.vercel.app';
        const baseUrl = rawBaseUrl.replace(/\/+$/, '');
        const session = await store.getActiveSessionForUser(req.user._id);
        if (!session) {
            return res.json({ success: true, data: { active: false, shareableLink: null } });
        }

        // Re-fetch token directly from DB
        const rows = await store.getSessionByTokenForUser(req.user._id);
        if (!rows || !rows.token || !rows.isLinkActive) {
            return res.json({ success: true, data: { active: false, shareableLink: null } });
        }

        res.json({
            success: true,
            data: {
                active: true,
                shareableLink: `${baseUrl}/live/${rows.token}`,
            },
        });
    } catch (error) {
        next(error);
    }
});


/** Haversine distance in meters between two lat/lng points */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = router;
