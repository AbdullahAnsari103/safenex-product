/**
 * SafeNex – Turso (LibSQL) Cloud Database Store
 * Free tier: sign up at https://turso.tech with GitHub, no credit card.
 *
 * Setup (one-time):
 *   1. npm install -g @turso/cli
 *   2. turso auth login
 *   3. turso db create safenex
 *   4. turso db token create safenex        → TURSO_AUTH_TOKEN
 *   5. turso db show safenex --url           → TURSO_DATABASE_URL
 *   Put both in your .env file.
 */

const { createClient } = require('@libsql/client');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

let rawClient = null;

function getDBClient() {
    if (!rawClient) {
        const url = process.env.TURSO_DATABASE_URL;
        const token = process.env.TURSO_AUTH_TOKEN;
        if (url) {
            rawClient = createClient({ 
                url, 
                authToken: token,
                intMode: 'number'
            });
        } else {
            const err = new Error('Turso Database is not configured. Please set TURSO_DATABASE_URL in Vercel Environment Variables.');
            err.statusCode = 500;
            throw err;
        }
    }
    return rawClient;
}

const client = new Proxy({}, {
    get(target, prop) {
        const dbClient = getDBClient();
        const value = dbClient[prop];
        if (typeof value === 'function') {
            return value.bind(dbClient);
        }
        return value;
    }
});

/**
 * Initialize the Turso client and create tables if they don't exist.
 * Called once on server start.
 */
async function initDB() {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) {
        console.warn('⚠️ TURSO_DATABASE_URL is not set in environment variables. Database initialization skipped.');
        return;
    }

    // Test connection
    try {
        await client.execute('SELECT 1');
        console.log('✅ Turso DB connection established');
    } catch (error) {
        console.error('❌ Failed to connect to Turso DB:', error.message);
        if (process.env.VERCEL) {
            console.warn('⚠️ Skipping further DB retries on Vercel.');
            return;
        }
        console.log('⚠️ Retrying connection in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
            await client.execute('SELECT 1');
            console.log('✅ Turso DB connection established on retry');
        } catch (retryError) {
            console.error('❌ Failed to connect to Turso DB after retry:', retryError.message);
            return;
        }
    }

    await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      email          TEXT UNIQUE NOT NULL,
      password       TEXT NOT NULL,
      verified       INTEGER NOT NULL DEFAULT 0,
      document_type  TEXT,
      safenex_id     TEXT UNIQUE,
      qr_code_path   TEXT,
      document_path  TEXT,
      extracted_name TEXT,
      document_number TEXT,
      verified_at    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    await client.execute(`
    CREATE TABLE IF NOT EXISTS sos_configs (
      user_id                  TEXT PRIMARY KEY,
      primary_contact          TEXT,
      secondary_contact        TEXT,
      message_template         TEXT,
      safe_words               TEXT,
      voice_activation_enabled INTEGER DEFAULT 0,
      live_beacon_enabled      INTEGER DEFAULT 0,
      beacon_update_interval   INTEGER DEFAULT 60,
      battery_level_enabled    INTEGER DEFAULT 1,
      timestamp_enabled        INTEGER DEFAULT 1,
      updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    await client.execute(`
    CREATE TABLE IF NOT EXISTS sos_sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      session_id   TEXT NOT NULL,
      triggered_by TEXT,
      start_time   TEXT NOT NULL,
      end_time     TEXT,
      events       TEXT,
      location     TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    // Silent Room posts table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS silent_room_posts (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      message      TEXT NOT NULL,
      post_type    TEXT DEFAULT 'general',
      location_lat REAL,
      location_lng REAL,
      location_address TEXT,
      images       TEXT,
      anonymous    INTEGER DEFAULT 0,
      likes        INTEGER DEFAULT 0,
      comments     INTEGER DEFAULT 0,
      views        INTEGER DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    // Silent Room likes table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS silent_room_likes (
      id         TEXT PRIMARY KEY,
      post_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES silent_room_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

    // Silent Room comments table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS silent_room_comments (
      id         TEXT PRIMARY KEY,
      post_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES silent_room_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    // SafeTrace danger zones table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS safetrace_danger_zones (
      id              TEXT PRIMARY KEY,
      latitude        REAL NOT NULL,
      longitude       REAL NOT NULL,
      radius          REAL NOT NULL DEFAULT 100,
      severity        TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      category        TEXT NOT NULL,
      description     TEXT,
      source          TEXT NOT NULL,
      source_id       TEXT,
      verified        INTEGER DEFAULT 0,
      report_count    INTEGER DEFAULT 1,
      last_reported   TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT,
      metadata        TEXT
    )
  `);

    // SafeTrace route history table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS safetrace_route_history (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      start_lat       REAL NOT NULL,
      start_lng       REAL NOT NULL,
      end_lat         REAL NOT NULL,
      end_lng         REAL NOT NULL,
      start_address   TEXT,
      end_address     TEXT,
      selected_route  TEXT NOT NULL,
      risk_score      REAL NOT NULL,
      distance        REAL NOT NULL,
      duration        REAL NOT NULL,
      completed       INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    // Track Me sessions table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS trackme_sessions (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL,
      user_name             TEXT,
      safenex_id            TEXT,
      start_time            TEXT NOT NULL,
      end_time              TEXT,
      last_lat              REAL,
      last_lng              REAL,
      last_ping_at          TEXT,
      ping_count            INTEGER DEFAULT 0,
      ended_normally        INTEGER DEFAULT 1,
      coordinates           TEXT DEFAULT '[]',
      tracking_status       TEXT NOT NULL DEFAULT 'INACTIVE',
      reconnect_token       TEXT,
      device_id             TEXT,
      tracking_token        TEXT,
      tracking_link_active  INTEGER DEFAULT 0,
      link_generated_at     TEXT,
      link_expired_at       TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

    // Idempotent migrations — add new columns to existing tables safely
    const tmMigrations = [
        `ALTER TABLE trackme_sessions ADD COLUMN tracking_status TEXT NOT NULL DEFAULT 'INACTIVE'`,
        `ALTER TABLE trackme_sessions ADD COLUMN reconnect_token TEXT`,
        `ALTER TABLE trackme_sessions ADD COLUMN device_id TEXT`,
        `ALTER TABLE trackme_sessions ADD COLUMN tracking_token TEXT`,
        `ALTER TABLE trackme_sessions ADD COLUMN tracking_link_active INTEGER DEFAULT 0`,
        `ALTER TABLE trackme_sessions ADD COLUMN link_generated_at TEXT`,
        `ALTER TABLE trackme_sessions ADD COLUMN link_expired_at TEXT`,
    ];
    for (const sql of tmMigrations) {
        try { await client.execute(sql); } catch(e) { /* column already exists — safe to ignore */ }
    }

    // Track Me pings table
    await client.execute(`
    CREATE TABLE IF NOT EXISTS trackme_pings (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      speed       REAL,
      timestamp   TEXT NOT NULL,
      in_danger   INTEGER DEFAULT 0,
      zone_id     TEXT,
      FOREIGN KEY (session_id) REFERENCES trackme_sessions(id) ON DELETE CASCADE
    )
  `);

    console.log('✅ Turso DB connected and schema ready.');
}

/** Create a new user (hashes password, checks email uniqueness) */
async function createUser({ name, email, password }) {
    const emailKey = email.toLowerCase();

    // Check uniqueness
    const existing = await client.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [emailKey],
    });
    if (existing.rows.length > 0) {
        const err = new Error('An account with this email already exists.');
        err.statusCode = 400;
        throw err;
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    await client.execute({
        sql: `INSERT INTO users (id, name, email, password, created_at)
          VALUES (?, ?, ?, ?, ?)`,
        args: [id, name.trim(), emailKey, hashedPassword, createdAt],
    });

    return { _id: id, name: name.trim(), email: emailKey, verified: false, createdAt };
}

/** Find user by email — returns mapped object or null */
async function findByEmail(email) {
    const res = await client.execute({
        sql: 'SELECT * FROM users WHERE email = ?',
        args: [email.toLowerCase()],
    });
    return res.rows.length ? mapRow(res.rows[0]) : null;
}

/** Find user by ID — returns mapped object or null */
async function findById(id) {
    const res = await client.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [id],
    });
    return res.rows.length ? mapRow(res.rows[0]) : null;
}

/** Find user by SafeNex ID — returns public user info or null */
async function findBySafeNexID(safeNexID) {
    const res = await client.execute({
        sql: 'SELECT id, name, verified, document_type, safenex_id, extracted_name, document_number, verified_at, created_at FROM users WHERE safenex_id = ?',
        args: [safeNexID],
    });
    
    if (res.rows.length === 0) return null;
    
    const row = res.rows[0];
    return {
        name: row.name,
        verified: row.verified === 1,
        documentType: row.document_type,
        safeNexID: row.safenex_id,
        extractedName: row.extracted_name,
        documentNumber: row.document_number,
        verifiedAt: row.verified_at,
        createdAt: row.created_at
    };
}

/** Update arbitrary fields on a user by ID */
async function updateUser(id, fields) {
    const allowed = [
        'verified', 'document_type', 'safenex_id', 'qr_code_path',
        'document_path', 'extracted_name', 'document_number', 'verified_at',
    ];

    // Map camelCase API fields → snake_case DB columns
    const colMap = {
        verified: 'verified',
        documentType: 'document_type',
        safeNexID: 'safenex_id',
        qrCodePath: 'qr_code_path',
        documentPath: 'document_path',
        extractedName: 'extracted_name',
        documentNumber: 'document_number',
        verifiedAt: 'verified_at',
    };

    const sets = [];
    const args = [];

    for (const [key, value] of Object.entries(fields)) {
        const col = colMap[key];
        if (!col) continue;
        sets.push(`${col} = ?`);
        // SQLite stores booleans as INTEGER
        args.push(typeof value === 'boolean' ? (value ? 1 : 0) :
            value instanceof Date ? value.toISOString() : value);
    }

    if (sets.length === 0) return;
    args.push(id);

    await client.execute({
        sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
        args,
    });
}

/** Compare plain text password against stored hash */
async function comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

/** Map a SQLite row object → consistent camelCase user shape */
function mapRow(row) {
    return {
        _id: row.id,
        name: row.name,
        email: row.email,
        password: row.password,         // kept for auth comparison
        verified: row.verified === 1,
        documentType: row.document_type || null,
        safeNexID: row.safenex_id || null,
        qrCodePath: row.qr_code_path || null,
        documentPath: row.document_path || null,
        extractedName: row.extracted_name || null,
        documentNumber: row.document_number || null,
        verifiedAt: row.verified_at || null,
        lastActiveAt: row.last_active_at || row.created_at, // Use last_active_at or fallback to created_at
        createdAt: row.created_at,
    };
}

/** Get SOS configuration for a user */
async function getSOSConfig(userId) {
    const res = await client.execute({
        sql: 'SELECT * FROM sos_configs WHERE user_id = ?',
        args: [userId],
    });

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
        primaryContact: row.primary_contact || '',
        secondaryContact: row.secondary_contact || '',
        messageTemplate: row.message_template || '',
        safeWords: row.safe_words ? JSON.parse(row.safe_words) : ['help', 'emergency', 'danger'],
        voiceActivationEnabled: row.voice_activation_enabled === 1,
        liveBeaconEnabled: row.live_beacon_enabled === 1,
        beaconUpdateInterval: row.beacon_update_interval || 60,
        batteryLevelEnabled: row.battery_level_enabled === 1,
        timestampEnabled: row.timestamp_enabled === 1,
    };
}

/** Save SOS configuration for a user */
async function saveSOSConfig(userId, config) {
    const existing = await client.execute({
        sql: 'SELECT user_id FROM sos_configs WHERE user_id = ?',
        args: [userId],
    });

    const safeWordsJson = JSON.stringify(config.safeWords || ['help', 'emergency', 'danger']);
    const updatedAt = new Date().toISOString();

    if (existing.rows.length > 0) {
        // Update
        await client.execute({
            sql: `UPDATE sos_configs SET
                primary_contact = ?,
                secondary_contact = ?,
                message_template = ?,
                safe_words = ?,
                voice_activation_enabled = ?,
                live_beacon_enabled = ?,
                beacon_update_interval = ?,
                battery_level_enabled = ?,
                timestamp_enabled = ?,
                updated_at = ?
                WHERE user_id = ?`,
            args: [
                config.primaryContact || '',
                config.secondaryContact || '',
                config.messageTemplate || '',
                safeWordsJson,
                config.voiceActivationEnabled ? 1 : 0,
                config.liveBeaconEnabled ? 1 : 0,
                config.beaconUpdateInterval || 60,
                config.batteryLevelEnabled ? 1 : 0,
                config.timestampEnabled ? 1 : 0,
                updatedAt,
                userId,
            ],
        });
    } else {
        // Insert
        await client.execute({
            sql: `INSERT INTO sos_configs (
                user_id, primary_contact, secondary_contact, message_template,
                safe_words, voice_activation_enabled, live_beacon_enabled,
                beacon_update_interval, battery_level_enabled, timestamp_enabled, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                userId,
                config.primaryContact || '',
                config.secondaryContact || '',
                config.messageTemplate || '',
                safeWordsJson,
                config.voiceActivationEnabled ? 1 : 0,
                config.liveBeaconEnabled ? 1 : 0,
                config.beaconUpdateInterval || 60,
                config.batteryLevelEnabled ? 1 : 0,
                config.timestampEnabled ? 1 : 0,
                updatedAt,
            ],
        });
    }
}

