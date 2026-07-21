const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Initialize with the API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Convert a local file to a Gemini-compatible inline data part
 */
function fileToGenerativePart(filePath) {
    const mimeTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
    };
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mimeTypeMap[ext] || 'image/jpeg';
    const data = fs.readFileSync(filePath).toString('base64');
    return { inlineData: { data, mimeType } };
}

/**
 * Build the Gemini prompt for document verification
 */
function buildPrompt(documentType) {
    if (documentType === 'aadhaar') {
        return `You are a strict identity document verification AI for SafeNex, an urban safety system.

Analyze the provided image carefully and determine if it is a valid Indian Aadhaar card.

For a valid Aadhaar card, you MUST verify ALL of the following:
1. Presence of a 12-digit Aadhaar number (format: XXXX XXXX XXXX)
2. Presence of "Government of India" or "भारत सरकार" text
3. Presence of a person's full name
4. "AADHAAR" or "आधार" text visible
5. Year of birth or date of birth visible

Extract and return the following in strict JSON format:
{
  "valid": true or false,
  "documentType": "aadhaar",
  "extractedName": "full name as it appears on the card or null",
  "documentNumber": "12-digit aadhaar number with spaces removed or null",
  "reason": "why it is invalid if valid is false, or null if valid",
  "details": "any additional details found on card or null"
}

Do NOT return anything other than valid JSON. If the image is not an Aadhaar card, set valid to false and explain in reason.`;
    }

    return `You are a strict identity document verification AI for SafeNex, an urban safety system.

Analyze the provided image carefully and determine if it is a valid international Passport.

For a valid Passport, you MUST verify ALL of the following:
1. Presence of a passport number (typically 1 letter followed by 7 digits, e.g. A1234567)
2. Presence of MRZ (Machine Readable Zone) — two lines of text at the bottom with P< prefix
3. Presence of country code (3-letter ISO code like IND, USA, GBR etc.)
4. Presence of holder's full name (surname and given name)
5. "PASSPORT" word visible on the document

Extract and return the following in strict JSON format:
{
  "valid": true or false,
  "documentType": "passport",
  "extractedName": "full name as it appears on the passport or null",
  "documentNumber": "passport number or null",
  "countryCode": "3-letter country code or null",
  "reason": "why it is invalid if valid is false, or null if valid",
  "details": "any additional details found or null"
}

Do NOT return anything other than valid JSON. If the image is not a passport, set valid to false and explain in reason.`;
}

/**
 * Try to get a working Gemini model — attempts the configured model first,
 * then falls back through known working alternatives (including gemini-2.5-flash).
 */
async function getWorkingModel(preferredModelName, imagePart, prompt) {
    // Models to try in order
    const modelsToTry = [
        preferredModelName,
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
    ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i); // deduplicate

    let lastError = null;

    for (const modelName of modelsToTry) {
        try {
            console.log(`[Gemini] Trying model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            console.log(`[Gemini] ✅ Success with model: ${modelName}`);
            return response.text().trim();
        } catch (err) {
            console.warn(`[Gemini] ❌ Model ${modelName} failed: ${err.message}`);
            lastError = err;
            // Continue trying other candidate models in sequence
        }
    }

    throw lastError || new Error('All Gemini models failed.');
}

/**
 * Main function: verify a document using Gemini Vision AI
 * @param {string} filePath - Absolute path to the uploaded document
 * @param {string} documentType - 'aadhaar' or 'passport'
 * @returns {Object} { valid, extractedName, documentNumber, reason, details }
 */
async function verifyDocument(filePath, documentType) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            const err = new Error('Gemini API key is not configured in .env file.');
            err.statusCode = 500;
            throw err;
        }

        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const prompt = buildPrompt(documentType);
        const imagePart = fileToGenerativePart(filePath);

        const rawText = await getWorkingModel(modelName, imagePart, prompt);

        // Extract JSON from response (handle markdown code blocks)
        let jsonText = rawText;
        const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1].trim();
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (parseErr) {
            console.error('[Gemini] Failed to parse response:', rawText);
            return {
                valid: false,
                reason: 'AI returned an unreadable response format. Please try uploading a clearer image.',
                details: null,
            };
        }

        return {
            valid: Boolean(parsed.valid),
            documentType: parsed.documentType || documentType,
            extractedName: parsed.extractedName || null,
            documentNumber: parsed.documentNumber || null,
            reason: parsed.reason || null,
            details: parsed.details || null,
        };
    } catch (error) {
        console.error('[Gemini Verify Error]', error.message);

        let statusCode = error.statusCode || 500;
        let message = error.message;

        if (error.message && error.message.includes('API_KEY')) {
            statusCode = 401;
            message = 'Gemini API key is invalid or missing.';
        } else if (error.message && (error.message.includes('quota') || error.message.includes('429'))) {
            statusCode = 429;
            message = 'Gemini API quota exceeded. Please try again in a few moments.';
        } else if (error.message && (error.message.includes('400') || error.message.includes('invalid argument'))) {
            statusCode = 400;
            message = 'The uploaded document image format or content could not be processed by AI. Please upload a clear JPG, PNG, or PDF file.';
        } else {
            message = `Document verification service error: ${error.message}`;
        }

        const customError = new Error(message);
        customError.statusCode = statusCode;
        throw customError;
    }
}

module.exports = { verifyDocument };
