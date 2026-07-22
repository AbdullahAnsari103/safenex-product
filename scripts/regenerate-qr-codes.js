/**
 * Regenerate QR Codes with Verification URLs
 * This script updates all existing QR codes to use the new URL format
 * instead of the old JSON format
 */

const { createClient } = require('@libsql/client');
const QRCode = require('qrcode');
require('dotenv').config();

// QR Code generation function
async function generateQRCode(data) {
    const dataURL = await QRCode.toDataURL(data, {
        type: 'image/png',
        width: 400,
        margin: 2,
        color: {
            dark: '#00D4FF',  // Cyan neon
            light: '#0A0F1E',  // Dark navy
        },
        errorCorrectionLevel: 'H',
    });
    return dataURL;
}

async function regenerateQRCodes() {
    console.log('🔄 Starting QR Code Regeneration...\n');

    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
        console.error('❌ TURSO_DATABASE_URL not found in .env');
        process.exit(1);
    }

    const client = createClient({ url, authToken: token });

    try {
        // Get all verified users with SafeNex IDs
        console.log('📊 Fetching verified users...');
        const result = await client.execute(`
            SELECT id, name, safenex_id, qr_code_path 
            FROM users 
            WHERE verified = 1 AND safenex_id IS NOT NULL
        `);

        const users = result.rows;
        console.log(`✅ Found ${users.length} verified users\n`);

        if (users.length === 0) {
            console.log('ℹ️ No verified users found. Nothing to regenerate.');
            return;
        }

        // Get base URL from environment or use default vercel URL
        const baseURL = process.env.PUBLIC_URL || process.env.DEV_TUNNEL_URL || process.env.BASE_URL || 'https://safenex-six.vercel.app';
        console.log(`🌐 Using base URL: ${baseURL}\n`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const user of users) {
            try {
                // Check if QR code already contains URL format
                if (user.qr_code_path && user.qr_code_path.includes('verify-user.html')) {
                    console.log(`⏭️  Skipping ${user.name} - QR code already updated`);
                    skipped++;
                    continue;
                }

                // Generate new verification URL
                const verificationURL = `${baseURL}/verify-user.html?id=${user.safenex_id}`;
                
                // Generate new QR code
                const qrCodeDataURL = await generateQRCode(verificationURL);

                // Update database
                await client.execute({
                    sql: 'UPDATE users SET qr_code_path = ? WHERE id = ?',
                    args: [qrCodeDataURL, user.id]
                });

                console.log(`✅ Updated QR code for ${user.name} (${user.safenex_id})`);
                updated++;

            } catch (error) {
                console.error(`❌ Error updating ${user.name}:`, error.message);
                errors++;
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('📊 Summary:');
        console.log(`   ✅ Updated: ${updated}`);
        console.log(`   ⏭️  Skipped: ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        console.log(`   📝 Total: ${users.length}`);
        console.log('='.repeat(50));

        if (updated > 0) {
            console.log('\n🎉 QR codes regenerated successfully!');
            console.log('\nℹ️  Users can now scan their QR codes to view verification page.');
        }

    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the script
regenerateQRCodes();
