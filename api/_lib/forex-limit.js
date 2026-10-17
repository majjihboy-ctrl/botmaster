// Usage limits for the Forex Trader AI endpoint (api/forex-analyse.js).
//
// Every AI review costs real money, so three limits protect it:
//   1. per visitor, per minute   (FOREX_AI_PER_MINUTE, default 8)
//   2. per visitor, per day      (FOREX_AI_IP_DAILY,  default 150)
//   3. everyone together, per day (FOREX_AI_DAILY_CAP, default 1500)
//
// The counts are kept in the database (table forex_ai_usage, created automatically the
// first time it is needed) so they hold across all of Vercel's server instances. If the
// database is not available the limits fall back to a per-instance memory counter, so the
// endpoint is never left unprotected.
const crypto = require('crypto');

const num = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};
const limits = () => ({
    perMinute: num('FOREX_AI_PER_MINUTE', 8),
    perIpDay: num('FOREX_AI_IP_DAILY', 150),
    globalDay: num('FOREX_AI_DAILY_CAP', 1500),
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Visitors are stored as a hash, never as a readable IP address.
const who = ip => crypto.createHash('sha256').update(`forex-ai:${ip}`).digest('hex').slice(0, 32);

// ---- fallback: memory on this server instance only
const memory = [];
function checkMemory(id, now, lim) {
    while (memory.length && now - memory[0].t > DAY) memory.shift();
    if (memory.length > 20000) memory.splice(0, memory.length - 20000);
    const mine = memory.filter(e => e.id === id);
    if (mine.filter(e => now - e.t < MINUTE).length >= lim.perMinute) return 'minute';
    if (mine.length >= lim.perIpDay) return 'visitor_day';
    if (memory.length >= lim.globalDay) return 'global_day';
    memory.push({ id, t: now });
    return null;
}

let tableReady = false;
async function ensureTable(sql) {
    if (tableReady) return;
    await sql`CREATE TABLE IF NOT EXISTS forex_ai_usage (
        id         BIGSERIAL PRIMARY KEY,
        visitor    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS forex_ai_usage_time_idx ON forex_ai_usage (created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS forex_ai_usage_visitor_idx ON forex_ai_usage (visitor, created_at)`;
    tableReady = true;
}

/**
 * Counts one AI request. Resolves to null when allowed, or the reason it was refused:
 * 'minute' | 'visitor_day' | 'global_day'.
 */
async function takeSlot(ip, now = Date.now()) {
    const lim = limits();
    const id = who(ip);
    if (!process.env.DATABASE_URL) return checkMemory(id, now, lim);
    try {
        const { getDb } = require('./db'); // only loaded when DATABASE_URL is set
        const sql = getDb();
        await ensureTable(sql);
        const rows = await sql`
            SELECT
                COUNT(*) FILTER (WHERE visitor = ${id} AND created_at > now() - interval '1 minute')::int AS minute,
                COUNT(*) FILTER (WHERE visitor = ${id})::int AS visitor_day,
                COUNT(*)::int AS global_day
            FROM forex_ai_usage
            WHERE created_at > now() - interval '1 day'`;
        const c = rows[0] || { minute: 0, visitor_day: 0, global_day: 0 };
        if (c.minute >= lim.perMinute) return 'minute';
        if (c.visitor_day >= lim.perIpDay) return 'visitor_day';
        if (c.global_day >= lim.globalDay) return 'global_day';
        await sql`INSERT INTO forex_ai_usage (visitor) VALUES (${id})`;
        // tidy old rows now and then so the table stays small
        if (Math.random() < 0.02) await sql`DELETE FROM forex_ai_usage WHERE created_at < now() - interval '2 days'`;
        return null;
    } catch (err) {
        console.error('forex-limit: database unavailable, using memory counter:', err && err.message);
        return checkMemory(id, now, lim);
    }
}

const _reset = () => {
    memory.length = 0;
    tableReady = false;
};

module.exports = { takeSlot, limits, _reset };
