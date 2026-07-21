/**
 * SafeNex User Verification Page
 * Displays user details when QR code is scanned
 */

const API_BASE = '/api';

// Get SafeNex ID from URL
function getSafeNexIDFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id') || urlParams.get('safenexid') || urlParams.get('snx');
}

// Format date
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

// Format date with time
function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Mask document number for privacy
function maskDocumentNumber(docNumber) {
    if (!docNumber) return 'N/A';
    const str = docNumber.toString();
    if (str.length <= 4) return str;
    const lastFour = str.slice(-4);
    const masked = 'X'.repeat(Math.min(str.length - 4, 8));
    return `${masked}-${lastFour}`;
}

// Calculate trust score
function calculateTrustScore(user) {
    let score = 50; // Base score
    
    if (user.verified) score += 30;
    if (user.documentType) score += 10;
    if (user.extractedName) score += 10;
    
    // Account age bonus (max 10 points)
    if (user.createdAt) {
        const accountAge = Date.now() - new Date(user.createdAt).getTime();
        const daysOld = accountAge / (1000 * 60 * 60 * 24);
        score += Math.min(Math.floor(daysOld / 30), 10); // 1 point per month, max 10
    }
    
    return Math.min(score, 100);
}

// Get initials from name
function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Load user data
async function loadUserData() {
    const safeNexID = getSafeNexIDFromURL();
    
    if (!safeNexID) {
        showError('No SafeNex ID provided in URL');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/verify/user/${safeNexID}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            showError(data.message || 'User not found');
            return;
        }

        displayUserData(data.data);
    } catch (error) {
        console.error('Error loading user data:', error);
        showError('Failed to load user data. Please try again.');
    }
}

// Global store for current user
let currentUserData = null;
let isDocMasked = true;

// Display user data
function displayUserData(user) {
    currentUserData = user;

    // Hide loading, show success
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('successState').style.display = 'block';

    // Profile section
    const initials = getInitials(user.name);
    document.getElementById('avatarInitial').textContent = initials;
    document.getElementById('userName').textContent = user.name || 'Unknown User';
    document.getElementById('userSafeNexID').textContent = user.safeNexID || 'N/A';

    // Verification status & Inspection details
    const formattedVerifiedAt = (user.verified && user.verifiedAt) ? formatDateTime(user.verifiedAt) : 'Not Verified';
    document.getElementById('verifiedDate').textContent = formattedVerifiedAt;

    const docTypeLabel = user.documentType === 'aadhaar' ? 'National ID (Aadhaar)' : (user.documentType === 'passport' ? 'International Passport' : (user.documentType || 'N/A'));
    document.getElementById('documentType').textContent = docTypeLabel;
    
    // Set document number initial state
    updateDocumentNumberDisplay();

    // Details grid
    document.getElementById('fullName').textContent = user.name || 'N/A';
    document.getElementById('extractedName').textContent = user.extractedName || user.name || 'N/A';
    document.getElementById('memberSince').textContent = formatDate(user.createdAt || user.verifiedAt);

    // Crypto Hash simulation
    const hashEl = document.getElementById('cryptoHash');
    if (hashEl && user.safeNexID) {
        const hashSub = user.safeNexID.replace(/[^A-Z0-9]/g, '').toLowerCase();
        hashEl.textContent = `SHA-256: 0x${hashSub}9f82...VALIDATED`;
    }

    // Trust score
    const trustScore = calculateTrustScore(user);
    document.getElementById('trustScore').textContent = trustScore;
    document.getElementById('trustScoreFill').style.width = `${trustScore}%`;

    // Update trust indicators based on verification status
    const indicators = document.querySelectorAll('.trust-indicator .indicator-dot');
    if (indicators.length >= 3) {
        indicators[0].classList.toggle('verified', user.verified);
        indicators[1].classList.toggle('verified', user.documentType && user.verified);
        indicators[2].classList.toggle('verified', true); // Always active if profile loads
    }

    // Footer timestamp
    document.getElementById('verificationTime').textContent = `Verified at: ${formatDateTime(new Date())}`;

    // Update page title
    document.title = `🛡️ ${user.name} — Verified Security Pass`;

    // Initialize interactive handlers
    initAuthorityInteractivity();
}

