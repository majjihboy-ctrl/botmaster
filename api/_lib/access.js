// Who may use the AI Bot Builder API.
//
// The browser sends the user's Deriv OAuth access token (the same Bearer token the app uses). The
// server asks Deriv which accounts that token owns and only continues if one of them is listed in the
// AI_ALLOWED_ACCOUNTS environment variable (comma-separated account ids as Deriv returns them, e.g.
// "DOT90004580,DOT90004581"; the old CR/VRTC style ids work too).
// A loginid sent by the browser is never trusted; only Deriv's answer to the token is.
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const crypto = require('crypto');

const ACCOUNTS_URL = process.env.DERIV_ACCOUNTS_URL || 'https://api.derivws.com/trading/v1/options/accounts';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // sha256(token) -> { ids, at }

const allowedAccounts = () =>
    String(process.env.AI_ALLOWED_ACCOUNTS || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);

function bearerToken(req) {
    const header = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
    const match = /^Bearer\s+(\S{10,4096})$/i.exec(header);
    return match ? match[1] : '';
}

async function accountIdsForToken(token) {
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;

    // Deriv's accounts endpoint requires the Deriv-App-ID header next to the Bearer token.
    const headers = { Authorization: `Bearer ${token}` };
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || process.env.DERIV_APP_ID;
    if (appId) headers['Deriv-App-ID'] = appId;
    const response = await fetch(ACCOUNTS_URL, { method: 'GET', headers });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const ids = ((body && body.data) || []).map(a => String(a.account_id || '').toUpperCase()).filter(Boolean);
    if (ids.length === 0) return null;

    if (cache.size > 500) cache.clear();
    cache.set(key, { ids, at: Date.now() });
    return ids;
}

// Returns { ok: true, loginids } or { ok: false, status, error }.
async function checkAccess(req) {
    const token = bearerToken(req);
    if (!token) return { ok: false, status: 401, error: 'Log in to use the AI Bot Builder.' };

    let ids;
    try {
        ids = await accountIdsForToken(token);
    } catch (err) {
        console.error('ai-chat: could not reach Deriv to verify the login:', err && err.message);
        return { ok: false, status: 503, error: 'Could not verify your login right now. Try again in a moment.' };
    }
    if (!ids) return { ok: false, status: 401, error: 'Your login could not be verified. Log in again.' };

    const allowed = allowedAccounts();
    if (allowed.length === 0) {
        // Only a verified Deriv user ever sees this, and it only shows their own account ids.
        return {
            ok: false,
            status: 403,
            error: `The AI Bot Builder is private and no account is allowed yet. Add ${ids.join(' or ')} to AI_ALLOWED_ACCOUNTS in the Vercel environment variables, then redeploy.`,
        };
    }
    if (!ids.some(id => allowed.includes(id))) {
        return { ok: false, status: 403, error: 'The AI Bot Builder is private.' };
    }
    return { ok: true, loginids: ids };
}

module.exports = { checkAccess, bearerToken };