/** Save SOS emergency session */
async function saveSOSSession(session) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    await client.execute({
        sql: `INSERT INTO sos_sessions (
            id, user_id, session_id, triggered_by, start_time, end_time, events, location, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            id,
            session.userId,
            session.sessionId,
            session.triggeredBy || null,
            session.startTime.toISOString(),
            session.endTime ? session.endTime.toISOString() : null,
            session.events || null,
            session.location || null,
            createdAt,
        ],
    });
}

/** Get SOS sessions for a user */
async function getSOSSessions(userId) {
    const res = await client.execute({
        sql: 'SELECT * FROM sos_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        args: [userId],
    });

    return res.rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        triggeredBy: row.triggered_by,
        startTime: row.start_time,
        endTime: row.end_time,
        events: row.events,
        location: row.location,
        createdAt: row.created_at,
    }));
}

/** Log user activity for dashboard feed */
async function logActivity(userId, activityType, description, metadata = null) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    // Create activities table if it doesn't exist
    await client.execute(`
        CREATE TABLE IF NOT EXISTS user_activities (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            activity_type TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    await client.execute({
        sql: `INSERT INTO user_activities (id, user_id, activity_type, description, metadata, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, userId, activityType, description, metadata ? JSON.stringify(metadata) : null, createdAt],
    });

    return { id, userId, activityType, description, metadata, createdAt };
}

/** Get user activities for dashboard */
async function getUserActivities(userId, limit = 10) {
    const res = await client.execute({
        sql: 'SELECT * FROM user_activities WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        args: [userId, limit],
    });

    return res.rows.map(row => ({
        id: row.id,
        activityType: row.activity_type,
        description: row.description,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        createdAt: row.created_at,
    }));
}

// ─── Silent Room Functions ────────────────────────────────────────────────────

/** Create a new Silent Room post */
async function createSilentRoomPost({ userId, message, postType = 'general', location = null, images = [], anonymous = false, isPrivate = false }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const imagesJson = JSON.stringify(images);

    await client.execute({
        sql: `INSERT INTO silent_room_posts (id, user_id, message, post_type, location_lat, location_lng, location_address, images, anonymous, is_private, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            id,
            userId,
            message,
            postType,
            location?.latitude || null,
            location?.longitude || null,
            location?.address || null,
            imagesJson,
            anonymous ? 1 : 0,
            isPrivate ? 1 : 0,
            createdAt
        ],
    });

    return {
        id,
        userId,
        message,
        postType,
        location: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
            address: location.address,
        } : null,
        images,
        anonymous,
        isPrivate,
        likes: 0,
        comments: 0,
        views: 0,
        createdAt
    };
}

/** Get Silent Room posts with pagination and filters */
async function getSilentRoomPosts(limit = 20, offset = 0, filters = {}) {
    let sql = `SELECT p.*, u.name as user_name, u.safenex_id
               FROM silent_room_posts p
               LEFT JOIN users u ON p.user_id = u.id
               WHERE 1=1`;
    
    const args = [];

    // COMPLAINTS TAB: Show only user's private complaints (with admin responses)
    if (filters.showPrivate && filters.userId) {
        sql += ` AND p.user_id = ? AND p.is_private = 1`;
        args.push(filters.userId);
    }
    // MY POSTS TAB: Show only user's public posts (exclude private complaints)
    else if (filters.userId && !filters.showPrivate) {
        sql += ` AND p.user_id = ? AND (p.is_private = 0 OR p.is_private IS NULL)`;
        args.push(filters.userId);
    }
    // COMMUNITY FEED: Show ALL public posts (exclude ONLY private complaints)
    else if (!filters.showPrivate && !filters.userId) {
        sql += ` AND (p.is_private = 0 OR p.is_private IS NULL)`;
    }

    // Filter by post type (if specified)
    if (filters.postType && filters.postType !== 'all') {
        sql += ` AND p.post_type = ?`;
        args.push(filters.postType);
    }

    // Admin can see all posts (override all filters)
    if (filters.showAll) {
        sql = `SELECT p.*, u.name as user_name, u.safenex_id
               FROM silent_room_posts p
               LEFT JOIN users u ON p.user_id = u.id
               WHERE 1=1`;
        args.length = 0; // Clear args
        
        if (filters.postType && filters.postType !== 'all') {
            sql += ` AND p.post_type = ?`;
            args.push(filters.postType);
        }
    }

    // Sort order
    if (filters.sort === 'trending') {
        sql += ` ORDER BY (p.likes * 3 + p.comments * 2 + p.views) DESC, p.created_at DESC`;
    } else if (filters.sort === 'popular') {
        sql += ` ORDER BY p.likes DESC, p.created_at DESC`;
    } else if (filters.sort === 'discussed') {
        sql += ` ORDER BY p.comments DESC, p.created_at DESC`;
    } else {
        sql += ` ORDER BY p.created_at DESC`;
    }

    sql += ` LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const res = await client.execute({ sql, args });

    return res.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.anonymous === 1 ? 'Anonymous' : (row.user_name || 'User'),
        safeNexID: row.anonymous === 1 ? null : row.safenex_id,
        message: row.message,
        postType: row.post_type || 'general',
        location: (row.location_lat && row.location_lng) ? {
            latitude: row.location_lat,
            longitude: row.location_lng,
            address: row.location_address,
        } : null,
        images: row.images ? JSON.parse(row.images) : [],
        anonymous: row.anonymous === 1,
        isPrivate: row.is_private === 1,
        likes: row.likes || 0,
        comments: row.comments || 0,
        views: row.views || 0,
        status: row.status || 'pending',
        adminResponse: row.admin_response || null,
        adminResponseAt: row.admin_response_at || null,
        flagged: row.flagged === 1,
        reportCount: row.report_count || 0,
        createdAt: row.created_at,
    }));
}

/** Get trending posts (top posts by engagement) */
async function getTrendingPosts(limit = 5) {
    const res = await client.execute({
        sql: `SELECT p.*, u.name as user_name, u.safenex_id,
              (p.likes * 3 + p.comments * 2 + p.views) as engagement_score
              FROM silent_room_posts p
              LEFT JOIN users u ON p.user_id = u.id
              WHERE p.created_at > datetime('now', '-7 days')
              AND (p.is_private = 0 OR p.is_private IS NULL)
              ORDER BY engagement_score DESC, p.created_at DESC
              LIMIT ?`,
        args: [limit],
    });

    return res.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.anonymous === 1 ? 'Anonymous' : (row.user_name || 'User'),
        safeNexID: row.anonymous === 1 ? null : row.safenex_id,
        message: row.message,
        postType: row.post_type || 'general',
        location: (row.location_lat && row.location_lng) ? {
            latitude: row.location_lat,
            longitude: row.location_lng,
            address: row.location_address,
        } : null,
        images: row.images ? JSON.parse(row.images) : [],
        anonymous: row.anonymous === 1,
        likes: row.likes || 0,
        comments: row.comments || 0,
        views: row.views || 0,
        engagementScore: row.engagement_score || 0,
        createdAt: row.created_at,
    }));
}

/** Get post type statistics */
async function getPostTypeStats() {
    const res = await client.execute(`
        SELECT 
            post_type,
            COUNT(*) as count,
            SUM(likes) as total_likes,
            SUM(comments) as total_comments,
            SUM(views) as total_views
        FROM silent_room_posts
        WHERE is_private = 0
        GROUP BY post_type
        ORDER BY count DESC
    `);

    return res.rows.map(row => ({
        type: row.post_type || 'general',
        count: row.count || 0,
        totalLikes: row.total_likes || 0,
        totalComments: row.total_comments || 0,
        totalViews: row.total_views || 0,
    }));
}

/** Get a single Silent Room post by ID */
async function getSilentRoomPost(postId) {
    const res = await client.execute({
        sql: `SELECT p.*, u.name as user_name, u.safenex_id
              FROM silent_room_posts p
              LEFT JOIN users u ON p.user_id = u.id
              WHERE p.id = ?`,
        args: [postId],
    });

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
        id: row.id,
        userId: row.user_id,
        userName: row.anonymous === 1 ? 'Anonymous' : (row.user_name || 'User'),
        safeNexID: row.anonymous === 1 ? null : row.safenex_id,
        message: row.message,
        postType: row.post_type || 'general',
        location: (row.location_lat && row.location_lng) ? {
            latitude: row.location_lat,
            longitude: row.location_lng,
            address: row.location_address,
        } : null,
        images: row.images ? JSON.parse(row.images) : [],
        anonymous: row.anonymous === 1,
        likes: row.likes || 0,
        comments: row.comments || 0,
        views: row.views || 0,
        createdAt: row.created_at,
    };
}

/** Increment post view count */
async function incrementPostViews(postId) {
    await client.execute({
        sql: 'UPDATE silent_room_posts SET views = views + 1 WHERE id = ?',
        args: [postId],
    });
}

/** Like/Unlike a post */
async function togglePostLike(postId, userId) {
    // Check if already liked
    const existing = await client.execute({
        sql: 'SELECT id FROM silent_room_likes WHERE post_id = ? AND user_id = ?',
        args: [postId, userId],
    });

    if (existing.rows.length > 0) {
        // Unlike
        await client.execute({
            sql: 'DELETE FROM silent_room_likes WHERE post_id = ? AND user_id = ?',
            args: [postId, userId],
        });
        await client.execute({
            sql: 'UPDATE silent_room_posts SET likes = likes - 1 WHERE id = ?',
            args: [postId],
        });
        return { liked: false };
    } else {
        // Like
        const likeId = uuidv4();
        const createdAt = new Date().toISOString();
        await client.execute({
            sql: 'INSERT INTO silent_room_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)',
            args: [likeId, postId, userId, createdAt],
        });
        await client.execute({
            sql: 'UPDATE silent_room_posts SET likes = likes + 1 WHERE id = ?',
            args: [postId],
        });
        return { liked: true };
    }
}

/** Check if user has liked a post */
async function hasUserLikedPost(postId, userId) {
    const res = await client.execute({
        sql: 'SELECT id FROM silent_room_likes WHERE post_id = ? AND user_id = ?',
        args: [postId, userId],
    });
    return res.rows.length > 0;
}

/** Add a comment to a post */
async function addPostComment(postId, userId, text) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    await client.execute({
        sql: 'INSERT INTO silent_room_comments (id, post_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [id, postId, userId, text, createdAt],
    });

    await client.execute({
        sql: 'UPDATE silent_room_posts SET comments = comments + 1 WHERE id = ?',
        args: [postId],
    });

    return { id, postId, userId, text, createdAt };
}

/** Get comments for a post */
async function getPostComments(postId) {
    const res = await client.execute({
        sql: `SELECT c.*, u.name as user_name, u.safenex_id
              FROM silent_room_comments c
              LEFT JOIN users u ON c.user_id = u.id
              WHERE c.post_id = ?
              ORDER BY c.created_at DESC`,
        args: [postId],
    });

    return res.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name || 'User',
        safeNexID: row.safenex_id,
        text: row.text,
        createdAt: row.created_at,
    }));
}

/** Edit a post (only by owner) */
async function updateSilentRoomPost(postId, userId, { message, postType, location, images }) {
    // Verify ownership
    const post = await client.execute({
        sql: 'SELECT user_id FROM silent_room_posts WHERE id = ?',
        args: [postId],
    });

    if (post.rows.length === 0 || post.rows[0].user_id !== userId) {
        throw new Error('Unauthorized');
    }

    const updates = [];
    const args = [];

    if (message !== undefined) {
        updates.push('message = ?');
        args.push(message.trim());
    }

    if (postType !== undefined) {
        updates.push('post_type = ?');
        args.push(postType);
    }

    if (location !== undefined) {
        if (location === null) {
            updates.push('location_lat = NULL, location_lng = NULL, location_address = NULL');
        } else {
            updates.push('location_lat = ?, location_lng = ?, location_address = ?');
            args.push(location.latitude, location.longitude, location.address);
        }
    }

    if (images !== undefined) {
        updates.push('images = ?');
        args.push(JSON.stringify(images));
    }

    if (updates.length === 0) {
        throw new Error('No fields to update');
    }

    args.push(postId);

    await client.execute({
        sql: `UPDATE silent_room_posts SET ${updates.join(', ')} WHERE id = ?`,
        args,
    });

    return await getSilentRoomPost(postId);
}

/** Delete a post (only by owner) - Cleans up all related data */
async function deleteSilentRoomPost(postId, userId) {
    // Verify ownership
    const post = await client.execute({
        sql: 'SELECT user_id, images FROM silent_room_posts WHERE id = ?',
        args: [postId],
    });

    if (post.rows.length === 0 || post.rows[0].user_id !== userId) {
        throw new Error('Unauthorized');
    }

    // Get image paths for cleanup
    const images = post.rows[0].images ? JSON.parse(post.rows[0].images) : [];

    // Delete comments (CASCADE cleanup)
    await client.execute({
        sql: 'DELETE FROM silent_room_comments WHERE post_id = ?',
        args: [postId],
    });

    // Delete likes (CASCADE cleanup)
    await client.execute({
        sql: 'DELETE FROM silent_room_likes WHERE post_id = ?',
        args: [postId],
    });

    // Delete post
    await client.execute({
        sql: 'DELETE FROM silent_room_posts WHERE id = ?',
        args: [postId],
    });

    // Run VACUUM to reclaim space (async, non-blocking)
    try {
        await client.execute('VACUUM');
    } catch (err) {
        console.warn('VACUUM failed (non-critical):', err.message);
    }

    return { success: true, deletedImages: images };
}

// ─── Verified Danger Zones Functions ──────────────────────────────────────────

/** Get verified danger zones along a route path with geofencing */
async function getVerifiedDangerZonesAlongRoute(coordinates, bufferKm = 0.5) {
    // Validate input
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.warn('getVerifiedDangerZonesAlongRoute: Invalid or empty coordinates array');
        return [];
    }

    // Filter out invalid coordinates
    const validCoordinates = coordinates.filter(c => 
        Array.isArray(c) && c.length >= 2 && 
        typeof c[0] === 'number' && typeof c[1] === 'number'
    );

    if (validCoordinates.length === 0) {
        console.warn('getVerifiedDangerZonesAlongRoute: No valid coordinates found');
        return [];
    }

    try {
        // Calculate bounding box for the entire route with buffer
        const lats = validCoordinates.map(c => c[1]);
        const lngs = validCoordinates.map(c => c[0]);
        
        const minLat = Math.min(...lats) - bufferKm / 111;
        const maxLat = Math.max(...lats) + bufferKm / 111;
        const minLng = Math.min(...lngs) - bufferKm / (111 * Math.cos(Math.min(...lats) * Math.PI / 180));
        const maxLng = Math.max(...lngs) + bufferKm / (111 * Math.cos(Math.min(...lats) * Math.PI / 180));

        // Query verified danger zones within bounding box
        const result = await client.execute({
            sql: `
                SELECT 
                    id,
                    place_name,
                    latitude,
                    longitude,
                    risk_level,
                    category,
                    active_hours,
                    radius_meters,
                    severity_weight,
                    description,
                    source,
                    verified_by,
                    verification_date,
                    created_at,
                    updated_at
                FROM verified_danger_zones
                WHERE is_active = 1
                  AND latitude BETWEEN ? AND ?
                  AND longitude BETWEEN ? AND ?
                ORDER BY severity_weight DESC, risk_level DESC
            `,
            args: [minLat, maxLat, minLng, maxLng]
        });

        return result.rows.map(row => ({
            id: row.id,
            placeName: row.place_name,
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            riskLevel: row.risk_level,
            category: row.category,
            activeHours: row.active_hours,
            radius: row.radius_meters,
            severityWeight: parseFloat(row.severity_weight),
            description: row.description,
            source: row.source,
            verifiedBy: row.verified_by,
            verificationDate: row.verification_date,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    } catch (error) {
        console.error('Error in getVerifiedDangerZonesAlongRoute:', error);
        return [];
    }
}

/** Get all active verified danger zones for map display */
async function getAllVerifiedDangerZones() {
    try {
        const result = await client.execute(`
            SELECT 
                id,
                place_name,
                latitude,
                longitude,
                risk_level,
                category,
                active_hours,
                radius_meters,
                severity_weight,
                description
            FROM verified_danger_zones
            WHERE is_active = 1
            ORDER BY severity_weight DESC
        `);

        return result.rows.map(row => ({
            id: row.id,
            placeName: row.place_name,
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            riskLevel: row.risk_level,
            category: row.category,
            activeHours: row.active_hours,
            radius: row.radius_meters,
            severityWeight: parseFloat(row.severity_weight),
            description: row.description
        }));
    } catch (error) {
        console.error('Error in getAllVerifiedDangerZones:', error);
        return [];
    }
}

module.exports = {
    initDB,
    createUser,
    findByEmail,
    findById,
    findBySafeNexID,
    updateUser,
    comparePassword,
    getSOSConfig,
    saveSOSConfig,
    saveSOSSession,
    getSOSSessions,
    logActivity,
    getUserActivities,
    // Silent Room exports
    createSilentRoomPost,
    getSilentRoomPosts,
    getSilentRoomPost,
    getTrendingPosts,
    getPostTypeStats,
    incrementPostViews,
    togglePostLike,
    hasUserLikedPost,
    addPostComment,
    getPostComments,
    updateSilentRoomPost,
    deleteSilentRoomPost,
    // SafeTrace exports
    upsertDangerZone,
    getDangerZones,
    getDangerZonesAlongRoute,
    getVerifiedDangerZonesAlongRoute,
    getAllVerifiedDangerZones,
    cleanupExpiredZones,
    saveRouteHistory,
    getUserRouteHistory,
    markRouteCompleted,
};

// ─── SafeTrace Functions ──────────────────────────────────────────────────────

/** Create or update a danger zone */
async function upsertDangerZone({ latitude, longitude, radius = 100, severity, category, description, source, sourceId = null, metadata = null }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const lastReported = createdAt;
    
    // Calculate expiration based on severity (critical: 30 days, high: 60 days, medium: 90 days, low: 120 days)
    const expirationDays = { critical: 30, high: 60, medium: 90, low: 120 };
    const expiresAt = new Date(Date.now() + expirationDays[severity] * 24 * 60 * 60 * 1000).toISOString();

    // Check if similar zone exists nearby (within 50m)
    const nearby = await client.execute({
        sql: `SELECT id, report_count, severity FROM safetrace_danger_zones 
              WHERE ABS(latitude - ?) < 0.0005 AND ABS(longitude - ?) < 0.0005 
              AND category = ? AND expires_at > datetime('now')
              LIMIT 1`,
        args: [latitude, longitude, category],
    });

    if (nearby.rows.length > 0) {
        // Update existing zone
        const existingId = nearby.rows[0].id;
        const newReportCount = nearby.rows[0].report_count + 1;
        
        // Upgrade severity if new report is more severe
        const severityLevels = { low: 1, medium: 2, high: 3, critical: 4 };
        const currentSeverity = nearby.rows[0].severity;
        const upgradedSeverity = severityLevels[severity] > severityLevels[currentSeverity] ? severity : currentSeverity;

        await client.execute({
            sql: `UPDATE safetrace_danger_zones 
                  SET report_count = ?, last_reported = ?, severity = ?, expires_at = ?
                  WHERE id = ?`,
            args: [newReportCount, lastReported, upgradedSeverity, expiresAt, existingId],
        });

        return { id: existingId, updated: true };
    }

    // Create new zone
    await client.execute({
        sql: `INSERT INTO safetrace_danger_zones 
              (id, latitude, longitude, radius, severity, category, description, source, source_id, last_reported, created_at, expires_at, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            id, latitude, longitude, radius, severity, category, 
            description || null, source, sourceId, lastReported, createdAt, expiresAt,
            metadata ? JSON.stringify(metadata) : null
        ],
    });

    return { id, created: true };
}