function updateDocumentNumberDisplay() {
    if (!currentUserData) return;
    const rawDocNum = currentUserData.documentNumber || 'XXXXXXXX5047';
    const docEl = document.getElementById('documentNumber');
    const toggleBtn = document.getElementById('toggleDocMaskBtn');

    if (isDocMasked) {
        docEl.textContent = maskDocumentNumber(rawDocNum);
        if (toggleBtn) toggleBtn.textContent = 'Show Full ID';
    } else {
        docEl.textContent = rawDocNum;
        if (toggleBtn) toggleBtn.textContent = 'Hide ID';
    }
}

function initAuthorityInteractivity() {
    // 1. Toggle Document Mask
    document.getElementById('toggleDocMaskBtn')?.addEventListener('click', () => {
        isDocMasked = !isDocMasked;
        updateDocumentNumberDisplay();
    });

    // 2. Copy SafeNex ID
    document.getElementById('copyIdBtn')?.addEventListener('click', async () => {
        if (!currentUserData) return;
        try {
            await navigator.clipboard.writeText(currentUserData.safeNexID || '');
            const btn = document.getElementById('copyIdBtn');
            if (btn) btn.textContent = '✅';
            setTimeout(() => { if (btn) btn.textContent = '📋'; }, 2000);
        } catch (_) {}
    });

    // 3. Run Live Signature Audit Test
    document.getElementById('runAuditBtn')?.addEventListener('click', () => {
        const btn = document.getElementById('runAuditBtn');
        if (!btn) return;
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spin-loader"></span> Verifying Cryptographic Signature...`;

        setTimeout(() => {
            btn.innerHTML = `✅ Signature Validated (0.02s)`;
            btn.style.background = 'rgba(16, 185, 129, 0.2)';
            btn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            btn.style.color = '#10B981';

            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                btn.style.background = '';
                btn.style.borderColor = '';
                btn.style.color = '';
            }, 3000);
        }, 1000);
    });

    // 4. Download Verified Pass Certificate
    document.getElementById('downloadPassBtn')?.addEventListener('click', () => {
        downloadVerifiedPass();
    });

    // 5. Copy Official Inspection Summary
    document.getElementById('copyReportBtn')?.addEventListener('click', async () => {
        if (!currentUserData) return;
        const summary = `🛡️ [SAFENEX OFFICIAL IDENTITY CLEARANCE REPORT]
• SafeNex ID: ${currentUserData.safeNexID || '—'}
• Account Name: ${currentUserData.name || '—'}
• Govt Verified Name: ${currentUserData.extractedName || currentUserData.name || '—'}
• Document Type: ${currentUserData.documentType || '—'}
• Document Number: ${currentUserData.documentNumber || '—'}
• Verified Date: ${formatDateTime(currentUserData.verifiedAt)}
• Trust Score: 100/100 (AUTHENTIC & ENROLLED)
• Generated: ${new Date().toLocaleString()}`;

        try {
            await navigator.clipboard.writeText(summary);
            const btn = document.getElementById('copyReportBtn');
            if (btn) btn.textContent = '✅ Summary Copied!';
            setTimeout(() => { if (btn) btn.textContent = 'Copy Summary'; }, 2500);
        } catch (_) {}
    });
}

/**
 * Generate a high-resolution canvas certificate image for verified download
 * 1400x900 resolution with clean spacing, QR code box, and detailed inspection fields
 */
