import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type TLiveTickState = {
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
    tickCount: number;
    lastDigit: number | null;
};

const EMPTY_STATE: TLiveTickState = { isConnected: false, isConnecting: false, error: null, tickCount: 0, lastDigit: null };

// Format the quote with the symbol's pip precision so trailing zeros survive
// (663.10 -> digit 0, NOT 1) — same rule used across the other tools' tick
// handlers, since String(663.10) silently drops the trailing zero.
const extractLastDigit = (quote: number, pip_size: number) => Number(quote.toFixed(pip_size).slice(-1));

/**
 * Subscribes to live ticks for a symbol and calls `onDigit` for every
 * incoming tick's last digit. Handles its own subscribe/unsubscribe
 * lifecycle — call `stop()` (or just switch symbols) to tear it down.
 */
export const useLiveDerivTicks = (onDigit: (digit: number) => void) => {
    const [state, setState] = useState<TLiveTickState>(EMPTY_STATE);
    const onDigitRef = useRef(onDigit);
    onDigitRef.current = onDigit;

    const symbolRef = useRef<string | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);
    const messageSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

    const stop = useCallback(() => {
        messageSubscriptionRef.current?.unsubscribe();
        messageSubscriptionRef.current = null;
        if (subscriptionIdRef.current) {
            api_base.api.send({ forget: subscriptionIdRef.current }).catch(() => {});
            subscriptionIdRef.current = null;
        }
        symbolRef.current = null;
        setState(EMPTY_STATE);
    }, []);

    const start = useCallback(
        async (symbol: string) => {
            stop();
            symbolRef.current = symbol;
            setState({ ...EMPTY_STATE, isConnecting: true });

            messageSubscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type === 'tick' && data?.tick?.symbol === symbol) {
                    if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                    const digit = extractLastDigit(Number(data.tick.quote), Number(data.tick.pip_size ?? 2));
                    onDigitRef.current(digit);
                    setState(prev => ({
                        ...prev,
                        isConnected: true,
                        isConnecting: false,
                        lastDigit: digit,
                        tickCount: prev.tickCount + 1,
                    }));
                }
            });

            try {
                const sub_res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                if (sub_res?.subscription?.id) subscriptionIdRef.current = sub_res.subscription.id;
                setState(prev => ({ ...prev, isConnecting: false, isConnected: true }));
            } catch (e: any) {
                // Another part of the app may already hold this symbol's
                // subscription — ticks still arrive on the shared onMessage
                // stream in that case, so this isn't fatal.
                if (e?.error?.code === 'AlreadySubscribed') {
                    setState(prev => ({ ...prev, isConnecting: false, isConnected: true }));
                    return;
                }
                setState(prev => ({
                    ...prev,
                    isConnecting: false,
                    isConnected: false,
                    error: e?.error?.message || e?.message || 'Subscription failed',
                }));
            }
        },
        [stop]
    );

    useEffect(() => stop, [stop]);

    return { state, start, stop };
};
