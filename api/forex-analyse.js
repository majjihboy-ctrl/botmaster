// Forex Trader: asks Gemini to judge a setup that the browser already computed.
//
// The browser sends (a) a screenshot of the chart and (b) the exact numbers its
// own code calculated (range, sweep, entry, stop loss, take profit). Gemini only
// judges quality and explains; it can never change the numbers, which are passed
// back unchanged. The key lives only in the GEMINI_API_KEY environment variable
// (Vercel -> Settings -> Environment Variables) and never reaches the browser.
//
// Plain CommonJS, same as the other api/ files.

// gemini-2.0-flash was shut down by Google on 1 June 2026. Set GEMINI_MODEL in Vercel to switch
// models without a code change (see https://ai.google.dev/gemini-api/docs/deprecations).
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const MAX_IMAGE_CHARS = 2_500_000; // base64 length, roughly 1.8 MB of image
const MAX_JSON_CHARS = 20_000;
const MAX_CANDLES = 120;
const { takeSlot } = require('./_lib/forex-limit');

// How long we wait for Gemini before giving up (Vercel would otherwise cut the request off).
const GEMINI_TIMEOUT_MS = 20_000;

const STATUS = ['waiting_for_market', 'waiting_for_pov', 'buy_ready', 'sell_ready', 'invalidated'];

const SYSTEM = `You are a careful trading-chart reviewer for a signals tool. You never place trades and you never promise profit.
You receive: a chart screenshot, the last closed candles as plain numbers (oldest first: time, open, high, low, close), and a JSON object of exact numbers already calculated by code (reference range, sweep, entry, stop loss, take profit, risk:reward, plannedTrades = what the trade would be if each side gets swept, session, warnings, status).
Rules:
- The numbers are correct. Never change, recalculate or invent price levels. Refer to them by name (Entry, SL, TP, range high, range low).
- Use the candle numbers to check what the screenshot shows (clean rejection, momentum, choppiness, room to the target). They never change the exact levels in the JSON.
- Judge only whether the setup named in the JSON looks clean on the chart (clear sweep, clean rejection, room to the target, no obvious opposing structure, volatility that is neither dead nor chaotic).
- Pick exactly one status:
  "waiting_for_market" = conditions are poor right now (choppy, dead, news-like spikes, range too small, price stuck in the middle).
  "waiting_for_pov" = conditions are fine but the setup has not formed yet (no sweep yet, or sweep still in progress).
  "buy_ready" or "sell_ready" = the code found a valid setup and the chart supports it.
  "invalidated" = the setup failed (stop hit, or the chart contradicts it).
- If the code says the setup is not ready, you may not answer buy_ready or sell_ready.
- Be honest about uncertainty. No strategy wins every time.
Answer ONLY with a JSON object: {"status": string, "confidence": integer 0-100, "reasoning": string (max 70 words), "warnings": array of short strings (max 4)}`;