/** Get active danger zones within a bounding box */
async function getDangerZones(bounds) {
    const { minLat, maxLat, minLng, maxLng } = bounds;
    
    const res = await client.execute({
        sql: `SELECT * FROM safetrace_danger_zones 
              WHERE latitude BETWEEN ? AND ? 
              AND longitude BETWEEN ? AND ?
              AND expires_at > datetime('now')
              ORDER BY severity DESC, last_reported DESC`,
        args: [minLat, maxLat, minLng, maxLng],
    });

    return res.rows.map(row => ({
        id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        radius: row.radius,
        severity: row.severity,
        category: row.category,
        description: row.description,
        source: row.source,
        verified: row.verified === 1,
        reportCount: row.report_count,
        lastReported: row.last_reported,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
}

/** Get danger zones along a route path */
async function getDangerZonesAlongRoute(coordinates, bufferKm = 0.5) {
    // Validate input
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.warn('getDangerZonesAlongRoute: Invalid or empty coordinates array');
        return [];
    }

    // Filter out invalid coordinates
    const validCoordinates = coordinates.filter(c => 
        Array.isArray(c) && c.length >= 2 && 
        typeof c[0] === 'number' && typeof c[1] === 'number'
    );

    if (validCoordinates.length === 0) {
        console.warn('getDangerZonesAlongRoute: No valid coordinates found');
        return [];
    }

    try {
        // Calculate bounding box for the entire route with buffer
        const lats = validCoordinates.map(c => c[1]);
        const lngs = validCoordinates.map(c => c[0]);
        
        const minLat = Math.min(...lats) - bufferKm / 111; // ~111km per degree latitude
        const maxLat = Math.max(...lats) + bufferKm / 111;
        const minLng = Math.min(...lngs) - bufferKm / (111 * Math.cos(Math.min(...lats) * Math.PI / 180));
        const maxLng = Math.max(...lngs) + bufferKm / (111 * Math.cos(Math.min(...lats) * Math.PI / 180));

        return await getDangerZones({ minLat, maxLat, minLng, maxLng });
    } catch (error) {
        console.error('Error in getDangerZonesAlongRoute:', error);
        return [];
    }
}

/** Clean up expired danger zones */
async function cleanupExpiredZones() {
    const result = await client.execute({
        sql: `DELETE FROM safetrace_danger_zones WHERE expires_at < datetime('now')`,
    });

    return { deleted: result.rowsAffected || 0 };
}

/** Save route history */
async function saveRouteHistory({ userId, startLat, startLng, endLat, endLng, startAddress, endAddress, selectedRoute, riskScore, distance, duration }) {
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    await client.execute({
        sql: `INSERT INTO safetrace_route_history 
              (id, user_id, start_lat, start_lng, end_lat, end_lng, start_address, end_address, selected_route, risk_score, distance, duration, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, userId, startLat, startLng, endLat, endLng, startAddress, endAddress, selectedRoute, riskScore, distance, duration, createdAt],
    });

    return { id, createdAt };
}

/** Get user route history */
async function getUserRouteHistory(userId, limit = 20) {
    const res = await client.execute({
        sql: `SELECT * FROM safetrace_route_history 
              WHERE user_id = ? 
              ORDER BY created_at DESC 
              LIMIT ?`,
        args: [userId, limit],
    });

    return res.rows.map(row => ({
        id: row.id,
        startLat: row.start_lat,
        startLng: row.start_lng,
        endLat: row.end_lat,
        endLng: row.end_lng,
        startAddress: row.start_address,
        endAddress: row.end_address,
        selectedRoute: row.selected_route,
        riskScore: row.risk_score,
        distance: row.distance,
        duration: row.duration,
        completed: row.completed === 1,
        createdAt: row.created_at,
    }));
}

/** Mark route as completed */
async function markRouteCompleted(routeId, userId) {
    await client.execute({
        sql: `UPDATE safetrace_route_history SET completed = 1 WHERE id = ? AND user_id = ?`,
        args: [routeId, userId],
    });
}


// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Get admin dashboard statistics */
async function getAdminStats() {
    // Total users
    const usersRes = await client.execute('SELECT COUNT(*) as count FROM users');
    const totalUsers = usersRes.rows[0].count;

    // Verified users
    const verifiedRes = await client.execute('SELECT COUNT(*) as count FROM users WHERE verified = 1');
    const verifiedUsers = verifiedRes.rows[0].count;

    // Total danger zones
    const zonesRes = await client.execute('SELECT COUNT(*) as count FROM verified_danger_zones');
    const totalZones = zonesRes.rows[0].count;

    // Total Silent Room posts
    const postsRes = await client.execute('SELECT COUNT(*) as count FROM silent_room_posts');
    const totalPosts = postsRes.rows[0].count;

    // Total SOS sessions
    const sosRes = await client.execute('SELECT COUNT(*) as count FROM sos_sessions');
    const totalSOS = sosRes.rows[0].count;

    // Recent activity (last 24 hours)
    const activityRes = await client.execute({
        sql: `SELECT COUNT(*) as count FROM activity_log 
              WHERE created_at >= datetime('now', '-1 day')`,
    });
    const recentActivity = activityRes.rows[0].count;

    return {
        totalUsers,
        verifiedUsers,
        unverifiedUsers: totalUsers - verifiedUsers,
        totalZones,
        totalPosts,
        totalSOS,
        recentActivity
    };
}

/** Get all users with pagination and filters */
async function getAllUsers({ page = 1, limit = 50, verified, search }) {
    let sql = 'SELECT id, name, email, verified, safenex_id, created_at, last_active_at FROM users WHERE 1=1';
    const args = [];

    if (verified !== undefined) {
        sql += ' AND verified = ?';
        args.push(verified ? 1 : 0);
    }

    if (search) {
        sql += ' AND (name LIKE ? OR email LIKE ? OR safenex_id LIKE ?)';
        const searchTerm = `%${search}%`;
        args.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, (page - 1) * limit);

    const res = await client.execute({ sql, args });

    // Get total count
    let countSql = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
    const countArgs = [];

    if (verified !== undefined) {
        countSql += ' AND verified = ?';
        countArgs.push(verified ? 1 : 0);
    }

    if (search) {
        countSql += ' AND (name LIKE ? OR email LIKE ? OR safenex_id LIKE ?)';
        const searchTerm = `%${search}%`;
        countArgs.push(searchTerm, searchTerm, searchTerm);
    }

    const countRes = await client.execute({ sql: countSql, args: countArgs });
    const total = countRes.rows[0].count;

    return {
        users: res.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            verified: row.verified === 1,
            safeNexID: row.safenex_id,
            lastActiveAt: row.last_active_at || row.created_at, // Include last_active_at
            createdAt: row.created_at
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

/** Get user by ID */
async function getUserById(userId) {
    const res = await client.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [userId]
    });

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
        _id: row.id,
        id: row.id,
        name: row.name,
        email: row.email,
        verified: row.verified === 1,
        documentType: row.document_type,
        safeNexID: row.safenex_id,
        qrCodePath: row.qr_code_path,
        documentPath: row.document_path,
        extractedName: row.extracted_name,
        documentNumber: row.document_number,
        verifiedAt: row.verified_at,
        createdAt: row.created_at
    };
}

/** Get user activity */
async function getUserActivity(userId, limit = 50) {
    try {
        const res = await client.execute({
            sql: `SELECT * FROM user_activities WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
            args: [userId, limit]
        });

        return res.rows.map(row => ({
            id: row.id,
            activityType: row.activity_type,
            description: row.description,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            createdAt: row.created_at
        }));
    } catch (error) {
        console.error('Error getting user activity:', error);
        return [];
    }
}

/** Update user verification status */
async function updateUserVerification(userId, verified) {
    const verifiedAt = verified ? new Date().toISOString() : null;
    
    await client.execute({
        sql: 'UPDATE users SET verified = ?, verified_at = ? WHERE id = ?',
        args: [verified ? 1 : 0, verifiedAt, userId]
    });
}

/** Update user ban status */
async function updateUserBanStatus(userId, banned, reason) {
    // Add banned column if it doesn't exist
    try {
        await client.execute('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE users ADD COLUMN ban_reason TEXT');
    } catch (e) {
        // Column might already exist
    }

    await client.execute({
        sql: 'UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?',
        args: [banned ? 1 : 0, reason || null, userId]
    });
}

/** Delete user permanently */
async function deleteUser(userId) {
    // Delete user and all related data (CASCADE should handle this)
    await client.execute({
        sql: 'DELETE FROM users WHERE id = ?',
        args: [userId]
    });
}

/** Get all danger zones */
async function getAllDangerZones() {
    const res = await client.execute('SELECT * FROM verified_danger_zones ORDER BY created_at DESC');
    
    return res.rows.map(row => ({
        id: row.id,
        placeName: row.place_name,
        category: row.category,
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        radius: row.radius_meters || row.radius,
        riskLevel: row.risk_level,
        severityWeight: parseFloat(row.severity_weight),
        description: row.description,
        activeHours: row.active_hours,
        reportedIncidents: row.reported_incidents,
        lastIncidentDate: row.last_incident_date,
        verifiedBy: row.verified_by,
        verificationDate: row.verification_date,
        dataSource: row.data_source,
        isActive: row.is_active === 1,
        createdAt: row.created_at
    }));
}

/** Create danger zone */
async function createDangerZone(zoneData) {
    const createdAt = new Date().toISOString();

    // Map risk level to severity weight if not provided
    const severityWeightMap = {
        'Low': 1,
        'Medium': 3,
        'High': 7,
        'Critical': 15
    };

    const severityWeight = zoneData.severityWeight || severityWeightMap[zoneData.riskLevel] || 1;

    // Note: id is AUTOINCREMENT, so we don't provide it
    const result = await client.execute({
        sql: `INSERT INTO verified_danger_zones 
              (place_name, category, latitude, longitude, radius_meters, risk_level, 
               severity_weight, description, active_hours, reported_incidents, 
               last_incident_date, verified_by, verification_date, data_source, 
               is_active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            zoneData.placeName,
            zoneData.category || 'general',
            parseFloat(zoneData.latitude),
            parseFloat(zoneData.longitude),
            parseInt(zoneData.radius) || 200,
            zoneData.riskLevel,
            severityWeight,
            zoneData.description || '',
            zoneData.activeHours || '00:00-23:59',
            parseInt(zoneData.reportedIncidents) || 0,
            zoneData.lastIncidentDate || createdAt,
            'admin',
            createdAt,
            zoneData.dataSource || 'admin',
            1,
            createdAt,
            createdAt
        ]
    });

    // Get the last inserted row id (convert BigInt to Number)
    const id = Number(result.lastInsertRowid);

    return { id, createdAt };
}

/** Update danger zone */
async function updateDangerZone(zoneId, updates) {
    const fields = [];
    const args = [];

    if (updates.placeName !== undefined) {
        fields.push('place_name = ?');
        args.push(updates.placeName);
    }
    if (updates.category !== undefined) {
        fields.push('category = ?');
        args.push(updates.category);
    }
    if (updates.latitude !== undefined) {
        fields.push('latitude = ?');
        args.push(updates.latitude);
    }
    if (updates.longitude !== undefined) {
        fields.push('longitude = ?');
        args.push(updates.longitude);
    }
    if (updates.radius !== undefined) {
        fields.push('radius = ?');
        args.push(updates.radius);
    }
    if (updates.riskLevel !== undefined) {
        fields.push('risk_level = ?');
        args.push(updates.riskLevel);
    }
    if (updates.severityWeight !== undefined) {
        fields.push('severity_weight = ?');
        args.push(updates.severityWeight);
    }
    if (updates.description !== undefined) {
        fields.push('description = ?');
        args.push(updates.description);
    }
    if (updates.activeHours !== undefined) {
        fields.push('active_hours = ?');
        args.push(updates.activeHours);
    }
    if (updates.isActive !== undefined) {
        fields.push('is_active = ?');
        args.push(updates.isActive ? 1 : 0);
    }

    if (fields.length === 0) return;

    args.push(zoneId);

    await client.execute({
        sql: `UPDATE verified_danger_zones SET ${fields.join(', ')} WHERE id = ?`,
        args
    });
}

/** Delete danger zone */
async function deleteDangerZone(zoneId) {
    await client.execute({
        sql: 'DELETE FROM verified_danger_zones WHERE id = ?',
        args: [zoneId]
    });
}

/** Get all Silent Room reports */
async function getAllSilentRoomReports({ page = 1, limit = 50, status }) {
    let sql = `SELECT p.*, u.name as user_name, u.email as user_email 
               FROM silent_room_posts p 
               LEFT JOIN users u ON p.user_id = u.id 
               WHERE 1=1`;
    const args = [];

    if (status) {
        sql += ' AND p.status = ?';
        args.push(status);
    }

    sql += ' ORDER BY p.is_private DESC, p.created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, (page - 1) * limit);

    const res = await client.execute({ sql, args });

    // Get total count
    let countSql = 'SELECT COUNT(*) as count FROM silent_room_posts WHERE 1=1';
    const countArgs = [];

    if (status) {
        countSql += ' AND status = ?';
        countArgs.push(status);
    }

    const countRes = await client.execute({ sql: countSql, args: countArgs });
    const total = countRes.rows[0].count;

    return {
        reports: res.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            userName: row.anonymous === 1 ? 'Anonymous' : (row.user_name || 'User'),
            userEmail: row.user_email,
            message: row.message,
            postType: row.post_type,
            locationLat: row.location_lat,
            locationLng: row.location_lng,
            locationAddress: row.location_address,
            images: row.images ? JSON.parse(row.images) : [],
            anonymous: row.anonymous === 1,
            isPrivate: row.is_private === 1,
            likes: row.likes || 0,
            comments: row.comments || 0,
            views: row.views || 0,
            status: row.status || 'pending',
            adminResponse: row.admin_response || null,
            adminResponseAt: row.admin_response_at || null,
            flagged: row.flagged === 1,
            reportCount: row.report_count || 0,
            createdAt: row.created_at
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

/** Moderate Silent Room report */
async function moderateSilentRoomReport(reportId, action, reason, adminId) {
    if (action === 'delete') {
        await client.execute({
            sql: 'DELETE FROM silent_room_posts WHERE id = ?',
            args: [reportId]
        });
    } else {
        await client.execute({
            sql: 'UPDATE silent_room_posts SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ? WHERE id = ?',
            args: [action, reason, adminId, new Date().toISOString(), reportId]
        });
    }
}

/** Add admin response to a Silent Room post */
async function addAdminResponseToPost(postId, response, status, adminId) {
    // Add admin_response column if it doesn't exist
    try {
        await client.execute('ALTER TABLE silent_room_posts ADD COLUMN admin_response TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE silent_room_posts ADD COLUMN admin_response_at TEXT');
    } catch (e) {
        // Column might already exist
    }

    const now = new Date().toISOString();

    await client.execute({
        sql: `UPDATE silent_room_posts 
              SET admin_response = ?, 
                  admin_response_at = ?, 
                  status = ?, 
                  moderated_by = ?, 
                  moderated_at = ? 
              WHERE id = ?`,
        args: [response, now, status, adminId, now, postId]
    });
}

/** Get activity logs */
async function getActivityLogs({ page = 1, limit = 100, userId, action }) {
    let sql = `SELECT a.*, u.name as user_name, u.email as user_email 
               FROM activity_log a 
               LEFT JOIN users u ON a.user_id = u.id 
               WHERE 1=1`;
    const args = [];

    if (userId) {
        sql += ' AND a.user_id = ?';
        args.push(userId);
    }

    if (action) {
        sql += ' AND a.action = ?';
        args.push(action);
    }

    sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, (page - 1) * limit);

    const res = await client.execute({ sql, args });

    return {
        logs: res.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            userName: row.user_name,
            userEmail: row.user_email,
            action: row.action,
            description: row.description,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            createdAt: row.created_at
        })),
        pagination: {
            page,
            limit
        }
    };
}

/** Log activity to activity_log table */
async function logAdminActivity(userId, action, description, metadata = null, ipAddress = null, userAgent = null) {
    try {
        // Ensure all values are properly typed for LibSQL
        const safeUserId = userId ? String(userId) : null;
        const safeAction = action ? String(action) : 'unknown';
        const safeDescription = description ? String(description) : '';
        
        // Convert BigInt values in metadata to Number before stringifying
        let safeMetadata = null;
        if (metadata) {
            const cleanMetadata = JSON.parse(JSON.stringify(metadata, (key, value) =>
                typeof value === 'bigint' ? Number(value) : value
            ));
            safeMetadata = JSON.stringify(cleanMetadata);
        }
        
        const safeIpAddress = ipAddress ? String(ipAddress) : null;
        const safeUserAgent = userAgent ? String(userAgent) : null;

        await client.execute({
            sql: `INSERT INTO activity_log (user_id, action, description, metadata, ip_address, user_agent)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
                safeUserId,
                safeAction,
                safeDescription,
                safeMetadata,
                safeIpAddress,
                safeUserAgent
            ]
        });
    } catch (error) {
        console.error('Error logging activity:', error);
        // Don't throw - logging should not break the main operation
    }
}

