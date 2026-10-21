const { checkAccess } = require('./_lib/access');
const { SYSTEM_PROMPT } = require('./_lib/chat-prompt');
const { chat } = require('./_lib/providers');

const MAX_MESSAGES = 24;
const MAX_CHARS = 8000;

// Best-effort per-IP rate limit (in-memory, per serverless instance). It will not stop a distributed
// flood, but it stops a single client from burning the Gemini / xAI quota with a loop.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map();

function clientIp(req) {
    const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '')
        .split(',')[0]
        .trim();
    return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();
    const recent = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    recent.push(now);
    rateBuckets.set(ip, recent);
    if (rateBuckets.size > 5000) {
        for (const [key, times] of rateBuckets) {
            if (!times.some(t => now - t < RATE_LIMIT_WINDOW_MS)) rateBuckets.delete(key);
        }
    }
    return recent.length > RATE_LIMIT_MAX;
}

// Keeps the last messages, drops anything that is not a plain user/assistant text message, merges
// consecutive messages from the same side, and makes sure the conversation starts and ends with the user.
function cleanMessages(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const m of raw.slice(-MAX_MESSAGES)) {
        const role = m && (m.role === 'assistant' || m.role === 'user') ? m.role : null;
        const content = m && typeof m.content === 'string' ? m.content.trim().slice(0, MAX_CHARS) : '';
        if (!role || !content) continue;
        if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${content}`;
        else out.push({ role, content });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out.length && out[out.length - 1].role === 'user' ? out : [];
}

async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (isRateLimited(clientIp(req))) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
        return;
    }

    try {
        // Private: only accounts listed in AI_ALLOWED_ACCOUNTS (verified through Deriv) may use the AI.
        const access = await checkAccess(req);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }

        const messages = cleanMessages(req.body && req.body.messages);
        if (messages.length === 0) {
            res.status(400).json({ error: 'Send a message to chat.' });
            return;
        }

        const reply = await chat(SYSTEM_PROMPT, messages);
        res.status(200).json({ reply });
    } catch (err) {
        console.error('ai-chat error:', err);
        res.status(500).json({ error: (err && err.message) || 'The AI request failed' });
    }
}

module.exports = handler;
module.exports.cleanMessages = cleanMessages;