/** Validates the candles from the browser and turns them into compact text lines, or null if they are not valid. */
function candlesToText(candles) {
    if (candles === undefined || candles === null) return '';
    if (!Array.isArray(candles) || candles.length > MAX_CANDLES) return null;
    const lines = [];
    for (const c of candles) {
        if (!Array.isArray(c) || c.length !== 5 || !c.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
        const [t, o, h, l, cl] = c;
        if (h < Math.max(o, cl, l) || l > Math.min(o, cl, h)) return null; // high/low must contain the candle
        lines.push(`${new Date(t * 1000).toISOString().slice(0, 16)}Z ${o} ${h} ${l} ${cl}`);
    }
    return lines.join('\n');
}

function clean(parsed, analysis) {
    let status = STATUS.includes(parsed && parsed.status) ? parsed.status : 'waiting_for_market';
    const codeState = analysis && analysis.state;
    // Hard guard: the AI can never upgrade a setup the code did not find.
    if ((status === 'buy_ready' || status === 'sell_ready') && codeState !== 'ready') {
        status = codeState === 'invalidated' ? 'invalidated'
            : codeState === 'poor_market' || codeState === 'stale' || codeState === 'no_data' || codeState === 'no_range'
                ? 'waiting_for_market'
                : 'waiting_for_pov';
    }
    // And a ready setup can only be BUY for a low sweep / SELL for a high sweep.
    if (status === 'buy_ready' && !(analysis.plan && analysis.plan.side === 'BUY')) status = 'waiting_for_market';
    if (status === 'sell_ready' && !(analysis.plan && analysis.plan.side === 'SELL')) status = 'waiting_for_market';
    let confidence = Math.round(Number(parsed && parsed.confidence));
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));
    const reasoning = String((parsed && parsed.reasoning) || '').slice(0, 600);
    const warnings = Array.isArray(parsed && parsed.warnings)
        ? parsed.warnings.slice(0, 4).map(w => String(w).slice(0, 160))
        : [];
    return { status, confidence, reasoning, warnings };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        // Visitors get a plain message; the real reason goes to the server log only.
        console.error('forex-analyse: GEMINI_API_KEY is not set');
        res.status(503).json({ error: 'The AI review is not available right now.' });
        return;
    }
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const refused = await takeSlot(ip);
    if (refused) {
        res.status(429).json({
            error: refused === 'minute'
                ? 'Too many requests. Please wait a minute and try again.'
                : 'The AI review has reached its limit for today. The chart and levels still work; please try again later.',
        });
        return;
    }

    try {
        const body = req.body || {};
        const analysis = body.analysis;
        const meta = body.meta || {};
        const image = typeof body.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
        if (!analysis || typeof analysis !== 'object') {
            res.status(400).json({ error: 'Missing analysis' });
            return;
        }
        const json = JSON.stringify({ meta, analysis });
        if (json.length > MAX_JSON_CHARS) {
            res.status(413).json({ error: 'Analysis data is too large' });
            return;
        }
        if (image.length > MAX_IMAGE_CHARS) {
            res.status(413).json({ error: 'Chart image is too large' });
            return;
        }

        const candleText = candlesToText(body.candles);
        if (candleText === null) {
            res.status(400).json({ error: 'Bad candle data' });
            return;
        }
        const parts = [{ text: `Exact numbers calculated by code (JSON):\n${json}` }];
        if (candleText) parts.push({ text: `Last ${body.candles.length} closed candles (UTC time, open, high, low, close), oldest first:\n${candleText}` });
        if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
        const ask = model =>
            fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: SYSTEM }] },
                    contents: [{ role: 'user', parts }],
                    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 2048 },
                }),
            });
        let r;
        let usedModel = MODEL;
        try {
            r = await ask(usedModel);
            // If Google says this model name does not exist (404), try the cheaper fallback model once.
            if (r.status === 404 && usedModel !== FALLBACK_MODEL) {
                console.error('gemini model not found, trying fallback:', usedModel);
                usedModel = FALLBACK_MODEL;
                r = await ask(usedModel);
            }
        } catch (err) {
            if (err && err.name === 'AbortError') {
                res.status(504).json({ error: 'The AI took too long to answer. Please try again.' });
                return;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
        if (!r.ok) {
            const detail = await r.text().catch(() => '');
            console.error('gemini error', r.status, usedModel, detail.slice(0, 300));
            // Only the status number is shown to the visitor, never Google's detail text.
            res.status(502).json({
                error: r.status === 429
                    ? 'The AI service is busy right now. Please try again in a minute.'
                    : 'The AI review is unavailable right now. Please try again shortly.',
                code: r.status,
            });
            return;
        }
        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        let parsed;
        try {
            parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
        } catch {
            res.status(502).json({ error: 'The AI gave an unreadable answer. Try again.' });
            return;
        }
        res.status(200).json({ ...clean(parsed, analysis), model: usedModel });
    } catch (err) {
        console.error('forex-analyse error:', err);
        res.status(500).json({ error: 'Analysis failed. Please try again.' });
    }
};
module.exports._clean = clean;
module.exports._candlesToText = candlesToText;