// Export admin functions
module.exports.getAdminStats = getAdminStats;
module.exports.getAllUsers = getAllUsers;
module.exports.getUserById = getUserById;
module.exports.getUserActivity = getUserActivity;
module.exports.updateUserVerification = updateUserVerification;
module.exports.updateUserBanStatus = updateUserBanStatus;
module.exports.deleteUser = deleteUser;
module.exports.getAllDangerZones = getAllDangerZones;
module.exports.createDangerZone = createDangerZone;
module.exports.updateDangerZone = updateDangerZone;
module.exports.deleteDangerZone = deleteDangerZone;
module.exports.getAllSilentRoomReports = getAllSilentRoomReports;
module.exports.moderateSilentRoomReport = moderateSilentRoomReport;
module.exports.addAdminResponseToPost = addAdminResponseToPost;
module.exports.getActivityLogs = getActivityLogs;
module.exports.logAdminActivity = logAdminActivity;

/** Get all SOS sessions with user details for admin */
async function getAllSOSSessions({ page = 1, limit = 100, status, timeFilter }) {
    let sql = `SELECT s.*, u.name as user_name, u.email as user_email, u.safenex_id,
               c.primary_contact, c.secondary_contact
               FROM sos_sessions s
               LEFT JOIN users u ON s.user_id = u.id
               LEFT JOIN sos_configs c ON s.user_id = c.user_id
               WHERE 1=1`;
    const args = [];

    // Time filter
    if (timeFilter === 'today') {
        sql += ` AND DATE(s.created_at) = DATE('now')`;
    } else if (timeFilter === 'week') {
        sql += ` AND s.created_at >= datetime('now', '-7 days')`;
    } else if (timeFilter === 'month') {
        sql += ` AND s.created_at >= datetime('now', '-30 days')`;
    }

    // Status filter (active = no end_time, resolved = has end_time, false_alarm = false_alarm = 1)
    if (status === 'active') {
        sql += ` AND s.end_time IS NULL`;
    } else if (status === 'resolved') {
        sql += ` AND s.end_time IS NOT NULL AND (s.false_alarm IS NULL OR s.false_alarm = 0)`;
    } else if (status === 'false_alarm') {
        sql += ` AND s.false_alarm = 1`;
    }

    sql += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
    args.push(limit, (page - 1) * limit);

    const res = await client.execute({ sql, args });

    // Get total count
    let countSql = `SELECT COUNT(*) as count FROM sos_sessions s WHERE 1=1`;
    const countArgs = [];

    if (timeFilter === 'today') {
        countSql += ` AND DATE(s.created_at) = DATE('now')`;
    } else if (timeFilter === 'week') {
        countSql += ` AND s.created_at >= datetime('now', '-7 days')`;
    } else if (timeFilter === 'month') {
        countSql += ` AND s.created_at >= datetime('now', '-30 days')`;
    }

    if (status === 'active') {
        countSql += ` AND s.end_time IS NULL`;
    } else if (status === 'resolved') {
        countSql += ` AND s.end_time IS NOT NULL AND (s.false_alarm IS NULL OR s.false_alarm = 0)`;
    } else if (status === 'false_alarm') {
        countSql += ` AND s.false_alarm = 1`;
    }

    const countRes = await client.execute({ sql: countSql, args: countArgs });
    const total = countRes.rows[0].count;

    return {
        sessions: res.rows.map(row => {
            let location = null;
            let events = null;

            try {
                location = row.location ? JSON.parse(row.location) : null;
            } catch (e) {
                location = null;
            }

            try {
                events = row.events ? JSON.parse(row.events) : null;
            } catch (e) {
                events = null;
            }

            return {
                id: row.id,
                userId: row.user_id,
                userName: row.user_name || 'Unknown User',
                userEmail: row.user_email || 'N/A',
                safeNexID: row.safenex_id || 'N/A',
                sessionId: row.session_id,
                triggeredBy: row.triggered_by || 'manual',
                startTime: row.start_time,
                endTime: row.end_time,
                duration: row.end_time ? 
                    Math.floor((new Date(row.end_time) - new Date(row.start_time)) / 1000) : null,
                events: events,
                location: location,
                primaryContact: row.primary_contact || 'Not Set',
                secondaryContact: row.secondary_contact || 'Not Set',
                status: row.false_alarm === 1 ? 'false_alarm' : (row.end_time ? 'resolved' : 'active'),
                falseAlarm: row.false_alarm === 1,
                adminNotes: row.admin_notes || null,
                createdAt: row.created_at
            };
        }),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

module.exports.getAllSOSSessions = getAllSOSSessions;

/** Report a Silent Room post */
async function reportSilentRoomPost(postId, userId) {
    // Add flagged and report_count columns if they don't exist
    try {
        await client.execute('ALTER TABLE silent_room_posts ADD COLUMN flagged INTEGER DEFAULT 0');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE silent_room_posts ADD COLUMN report_count INTEGER DEFAULT 0');
    } catch (e) {
        // Column might already exist
    }

    // Check if user already reported this post
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS silent_room_reports (
                id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (post_id) REFERENCES silent_room_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(post_id, user_id)
            )
        `);
    } catch (e) {
        // Table might already exist
    }

    // Check if already reported by this user
    const existing = await client.execute({
        sql: 'SELECT id FROM silent_room_reports WHERE post_id = ? AND user_id = ?',
        args: [postId, userId]
    });

    if (existing.rows.length > 0) {
        throw new Error('You have already reported this post');
    }

    // Add report
    const reportId = uuidv4();
    const createdAt = new Date().toISOString();

    await client.execute({
        sql: 'INSERT INTO silent_room_reports (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        args: [reportId, postId, userId, createdAt]
    });

    // Increment report count and flag if >= 3 reports
    await client.execute({
        sql: `UPDATE silent_room_posts 
              SET report_count = report_count + 1,
                  flagged = CASE WHEN report_count + 1 >= 3 THEN 1 ELSE flagged END
              WHERE id = ?`,
        args: [postId]
    });

    return { success: true, reportId };
}

module.exports.reportSilentRoomPost = reportSilentRoomPost;

/** Get detailed information for a specific SOS session */
async function getSOSSessionDetails(sessionId) {
    const res = await client.execute({
        sql: `SELECT s.*, u.name as user_name, u.email as user_email, u.safenex_id,
              c.primary_contact, c.secondary_contact, c.message_template
              FROM sos_sessions s
              LEFT JOIN users u ON s.user_id = u.id
              LEFT JOIN sos_configs c ON s.user_id = c.user_id
              WHERE s.id = ?`,
        args: [sessionId]
    });

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    let location = null;
    let events = null;

    try {
        location = row.location ? JSON.parse(row.location) : null;
    } catch (e) {
        location = null;
    }

    try {
        events = row.events ? JSON.parse(row.events) : null;
    } catch (e) {
        events = null;
    }

    return {
        id: row.id,
        userId: row.user_id,
        userName: row.user_name || 'Unknown User',
        userEmail: row.user_email || 'N/A',
        safeNexID: row.safenex_id || 'N/A',
        sessionId: row.session_id,
        triggeredBy: row.triggered_by || 'manual',
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.end_time ? 
            Math.floor((new Date(row.end_time) - new Date(row.start_time)) / 1000) : null,
        events: events,
        location: location,
        primaryContact: row.primary_contact || 'Not Set',
        secondaryContact: row.secondary_contact || 'Not Set',
        messageTemplate: row.message_template || 'Emergency! I need help.',
        status: row.end_time ? 'resolved' : 'active',
        falseAlarm: row.false_alarm === 1,
        adminNotes: row.admin_notes || null,
        resolvedBy: row.resolved_by || null,
        resolvedAt: row.resolved_at || null,
        createdAt: row.created_at
    };
}

module.exports.getSOSSessionDetails = getSOSSessionDetails;

/** Resolve an SOS session */
async function resolveSOSSession(sessionId, notes = null) {
    // Add columns if they don't exist
    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN admin_notes TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN resolved_by TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN resolved_at TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN false_alarm INTEGER DEFAULT 0');
    } catch (e) {
        // Column might already exist
    }

    const endTime = new Date().toISOString();
    const resolvedAt = new Date().toISOString();

    await client.execute({
        sql: `UPDATE sos_sessions 
              SET end_time = ?, 
                  admin_notes = ?,
                  resolved_at = ?
              WHERE id = ?`,
        args: [endTime, notes, resolvedAt, sessionId]
    });

    return { success: true };
}

module.exports.resolveSOSSession = resolveSOSSession;

/** Mark an SOS session as false alarm */
async function markSOSSessionAsFalseAlarm(sessionId, reason = null) {
    // Add columns if they don't exist
    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN false_alarm INTEGER DEFAULT 0');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN admin_notes TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN resolved_at TEXT');
    } catch (e) {
        // Column might already exist
    }

    const endTime = new Date().toISOString();
    const resolvedAt = new Date().toISOString();
    const notes = reason ? `FALSE ALARM: ${reason}` : 'FALSE ALARM';

    await client.execute({
        sql: `UPDATE sos_sessions 
              SET end_time = ?, 
                  false_alarm = 1,
                  admin_notes = ?,
                  resolved_at = ?
              WHERE id = ?`,
        args: [endTime, notes, resolvedAt, sessionId]
    });

    return { success: true };
}

module.exports.markSOSSessionAsFalseAlarm = markSOSSessionAsFalseAlarm;

/** Add admin notes to an SOS session */
async function addSOSSessionNotes(sessionId, notes, adminId) {
    // Add columns if they don't exist
    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN admin_notes TEXT');
    } catch (e) {
        // Column might already exist
    }

    try {
        await client.execute('ALTER TABLE sos_sessions ADD COLUMN resolved_by TEXT');
    } catch (e) {
        // Column might already exist
    }

    await client.execute({
        sql: `UPDATE sos_sessions 
              SET admin_notes = ?,
                  resolved_by = ?
              WHERE id = ?`,
        args: [notes, adminId, sessionId]
    });

    return { success: true };
}

module.exports.addSOSSessionNotes = addSOSSessionNotes;

/** Update user's last active timestamp */
async function updateLastActive(userId) {
    try {
        const now = new Date().toISOString();
        await client.execute({
            sql: 'UPDATE users SET last_active_at = ? WHERE id = ?',
            args: [now, userId]
        });
    } catch (error) {
        // Silently fail - this is not critical
        console.error('Error updating last active:', error.message);
    }
}

module.exports.updateLastActive = updateLastActive;

// ─── Track Me Functions ───────────────────────────────────────────────────────

/** Start a new Track Me session for a user (auto-closes any existing active session first) */
async function startTrackMeSession(userId, userName, safeNexId, deviceId) {
    // ── Dedup guard: close any still-open session for this user ──────────────
    // Mark old open sessions INACTIVE so they don't appear in the admin list.
    await client.execute({
        sql: `UPDATE trackme_sessions
              SET end_time = ?, ended_normally = 0, tracking_status = 'INACTIVE'
              WHERE user_id = ? AND tracking_status = 'ACTIVE'`,
        args: [new Date().toISOString(), userId],
    });

    const id = uuidv4();
    const reconnectToken = uuidv4(); // unique token for resuming session
    const startTime = new Date().toISOString();

    await client.execute({
        sql: `INSERT INTO trackme_sessions
              (id, user_id, user_name, safenex_id, start_time, coordinates,
               tracking_status, reconnect_token, device_id, created_at)
              VALUES (?, ?, ?, ?, ?, '[]', 'ACTIVE', ?, ?, ?)`,
        args: [id, userId, userName || null, safeNexId || null, startTime,
               reconnectToken, deviceId || null, startTime],
    });

    return { sessionId: id, startTime, reconnectToken };
}

module.exports.startTrackMeSession = startTrackMeSession;

/** Update a Track Me session with new location ping */
async function updateTrackMeSession(sessionId, userId, lat, lng, speed, inDanger, zoneId) {
    const pingId = uuidv4();
    const timestamp = new Date().toISOString();

    // Insert ping record
    await client.execute({
        sql: `INSERT INTO trackme_pings (id, session_id, user_id, lat, lng, speed, timestamp, in_danger, zone_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [pingId, sessionId, userId, lat, lng, speed || null, timestamp, inDanger ? 1 : 0, zoneId || null],
    });

    // Get existing coordinates
    const sessionRes = await client.execute({
        sql: 'SELECT coordinates, ping_count FROM trackme_sessions WHERE id = ?',
        args: [sessionId],
    });

    if (sessionRes.rows.length === 0) return null;

    let coords = [];
    try {
        coords = JSON.parse(sessionRes.rows[0].coordinates || '[]');
    } catch (e) { coords = []; }

    // Append new coordinate (keep last 500 points max)
    coords.push({ lat, lng, ts: timestamp, speed: speed || 0, inDanger: !!inDanger });
    if (coords.length > 500) coords = coords.slice(-500);

    // Update session
    await client.execute({
        sql: `UPDATE trackme_sessions SET
              last_lat = ?, last_lng = ?, last_ping_at = ?,
              ping_count = ping_count + 1, coordinates = ?
              WHERE id = ?`,
        args: [lat, lng, timestamp, JSON.stringify(coords), sessionId],
    });

    return { pingId, timestamp, pingCount: (sessionRes.rows[0].ping_count || 0) + 1 };
}

module.exports.updateTrackMeSession = updateTrackMeSession;

/** Get a single Track Me session by ID */
async function getTrackMeSession(sessionId) {
    const res = await client.execute({
        sql: 'SELECT * FROM trackme_sessions WHERE id = ?',
        args: [sessionId],
    });
    
    if (res.rows.length === 0) {
        return null;
    }
    
    const row = res.rows[0];
    return {
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        safeNexId: row.safenex_id,
        startTime: row.start_time,
        endTime: row.end_time,
        lastLat: row.last_lat,
        lastLng: row.last_lng,
        lastPingAt: row.last_ping_at,
        pingCount: row.ping_count,
        coordinates: row.coordinates ? JSON.parse(row.coordinates) : [],
        endedNormally: row.ended_normally,
        trackingStatus: row.tracking_status,
        reconnectToken: row.reconnect_token,
        deviceId: row.device_id,
        inDanger: row.in_danger,
        dangerZoneId: row.danger_zone_id,
    };
}

module.exports.getTrackMeSession = getTrackMeSession;

/** End a Track Me session — the ONLY way to mark a session INACTIVE */
async function endTrackMeSession(sessionId, endedNormally = true) {
    const endTime = new Date().toISOString();

    await client.execute({
        sql: `UPDATE trackme_sessions
              SET end_time = ?, ended_normally = ?, tracking_status = 'INACTIVE'
              WHERE id = ?`,
        args: [endTime, endedNormally ? 1 : 0, sessionId],
    });

    return { endTime };
}

module.exports.endTrackMeSession = endTrackMeSession;

/**
 * Get the currently ACTIVE session for a specific user.
 * Called by the client on every page load to check if tracking should be resumed.
 * Returns null if no active session exists.
 */
async function getActiveSessionForUser(userId) {
    const res = await client.execute({
        sql: `SELECT id, start_time, last_lat, last_lng, last_ping_at, ping_count,
                     reconnect_token, tracking_status
              FROM trackme_sessions
              WHERE user_id = ? AND tracking_status = 'ACTIVE'
              ORDER BY start_time DESC
              LIMIT 1`,
        args: [userId],
    });

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
        sessionId: row.id,
        startTime: row.start_time,
        lastLat: row.last_lat,
        lastLng: row.last_lng,
        lastPingAt: row.last_ping_at,
        pingCount: row.ping_count || 0,
        reconnectToken: row.reconnect_token,
        trackingStatus: row.tracking_status,
    };
}

