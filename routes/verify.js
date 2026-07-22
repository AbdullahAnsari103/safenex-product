const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { verifyDocument } = require('../services/geminiVerify');
const { generateQRCode } = require('../services/qr');
const { generateSafeNexID } = require('../services/safenexId');
const store = require('../store/db');
const fs = require('fs');

/**
 * Get the actual host URL including dev tunnels, ngrok, etc.
 * Checks forwarded headers that tunnels provide
 */
function getActualHost(req) {
    // Check for forwarded host (used by ngrok, dev tunnels, proxies)
    const forwardedHost = req.get('x-forwarded-host') || req.get('x-original-host');
    if (forwardedHost) {
        return forwardedHost;
    }
    
    // Check for forwarded proto (http/https)
    const forwardedProto = req.get('x-forwarded-proto');
    
    // Return the actual host
    return req.get('host');
}

/**
 * Get the actual protocol including dev tunnels
 */
function getActualProtocol(req) {
    // Check for forwarded protocol
    const forwardedProto = req.get('x-forwarded-proto');
    if (forwardedProto) {
        return forwardedProto;
    }
    
    // Check if connection is secure
    if (req.secure || req.get('x-forwarded-ssl') === 'on') {
        return 'https';
    }
    
    return req.protocol;
}

/**
 * Generate verification URL for user ID QR Code.
 * Encodes the devtunnel host URL so external mobile QR scanners open the live verification link directly.
 */
function generateVerificationURL(req, safeNexID) {
    const baseUrl = (process.env.PUBLIC_URL || process.env.DEV_TUNNEL_URL || process.env.BASE_URL || 'https://safenex-six.vercel.app').replace(/\/+$/, '');
    return `${baseUrl}/verify-user.html?id=${safeNexID}`;
}

// POST /api/verify/document
router.post('/document', protect, upload.single('document'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No document file uploaded.' });
        }

        if (req.user.verified) {
            return res.status(400).json({
                success: false,
                message: 'Your identity has already been verified.',
                safeNexID: req.user.safeNexID,
                qrCodeURL: req.user.qrCodePath || null, // already a base64 data URL
            });
        }

        const { documentType } = req.body;
        if (!documentType || !['aadhaar', 'passport'].includes(documentType)) {
            try { fs.unlinkSync(req.file.path); } catch (_) { }
            return res.status(400).json({ success: false, message: 'Please specify documentType: "aadhaar" or "passport".' });
        }

        const verificationResult = await verifyDocument(req.file.path, documentType);

        if (!verificationResult.valid) {
            try { fs.unlinkSync(req.file.path); } catch (_) { }
            return res.status(422).json({
                success: false,
                message: verificationResult.reason || 'Document verification failed.',
                details: verificationResult.details || null,
            });
        }

        const safeNexID = generateSafeNexID();
        
        // Generate verification URL for QR code (with proper tunnel/proxy detection)
        const verificationURL = generateVerificationURL(req, safeNexID);
        
        // QR code will contain the verification URL
        const qrCodeDataURL = await generateQRCode(verificationURL);

        await store.updateUser(req.user._id, {
            verified: true,
            documentType,
            safeNexID,
            qrCodePath: qrCodeDataURL,   // store the data URL directly
            documentPath: req.file.path,
            extractedName: verificationResult.extractedName || req.user.name,
            documentNumber: verificationResult.documentNumber || null,
            verifiedAt: new Date(),
        });

        res.status(200).json({
            success: true,
            message: 'Identity verified successfully.',
            verified: true,
            safeNexID,
            qrCodeURL: qrCodeDataURL,    // sent directly to frontend as img src
            verificationURL,              // URL that QR code points to
            extractedName: verificationResult.extractedName,
            documentNumber: verificationResult.documentNumber,
            documentType,
            verifiedAt: new Date().toISOString(),
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (_) { }
        }
        next(error);
    }
});

// GET /api/verify/status
router.get('/status', protect, (req, res) => {
    res.status(200).json({
        success: true,
        verified: req.user.verified,
        safeNexID: req.user.safeNexID || null,
        documentType: req.user.documentType || null,
        qrCodeURL: req.user.qrCodePath || null, // already a base64 data URL
        verifiedAt: req.user.verifiedAt || null,
    });
});

// POST /api/verify/regenerate-qr - Regenerate QR code with current URL
router.post('/regenerate-qr', protect, async (req, res, next) => {
    try {
        // Check if user is verified
        if (!req.user.verified || !req.user.safeNexID) {
            return res.status(400).json({
                success: false,
                message: 'User must be verified to regenerate QR code'
            });
        }

        // Generate verification URL using current request host (with proper tunnel/proxy detection)
        const verificationURL = generateVerificationURL(req, req.user.safeNexID);
        
        // Generate new QR code
        const qrCodeDataURL = await generateQRCode(verificationURL);

        // Update database
        await store.updateUser(req.user._id, {
            qrCodePath: qrCodeDataURL
        });

        res.status(200).json({
            success: true,
            message: 'QR code regenerated successfully',
            qrCodeURL: qrCodeDataURL,
            verificationURL
        });
    } catch (error) {
        next(error);
    }
});

// GET /api/verify/user/:safeNexID - Public endpoint to verify user by SafeNex ID
router.get('/user/:safeNexID', async (req, res, next) => {
    try {
        const { safeNexID } = req.params;

        if (!safeNexID) {
            return res.status(400).json({
                success: false,
                message: 'SafeNex ID is required'
            });
        }

        // Find user by SafeNex ID using store function
        const user = await store.findBySafeNexID(safeNexID);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found with this SafeNex ID'
            });
        }

        // Return public information
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
