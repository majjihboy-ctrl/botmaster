import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { getLastDigitForList } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';

export type TScanSymbol = { symbol: string; display_name: string };

// Volatility + Jump indices only, per spec ("volatilities and jumps only").
const MUST_INCLUDE: TScanSymbol[] = [
    { symbol: '1HZ15V', display_name: 'Volatility 15 (1s) Index' },
    { symbol: '1HZ30V', display_name: 'Volatility 30 (1s) Index' },
    { symbol: '1HZ90V', display_name: 'Volatility 90 (1s) Index' },
];

const FALLBACK_SYMBOLS: TScanSymbol[] = [
    { symbol: 'R_10', display_name: 'Volatility 10 Index' },
    { symbol: 'R_25', display_name: 'Volatility 25 Index' },
    { symbol: 'R_50', display_name: 'Volatility 50 Index' },
    { symbol: 'R_75', display_name: 'Volatility 75 Index' },
    { symbol: 'R_100', display_name: 'Volatility 100 Index' },
    { symbol: '1HZ10V', display_name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', display_name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', display_name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', display_name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', display_name: 'Volatility 100 (1s) Index' },
    { symbol: 'JD10', display_name: 'Jump 10 Index' },
    { symbol: 'JD25', display_name: 'Jump 25 Index' },
    { symbol: 'JD50', display_name: 'Jump 50 Index' },
    { symbol: 'JD75', display_name: 'Jump 75 Index' },
    { symbol: 'JD100', display_name: 'Jump 100 Index' },
];

const withMustInclude = (list: TScanSymbol[]): TScanSymbol[] => {
    const present = new Set(list.map(s => s.symbol));
    return [...list, ...MUST_INCLUDE.filter(s => !present.has(s.symbol))];
};

export const useScanSymbols = (): TScanSymbol[] => {
    const [symbols, setSymbols] = useState<TScanSymbol[]>(withMustInclude(FALLBACK_SYMBOLS));

    useEffect(() => {
        let attempts = 0;
        const tryLoad = () => {
            const list = api_base?.active_symbols;
            if (Array.isArray(list) && list.length) {
                const matched = list
                    .filter(
                        (s: any) =>
                            s.market === 'synthetic_index' &&
                            (String(s.display_name || '').startsWith('Volatility') ||
                                String(s.display_name || '').startsWith('Jump'))
                    )
                    .map((s: any) => ({ symbol: s.symbol, display_name: s.display_name || s.symbol }));
                if (matched.length) {
                    setSymbols(withMustInclude(matched));
                    return;
                }
            }
            attempts += 1;
            if (attempts < 10) setTimeout(tryLoad, 500);
        };
        tryLoad();
    }, []);

    return symbols;
};

// ── LHL Over 2 pattern state machine, replicated exactly from lhl_over_2.xml ──
// Stage 0: counts consecutive digits <= 2 ("low"); 2 in a row -> Stage 1
// Stage 1: counts consecutive digits > 2 ("high"); 2 in a row -> Stage 2
// Stage 2: waits for one digit < 2 -> resets to Stage 0 AND signals entry (DIGITOVER, barrier 2)
type TPatternState = { stage: 0 | 1 | 2; low_count: number; high_count: number };

const initialPatternState = (): TPatternState => ({ stage: 0, low_count: 0, high_count: 0 });

// Mutates a copy of state for one new digit; returns { state, signal } where
// signal=true means this tick is the LHL Over 2 entry trigger.
const stepPattern = (state: TPatternState, digit: number): { state: TPatternState; signal: boolean } => {
    const s = { ...state };

    if (s.stage === 0) {
        if (digit <= 2) {
            s.low_count += 1;
            if (s.low_count >= 2) {
                s.stage = 1;
                s.high_count = 0;
            }
        } else {
            s.low_count = 0;
        }
        return { state: s, signal: false };
    }

    if (s.stage === 1) {
        if (digit > 2) {
            s.high_count += 1;
            if (s.high_count >= 2) {
                s.stage = 2;
            }
        } else {
            s.high_count = 0;
        }
        return { state: s, signal: false };
    }

    // stage === 2
    if (digit < 2) {
        s.low_count = 0;
        s.stage = 0;
        s.high_count = 0;
        return { state: s, signal: true }; // entry trigger
    }
    return { state: s, signal: false };
};