module.exports.getActiveSessionForUser = getActiveSessionForUser;

/** Get all currently ACTIVE Track Me sessions, one per unique user (latest session wins) */
async function getActiveTrackMeSessions() {
    // Filter by tracking_status = 'ACTIVE' (server-authoritative field).
    // Guarantees exactly one row per unique tracked user via the correlated subquery.
    const res = await client.execute(`
        SELECT ts.*, u.name as u_name, u.safenex_id as u_snx_id
        FROM trackme_sessions ts
        LEFT JOIN users u ON ts.user_id = u.id
        WHERE ts.tracking_status = 'ACTIVE'
          AND ts.start_time = (
              SELECT MAX(start_time)
              FROM trackme_sessions t2
              WHERE t2.user_id = ts.user_id
                AND t2.tracking_status = 'ACTIVE'
          )
        ORDER BY ts.start_time DESC
    `);

    return res.rows.map(row => ({
        sessionId: row.id,
        userId: row.user_id,
        userName: row.user_name || row.u_name || 'Unknown',
        safeNexId: row.safenex_id || row.u_snx_id || null,
        startTime: row.start_time,
        lastLat: row.last_lat,
        lastLng: row.last_lng,
        lastPingAt: row.last_ping_at,
        pingCount: row.ping_count || 0,
        trackingStatus: row.tracking_status || 'ACTIVE',
        coordinates: (() => { try { return JSON.parse(row.coordinates || '[]'); } catch(e){ return []; } })(),
    }));
}

