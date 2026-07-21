/**
 * routes/tracking.js — Public Live Tracking API
 * No authentication required on these routes.
 * They are accessed by emergency contacts who open a shareable link.
 *
 * Mounted in server.js as: app.use('/api/tracking', require('./routes/tracking'))
 */

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const store   = require('../store/db');

// ─── Rate Limiter — 30 req/min per IP for public live-location API ─────────────
const liveRateLimit = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 30,                    // max 30 requests per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please slow down.' },
});

/**
 * GET /api/tracking/live/:token
 * Public — no auth.
 * Called every 5s by the live viewer page to get current position.
 * Returns: { isActive, userName, lat, lng, lastPingAt, pingCount, startTime }
 */
router.get('/live/:token', liveRateLimit, async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || token.length < 32) {
            return res.status(400).json({ success: false, message: 'Invalid token.' });
        }

        const session = await store.getSessionByToken(token);

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Tracking link not found.',
                code: 'NOT_FOUND',
            });
        }

        // Auto-expire: mark link inactive if session started over 24h ago
        if (session.isActive && session.startTime) {
            const ageMs = Date.now() - new Date(session.startTime).getTime();
            if (ageMs > 24 * 60 * 60 * 1000) {
                await store.expireShareLink(session.userId);
                session.isActive = false;
            }
        }

        // Also mark expired if session ended (tracking_status != ACTIVE)
        const isEffectivelyActive = session.isActive && session.trackingStatus === 'ACTIVE';

        return res.json({
            success: true,
            data: {
                isActive:   isEffectivelyActive,
                userName:   session.userName,
                lat:        session.lastLat,
                lng:        session.lastLng,
                lastPingAt: session.lastPingAt,
                pingCount:  session.pingCount,
                startTime:  session.startTime,
                endTime:    session.endTime,
            },
        });

    } catch (error) {
        console.error('[Public Live Tracking Error]', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
