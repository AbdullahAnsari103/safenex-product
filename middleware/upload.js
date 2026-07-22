const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Determine temporary upload directory safely for read-only / serverless environments (like Vercel)
function getUploadsDir() {
    if (process.env.VERCEL) {
        return os.tmpdir();
    }
    const localDir = path.join(__dirname, '..', 'uploads');
    try {
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        return localDir;
    } catch (err) {
        console.warn('[Upload Middleware] Cannot write to local uploads directory, falling back to os.tmpdir():', err.message);
        return os.tmpdir();
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, getUploadsDir());
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        // Use different prefix based on file type
        const prefix = file.mimetype.startsWith('image/') ? 'img' : 'doc';
        cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    },
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        const err = new Error('Invalid file type. Only JPG, PNG, WebP, and PDF files are allowed.');
        err.statusCode = 400;
        cb(err, false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
    },
});

module.exports = upload;