module.exports.getActiveTrackMeSessions = getActiveTrackMeSessions;

/** Get Track Me session history for a user */
async function getTrackMeSessionHistory(userId, limit = 20) {
    const res = await client.execute({
        sql: `SELECT * FROM trackme_sessions WHERE user_id = ?
              ORDER BY created_at DESC LIMIT ?`,
        args: [userId, limit],
    });

    return res.rows.map(row => ({
        sessionId: row.id,
        startTime: row.start_time,
        endTime: row.end_time,
        lastLat: row.last_lat,
        lastLng: row.last_lng,
        pingCount: row.ping_count || 0,
        endedNormally: row.ended_normally === 1,
        coordinates: (() => { try { return JSON.parse(row.coordinates || '[]'); } catch(e){ return []; } })(),
        createdAt: row.created_at,
    }));
}

module.exports.getTrackMeSessionHistory = getTrackMeSessionHistory;

// ─── Share Link helpers ───────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 32-byte hex token, attach it to the
 * user's active session and mark the link as active.
 * Returns { token, sessionId } or null if no active session exists.
 */
async function generateShareLink(userId) {
    const crypto = require('crypto');

    // Find latest ACTIVE session for user
    const sessionRes = await client.execute({
        sql: `SELECT id FROM trackme_sessions
              WHERE user_id = ? AND tracking_status = 'ACTIVE'
              ORDER BY start_time DESC LIMIT 1`,
        args: [userId],
    });
    if (sessionRes.rows.length === 0) return null;

    const sessionId = sessionRes.rows[0].id;

    // Generate unique token (retry on the extremely unlikely collision)
    let token;
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = crypto.randomBytes(32).toString('hex'); // 64-char hex
        const clash = await client.execute({
            sql: `SELECT id FROM trackme_sessions WHERE tracking_token = ? LIMIT 1`,
            args: [candidate],
        });
        if (clash.rows.length === 0) { token = candidate; break; }
    }
    if (!token) throw new Error('Failed to generate unique tracking token');

    const now = new Date().toISOString();
    await client.execute({
        sql: `UPDATE trackme_sessions
              SET tracking_token = ?, tracking_link_active = 1, link_generated_at = ?, link_expired_at = NULL
              WHERE id = ?`,
        args: [token, now, sessionId],
    });

    return { token, sessionId };
}