export type TSymbolScanStatus = {
    symbol: string;
    display_name: string;
    stage: 0 | 1 | 2;
    last_digit: number | null;
    is_connected: boolean;
};

export type TScanSignal = { symbol: string; display_name: string; at: number };

// Watches every given symbol's live ticks in parallel, running an independent
// LHL Over 2 state machine per symbol. Calls onSignal(symbol) the instant any
// symbol's pattern completes — caller is responsible for executing the trade.
export const useMultiMarketScanner = (
    symbols: TScanSymbol[],
    is_active: boolean,
    onSignal: (signal: TScanSignal) => void
) => {
    const [statuses, setStatuses] = useState<Record<string, TSymbolScanStatus>>({});
    const stateRef = useRef<Record<string, TPatternState>>({});
    const subscriptionIdsRef = useRef<Record<string, string>>({});
    const onSignalRef = useRef(onSignal);
    onSignalRef.current = onSignal;

    useEffect(() => {
        if (!is_active || symbols.length === 0) {
            setStatuses({});
            return;
        }

        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;
        stateRef.current = {};
        subscriptionIdsRef.current = {};

        const initial_statuses: Record<string, TSymbolScanStatus> = {};
        symbols.forEach(s => {
            stateRef.current[s.symbol] = initialPatternState();
            initial_statuses[s.symbol] = {
                symbol: s.symbol,
                display_name: s.display_name,
                stage: 0,
                last_digit: null,
                is_connected: false,
            };
        });
        setStatuses(initial_statuses);

        const start = async () => {
            message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                if (data?.msg_type !== 'tick') return;
                const symbol = data?.tick?.symbol;
                if (!symbol || !(symbol in stateRef.current)) return;

                const pip_size = api_base?.pip_sizes?.[symbol] ?? 2;
                const digit = Number(getLastDigitForList(Number(data.tick.quote), pip_size));
                const { state, signal } = stepPattern(stateRef.current[symbol], digit);
                stateRef.current[symbol] = state;

                setStatuses(prev => ({
                    ...prev,
                    [symbol]: {
                        symbol,
                        display_name: prev[symbol]?.display_name ?? symbol,
                        stage: state.stage,
                        last_digit: digit,
                        is_connected: true,
                    },
                }));

                if (signal) {
                    const display_name = symbols.find(s => s.symbol === symbol)?.display_name ?? symbol;
                    onSignalRef.current({ symbol, display_name, at: Date.now() });
                }
            });

            for (const s of symbols) {
                if (is_cancelled) return;
                try {
                    const res = await api_base.api.send({ ticks: s.symbol, subscribe: 1 });
                    if (res?.error) {
                        // eslint-disable-next-line no-console
                        console.warn(`[autotrade] Subscribe failed for ${s.symbol}:`, res.error.message || res.error);
                        continue;
                    }
                    if (res?.subscription?.id) {
                        subscriptionIdsRef.current[s.symbol] = res.subscription.id;
                    } else {
                        // eslint-disable-next-line no-console
                        console.warn(`[autotrade] No subscription id returned for ${s.symbol}`, res);
                    }
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn(`[autotrade] Subscribe threw for ${s.symbol}:`, e);
                }
            }
        };

        start();

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            Object.values(subscriptionIdsRef.current).forEach(id => {
                api_base.api.send({ forget: id }).catch(() => {});
            });
            subscriptionIdsRef.current = {};
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_active, symbols.map(s => s.symbol).join(',')]);

    return statuses;
};