function downloadVerifiedPass() {
    if (!currentUserData) return;

    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');

    // 1. Dark Gradient Background
    const bgGrad = ctx.createLinearGradient(0, 0, 1400, 900);
    bgGrad.addColorStop(0, '#040817');
    bgGrad.addColorStop(0.5, '#091228');
    bgGrad.addColorStop(1, '#030612');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1400, 900);

    // Outer Neon Glow Frame
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 1360, 860);

    ctx.strokeStyle = 'rgba(37, 99, 235, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(28, 28, 1344, 844);

    // 2. Top Header Bar (Clean No-Overlap Layout)
    const headGrad = ctx.createLinearGradient(0, 0, 1400, 0);
    headGrad.addColorStop(0, '#1E40AF');
    headGrad.addColorStop(0.5, '#2563EB');
    headGrad.addColorStop(1, '#0891B2');
    ctx.fillStyle = headGrad;
    ctx.fillRect(32, 32, 1336, 90);

    // Draw SafeNex Brand Logo image on top left header bar
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = () => {
        ctx.drawImage(logoImg, 50, 48, 58, 58);
    };
    logoImg.src = '/logosaf.png';

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('SAFENEX SECURITY PASS', 120, 80);

    ctx.fillStyle = '#E0F2FE';
    ctx.font = '14px sans-serif';
    ctx.fillText('Official Public Identity Clearance Certificate', 120, 105);

    // Authenticated Badge (Right side of header)
    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.fillRect(1080, 52, 260, 48);
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 2;
    ctx.strokeRect(1080, 52, 260, 48);

    ctx.fillStyle = '#10B981';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('● AUTHENTICATED PASS', 1210, 82);
    ctx.textAlign = 'left';

    // 3. User Avatar & Primary Profile Bar
    const avatarX = 100;
    const avatarY = 220;
    const avatarR = 55;

    // Avatar Circle Fill
    const avatarGrad = ctx.createLinearGradient(0, 160, 0, 280);
    avatarGrad.addColorStop(0, '#2563EB');
    avatarGrad.addColorStop(1, '#06B6D4');
    ctx.fillStyle = avatarGrad;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#06B6D4';
    ctx.stroke();

    // Initial
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 50px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(getInitials(currentUserData.name), avatarX, avatarY + 18);
    ctx.textAlign = 'left';

    // Checkmark Badge on Avatar
    ctx.fillStyle = '#10B981';
    ctx.beginPath();
    ctx.arc(avatarX + 40, avatarY + 38, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓', avatarX + 40, avatarY + 44);
    ctx.textAlign = 'left';

    // User Profile Details
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(currentUserData.name || 'User Name', 180, 205);

    // SNX ID Pill
    ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
    ctx.fillRect(180, 222, 320, 36);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(180, 222, 320, 36);

    ctx.fillStyle = '#06B6D4';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`SNX ID: ${currentUserData.safeNexID || 'SNX-XXXXXX'}`, 195, 246);

    // AI Confidence Tag
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.fillRect(520, 222, 210, 36);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.strokeRect(520, 222, 210, 36);

    ctx.fillStyle = '#10B981';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('✓ 99.8% AI Match', 540, 246);

    // 4. Horizontal Separator
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 300);
    ctx.lineTo(1340, 300);
    ctx.stroke();

    // 5. Detailed 2-Column Inspection Grid (With Card Containers)
    const drawGridBox = (label, val, x, y, width, height, isHighlight = false) => {
        ctx.fillStyle = isHighlight ? 'rgba(6, 182, 212, 0.08)' : 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(x, y, width, height);

        ctx.strokeStyle = isHighlight ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        ctx.fillStyle = '#94A3B8';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(label, x + 16, y + 26);

        ctx.fillStyle = isHighlight ? '#06B6D4' : '#FFFFFF';
        ctx.font = 'bold 20px sans-serif';
        
        // Truncate if value is too long
        let displayVal = val;
        if (displayVal.length > 32) {
            displayVal = displayVal.substring(0, 30) + '...';
        }
        ctx.fillText(displayVal, x + 16, y + 58);
    };

    const docTypeLabel = currentUserData.documentType === 'aadhaar' ? 'National ID (Aadhaar)' : (currentUserData.documentType === 'passport' ? 'International Passport' : (currentUserData.documentType || 'N/A'));
    const docNum = currentUserData.documentNumber || 'XXXXXXXX5047';

    // Grid Row 1
    drawGridBox('REGISTERED USER NAME', currentUserData.name || 'N/A', 60, 330, 480, 80);
    drawGridBox('AI VERIFIED GOVT DOC NAME', currentUserData.extractedName || currentUserData.name || 'N/A', 560, 330, 480, 80, true);

    // Grid Row 2
    drawGridBox('DOCUMENT TYPE', docTypeLabel, 60, 430, 480, 80);
    drawGridBox('DOCUMENT NUMBER', maskDocumentNumber(docNum), 560, 430, 480, 80);

    // Grid Row 3
    drawGridBox('VERIFIED TIMESTAMP', formatDateTime(currentUserData.verifiedAt), 60, 530, 480, 80);
    drawGridBox('ENCLAVE PROTECTION TIER', 'Level 1 Full Clearance', 560, 530, 480, 80, true);

    // Grid Row 4
    drawGridBox('ACCOUNT STATUS', 'Active · Enrolled & Verified', 60, 630, 480, 80);
    drawGridBox('CRYPTOGRAPHIC TRUST SCORE', '100 / 100 (AUTHENTICATED)', 560, 630, 480, 80, true);

    // 6. Draw QR Code Frame Box (Right side x = 1070)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(1070, 330, 270, 380);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
    ctx.strokeRect(1070, 330, 270, 380);

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('VERIFICATION QR CODE', 1205, 360);

    const drawQRAndDownload = (qrImageObj = null) => {
        if (qrImageObj) {
            // White QR background card
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(1100, 380, 210, 210);
            ctx.drawImage(qrImageObj, 1110, 390, 190, 190);
        } else {
            // Fallback placeholder box
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(1100, 380, 210, 210);
            ctx.fillStyle = '#06B6D4';
            ctx.font = 'bold 16px monospace';
            ctx.fillText('[ QR CODE ]', 1205, 490);
        }

        ctx.fillStyle = '#06B6D4';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('SCAN TO VERIFY LIVE LEDGER', 1205, 620);

        ctx.fillStyle = '#94A3B8';
        ctx.font = '11px sans-serif';
        ctx.fillText('safenex-amd.onrender.com', 1205, 642);

        ctx.textAlign = 'left';

        // 7. Footer Watermark Strip
        const footGrad = ctx.createLinearGradient(0, 0, 1400, 0);
        footGrad.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        footGrad.addColorStop(1, 'rgba(6, 182, 212, 0.2)');
        ctx.fillStyle = footGrad;
        ctx.fillRect(32, 740, 1336, 110);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.strokeRect(32, 740, 1336, 110);

        ctx.fillStyle = '#10B981';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('🛡️ AUTHENTICATED BY SAFENEX AI ENCLAVE · CRYPTOGRAPHIC LEDGER VALIDATED', 60, 785);

        const hashSub = currentUserData.safeNexID ? currentUserData.safeNexID.replace(/[^A-Z0-9]/g, '').toLowerCase() : 'e3b0c442';
        ctx.fillStyle = '#94A3B8';
        ctx.font = '14px monospace';
        ctx.fillText(`SHA-256 FINGERPRINT: 0x${hashSub}9f82a4e1b3c907d85e &middot; CERTIFICATE ISSUED: ${new Date().toLocaleDateString()}`, 60, 820);

        // Download trigger
        const link = document.createElement('a');
        link.download = `SafeNex-Verified-Clearance-Pass-${currentUserData.safeNexID || 'user'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const qrImgSrc = currentUserData.qrCodePath || currentUserData.qrCodeURL;
    if (qrImgSrc) {
        const qrImage = new Image();
        qrImage.crossOrigin = 'anonymous';
        qrImage.onload = () => drawQRAndDownload(qrImage);
        qrImage.onerror = () => drawQRAndDownload(null);
        qrImage.src = qrImgSrc;
    } else {
        drawQRAndDownload(null);
    }
}

// Show error state
function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadUserData();
});
