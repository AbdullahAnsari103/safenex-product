require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { initDB } = require('./store/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // Increased from 100 to 500
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
    skip: (req) => {
        // Skip rate limiting for static files
        return req.path.startsWith('/uploads') || 
               req.path.startsWith('/qrcodes') ||
               req.path.endsWith('.css') ||
               req.path.endsWith('.js') ||
               req.path.endsWith('.html') ||
               req.path.endsWith('.png') ||
               req.path.endsWith('.jpg') ||
               req.path.endsWith('.svg');
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
// Trust proxy - required for rate limiting behind proxies/load balancers
app.set('trust proxy', 1);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(limiter);

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/qrcodes', express.static(path.join(__dirname, 'qrcodes')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Socket.IO Setup ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('👤 User connected:', socket.id);

    // Join Silent Room
    socket.on('join:silentroom', () => {
        socket.join('silentroom');
        console.log('📢 User joined Silent Room:', socket.id);
    });

    // Leave Silent Room
    socket.on('leave:silentroom', () => {
        socket.leave('silentroom');
        console.log('👋 User left Silent Room:', socket.id);
    });

    // Join Track Me admin room (admin dashboard only)
    socket.on('join:trackme:admin', () => {
        socket.join('trackme:admin');
        console.log('📍 Admin joined Track Me room:', socket.id);
    });

    // Leave Track Me admin room
    socket.on('leave:trackme:admin', () => {
        socket.leave('trackme:admin');
        console.log('📍 Admin left Track Me room:', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('👤 User disconnected:', socket.id);
    });
});

// Make io available to routes
app.set('io', io);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/sos', require('./routes/sos'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/silentroom', require('./routes/silentroom-new'));
app.use('/api/safetrace', require('./routes/safetrace'));
app.use('/api/admin', require('./routes/admin')); // Admin dashboard routes
app.use('/api/trackme', require('./routes/trackme')); // Track Me live location routes (auth required)
app.use('/api/tracking', require('./routes/tracking')); // Public live tracking API (no auth)

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'SafeNex API is running.',
        storage: 'in-memory',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

// ─── Dashboard SPA Page ───────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ─── SOS Page ─────────────────────────────────────────────────────────────────
app.get('/sos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sos-redesign.html'));
});

// ─── Silent Room Page ─────────────────────────────────────────────────────────
app.get('/silentroom', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'silentroom.html'));
});

// ─── Track Me Page ───────────────────────────────────────────────────────────
app.get('/trackme', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trackme.html'));
});

// ─── Public Live Tracker Viewer ────────────────────────────────────────────────
// NO login required — emergency contacts open this after receiving a wa.me link
app.get('/live/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'live-viewer.html'));
});

// ─── SafeTrace Page ───────────────────────────────────────────────────────────
app.get('/safetrace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'safetrace.html'));
});

// ─── Landing Page ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ─── Onboarding Page ──────────────────────────────────────────────────────────
app.get('/onboarding', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

// ─── Catch-all SPA ───────────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

(async () => {
    await initDB();
    
    const serverInstance = server.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════╗
║   🛡️  SafeNex Identity System          ║
║   Server running on port ${PORT}          ║
║   Storage: Turso (LibSQL Cloud)        ║
║   Mode: ${process.env.NODE_ENV || 'development'}              ║
║   Real-time: Socket.IO ✅              ║
╚════════════════════════════════════════╝
    `);

        // ─── 24-hour share link auto-expiry (runs every 10 min) ──────────
        // Safety net: expire any links that have been active > 24h
        // (in case the user never explicitly stopped tracking)
        const { expireStaleShareLinks } = require('./store/db');
        if (typeof expireStaleShareLinks === 'function') {
            setInterval(async () => {
                try { await expireStaleShareLinks(); }
                catch (e) { console.error('[AutoExpire]', e.message); }
            }, 10 * 60 * 1000); // every 10 minutes
        }
    });

    // Handle port already in use error
    serverInstance.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${PORT} is already in use!`);
            console.log(`\n💡 Solutions:`);
            console.log(`   1. Kill the process: taskkill /F /PID <PID>`);
            console.log(`   2. Find PID: netstat -ano | findstr :${PORT}`);
            console.log(`   3. Change PORT in .env file\n`);
            process.exit(1);
        } else {
            console.error('Server error:', error);
            process.exit(1);
        }
    });
})();

module.exports = app;