module.exports.generateShareLink = generateShareLink;

/**
 * Expire the share link for the user's session.
 * Sets tracking_link_active = 0 and records expiry timestamp.
 */
async function expireShareLink(userId) {
    const now = new Date().toISOString();
    await client.execute({
        sql: `UPDATE trackme_sessions
              SET tracking_link_active = 0, link_expired_at = ?
              WHERE user_id = ? AND tracking_status = 'ACTIVE'`,
        args: [now, userId],
    });
}

module.exports.expireShareLink = expireShareLink;

/**
 * Public lookup by tracking token — used by the live viewer page.
 * No authentication required.
 * Returns null if token not found.
 */
async function getSessionByToken(token) {
    const res = await client.execute({
        sql: `SELECT ts.id, ts.user_id, ts.user_name, ts.safenex_id,
                     ts.last_lat, ts.last_lng, ts.last_ping_at, ts.ping_count,
                     ts.start_time, ts.end_time, ts.tracking_status,
                     ts.tracking_link_active, ts.link_generated_at, ts.link_expired_at
              FROM trackme_sessions ts
              WHERE ts.tracking_token = ?
              LIMIT 1`,
        args: [token],
    });
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
        sessionId:          row.id,
        userId:             row.user_id,
        userName:           row.user_name || 'SafeNex User',
        safeNexId:          row.safenex_id || null,
        lastLat:            row.last_lat,
        lastLng:            row.last_lng,
        lastPingAt:         row.last_ping_at,
        pingCount:          row.ping_count || 0,
        startTime:          row.start_time,
        endTime:            row.end_time,
        trackingStatus:     row.tracking_status,
        isActive:           row.tracking_link_active === 1,
        linkGeneratedAt:    row.link_generated_at,
        linkExpiredAt:      row.link_expired_at,
    };
}

module.exports.getSessionByToken = getSessionByToken;

/**
 * Get the active share link token for a specific user.
 * Used by GET /api/trackme/session-link to restore the link on page reload.
 */
async function getSessionByTokenForUser(userId) {
    const res = await client.execute({
        sql: `SELECT tracking_token, tracking_link_active
              FROM trackme_sessions
              WHERE user_id = ? AND tracking_status = 'ACTIVE'
              ORDER BY start_time DESC LIMIT 1`,
        args: [userId],
    });
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
        token: row.tracking_token,
        isLinkActive: row.tracking_link_active === 1,
    };
}

module.exports.getSessionByTokenForUser = getSessionByTokenForUser;

/**
 * Auto-expire any share links that have been active for more than 24 hours.
 * Called periodically from server.js as a safety net.
 */
async function expireStaleShareLinks() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await client.execute({
        sql: `UPDATE trackme_sessions
              SET tracking_link_active = 0, link_expired_at = ?
              WHERE tracking_link_active = 1
                AND link_generated_at < ?`,
        args: [new Date().toISOString(), cutoff],
    });
}

module.exports.expireStaleShareLinks = expireStaleShareLinks;

