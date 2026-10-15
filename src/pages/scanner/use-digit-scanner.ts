import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import { inferPipSize, normalizePipDecimals, TSymbolOption } from '@/pages/analysis-tool/use-digit-stats';

export type TMarketScan = {
    symbol: string;
    display_name: string;
    quote: string;
    sample_size: number;
    counts: number[]; // index 0-9
    pcts: number[]; // index 0-9, percentage of the sample
    even_pct: number;
    odd_pct: number;
    last_digits: number[]; // newest last, max LAST_DIGITS_SHOWN
    most_idx: number;
    least_idx: number;
};

export type TBuffer = {
    digits: number[]; // newest last, never longer than MAX_TICKS
    quote: string;
    pip_size: number;
    loaded: boolean;
};

export const MAX_TICKS = 1000;
const LAST_DIGITS_SHOWN = 12;
const PUBLISH_INTERVAL_MS = 500;
const RETRY_INTERVAL_MS = 4000;
const MAX_RETRIES = 4;

const freshBuffer = (): TBuffer => ({ digits: [], quote: '--', pip_size: 2, loaded: false });

const pushDigit = (buf: TBuffer, digit: number) => {
    buf.digits.push(digit);
    if (buf.digits.length > MAX_TICKS) buf.digits.splice(0, buf.digits.length - MAX_TICKS);
};

/** Statistics over the newest `window_size` digits. The full history is kept, so the
 * window can grow or shrink instantly without refetching. */
export const summarize = (symbol: string, display_name: string, buf: TBuffer, window_size: number): TMarketScan => {
    const sample = buf.digits.slice(-window_size);
    const total = sample.length;
    const counts: number[] = Array(10).fill(0);
    sample.forEach(d => {
        counts[d] += 1;
    });
    const pcts = counts.map(c => (total ? (c / total) * 100 : 0));
    const even_count = [0, 2, 4, 6, 8].reduce((sum, d) => sum + counts[d], 0);
    const even_pct = total ? (even_count / total) * 100 : 0;
    let most_idx = 0;
    let least_idx = 0;
    counts.forEach((c, i) => {
        if (c > counts[most_idx]) most_idx = i;
        if (c < counts[least_idx]) least_idx = i;
    });
    return {
        symbol,
        display_name,
        quote: buf.quote,
        sample_size: total,
        counts,
        pcts,
        even_pct,
        odd_pct: total ? 100 - even_pct : 0,
        last_digits: sample.slice(-LAST_DIGITS_SHOWN),
        most_idx,
        least_idx,
    };
};

/**
 * Live last-digit statistics for several markets at once.
 *
 * Seeds each market from `ticks_history`, then keeps it current from the shared tick
 * stream. A duplicate-subscription error is expected when another tab already streams
 * the same market, and is harmless because every tick arrives through the same
 * `onMessage` stream regardless of who subscribed.
 */
export const useDigitScanner = (symbols: TSymbolOption[], tick_count: number) => {
    const [scans, setScans] = useState<TMarketScan[]>([]);
    const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
    const tick_count_ref = useRef(tick_count);
    const symbols_key = symbols.map(s => s.symbol).join(',');

    useEffect(() => {
        tick_count_ref.current = tick_count;
    }, [tick_count]);

    useEffect(() => {
        if (!symbols.length) return;

        let cancelled = false;
        let retry_timer: ReturnType<typeof setTimeout> | undefined;
        const subscription_ids: string[] = [];
        const lookup = new Map(symbols.map(s => [s.symbol.toUpperCase(), s]));
        const buffers = new Map<string, TBuffer>(symbols.map(s => [s.symbol, freshBuffer()]));

        const publish = () => {
            if (cancelled) return;
            setScans(
                symbols.map(s => summarize(s.symbol, s.display_name, buffers.get(s.symbol)!, tick_count_ref.current))
            );
            const any_loaded = Array.from(buffers.values()).some(b => b.loaded);
            setStatus(prev => (any_loaded ? 'live' : prev === 'error' ? 'error' : 'connecting'));
        };

        const message_subscription = api_base.api?.onMessage?.().subscribe(({ data }: { data: any }) => {
            if (cancelled || data?.msg_type !== 'tick') return;
            const match = lookup.get(String(data?.tick?.symbol ?? '').toUpperCase());
            if (!match) return;
            const buf = buffers.get(match.symbol);
            if (!buf || !buf.loaded) return; // wait for history so the window starts complete
            const quote = Number(data.tick.quote);
            // pip_size can arrive as a decimal count (3) or a pip amount (0.001):
            // normalise it, and never show fewer decimals than the quote Deriv sent
            // (toFixed(0.001) would otherwise drop every decimal).
            const pip = Math.max(
                normalizePipDecimals(data.tick?.pip_size) ??
                    normalizePipDecimals(api_base?.pip_sizes?.[match.symbol]) ??
                    buf.pip_size,
                inferPipSize([data.tick.quote]) ?? 0,
                buf.pip_size
            );
            buf.pip_size = pip;
            buf.quote = quote.toFixed(pip);
            pushDigit(buf, Number(getLastDigitForList(quote, pip)));
        });

        const loadSymbol = async (s: TSymbolOption) => {
            const buf = buffers.get(s.symbol);
            if (!buf || buf.loaded) return;
            try {
                const hist = await api_base.api.send({
                    ticks_history: s.symbol,
                    count: MAX_TICKS,
                    end: 'latest',
                    style: 'ticks',
                });
                if (cancelled) return;
                const prices: number[] = hist?.history?.prices ?? [];
                if (!prices.length) return;
                const pip = Math.max(
                    normalizePipDecimals(hist?.pip_size) ?? normalizePipDecimals(api_base?.pip_sizes?.[s.symbol]) ?? 2,
                    inferPipSize(prices) ?? 0
                );
                buf.pip_size = pip;
                buf.digits = prices.slice(-MAX_TICKS).map(p => Number(getLastDigitForList(Number(p), pip)));
                buf.quote = Number(prices[prices.length - 1]).toFixed(pip);
                buf.loaded = true;
                try {
                    const res = await api_base.api.send({ ticks: s.symbol, subscribe: 1 });
                    if (res?.subscription?.id) subscription_ids.push(res.subscription.id);
                } catch {
                    // Already subscribed elsewhere: ticks still reach us through onMessage.
                }
            } catch {
                // Leave `loaded` false so the retry pass picks this market up again.
            }
        };

        let retries = 0;
        const loadAll = async () => {
            await Promise.all(symbols.filter(s => !buffers.get(s.symbol)?.loaded).map(loadSymbol));
            if (cancelled) return;
            publish();
            const all_loaded = symbols.every(s => buffers.get(s.symbol)?.loaded);
            if (all_loaded) return;
            retries += 1;
            if (retries > MAX_RETRIES) {
                if (!Array.from(buffers.values()).some(b => b.loaded)) setStatus('error');
                return;
            }
            retry_timer = setTimeout(loadAll, RETRY_INTERVAL_MS);
        };

        loadAll();
        const publish_timer = setInterval(publish, PUBLISH_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(publish_timer);
            if (retry_timer) clearTimeout(retry_timer);
            message_subscription?.unsubscribe?.();
            subscription_ids.forEach(id => {
                api_base.api?.send({ forget: id }).catch(() => {});
            });
        };
    }, [symbols_key]); // eslint-disable-line react-hooks/exhaustive-deps

    return { scans, status };
};
