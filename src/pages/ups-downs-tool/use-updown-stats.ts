import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';

export type TUpDownStats = {
    // Sliding window (capped at tick_window), cheap to slice each tick
    recent_directions: (1 | -1 | 0)[]; // chronological, most recent last
    window_up_pct: number;
    window_down_pct: number;
    window_counts: { label: string; up_pct: number; down_pct: number }[];

    // Session-scoped (since armed / since last reset), O(1) per tick
    current_streak_count: number;
    current_streak_dir: 'up' | 'down' | null;
    ticks_since_up: number; // -1 = not seen this session
    ticks_since_down: number;
    up_streak_histogram: Record<number, number>; // completed run length -> occurrences
    down_streak_histogram: Record<number, number>;
    total_ticks_seen: number;

    current_quote: number | null;
    is_loading: boolean;
};

const EMPTY_STATS: TUpDownStats = {
    recent_directions: [],
    window_up_pct: 0,
    window_down_pct: 0,
    window_counts: [],
    current_streak_count: 0,
    current_streak_dir: null,
    ticks_since_up: -1,
    ticks_since_down: -1,
    up_streak_histogram: {},
    down_streak_histogram: {},
    total_ticks_seen: 0,
    current_quote: null,
    is_loading: true,
};

const SUB_WINDOWS = [50, 200];

class UpDownEngine {
    tick_window: number;
    directions: (1 | -1 | 0)[] = [];
    quotes: number[] = [];

    // session-scoped, never trimmed (reset only via resetSession())
    streak_count = 0;
    streak_dir: 'up' | 'down' | null = null;
    ticks_since_up = -1;
    ticks_since_down = -1;
    up_histogram: Record<number, number> = {};
    down_histogram: Record<number, number> = {};
    total_ticks_seen = 0;

    constructor(tick_window: number) {
        this.tick_window = tick_window;
    }

    resetSession() {
        this.streak_count = 0;
        this.streak_dir = null;
        this.ticks_since_up = -1;
        this.ticks_since_down = -1;
        this.up_histogram = {};
        this.down_histogram = {};
        this.total_ticks_seen = 0;
    }

    seed(initial_quotes: number[]) {
        this.quotes = initial_quotes.slice(-this.tick_window);
        this.directions = [];
        for (let i = 1; i < this.quotes.length; i++) {
            const diff = this.quotes[i] - this.quotes[i - 1];
            this.directions.push(diff > 0 ? 1 : diff < 0 ? -1 : 0);
        }
        this.directions.forEach(d => this.addDirection(d));
    }

    private addDirection(direction: 1 | -1 | 0) {
        this.total_ticks_seen += 1;

        if (direction === 1) {
            this.ticks_since_up = 0;
            if (this.ticks_since_down !== -1) this.ticks_since_down += 1;
        } else if (direction === -1) {
            this.ticks_since_down = 0;
            if (this.ticks_since_up !== -1) this.ticks_since_up += 1;
        } else {
            if (this.ticks_since_up !== -1) this.ticks_since_up += 1;
            if (this.ticks_since_down !== -1) this.ticks_since_down += 1;
        }

        if (direction === 0) {
            if (this.streak_dir !== null) {
                const hist = this.streak_dir === 'up' ? this.up_histogram : this.down_histogram;
                hist[this.streak_count] = (hist[this.streak_count] || 0) + 1;
            }
            this.streak_count = 0;
            this.streak_dir = null;
            return;
        }
        const dir = direction === 1 ? 'up' : 'down';
        if (this.streak_dir === dir) {
            this.streak_count += 1;
        } else {
            if (this.streak_dir !== null) {
                const hist = this.streak_dir === 'up' ? this.up_histogram : this.down_histogram;
                hist[this.streak_count] = (hist[this.streak_count] || 0) + 1;
            }
            this.streak_dir = dir;
            this.streak_count = 1;
        }
    }

    addTick(quote: number) {
        if (this.quotes.length > 0) {
            const prev = this.quotes[this.quotes.length - 1];
            const diff = quote - prev;
            const direction: 1 | -1 | 0 = diff > 0 ? 1 : diff < 0 ? -1 : 0;
            this.directions.push(direction);
            this.addDirection(direction);
        }
        this.quotes.push(quote);

        if (this.quotes.length > this.tick_window) {
            this.quotes.shift();
            this.directions.shift();
        }
    }

    getStats(): TUpDownStats {
        const up_count = this.directions.filter(d => d === 1).length;
        const down_count = this.directions.filter(d => d === -1).length;
        const move_total = up_count + down_count || 1;

        const window_counts = SUB_WINDOWS.filter(size => this.directions.length >= size).map(size => {
            const slice = this.directions.slice(-size);
            const up = slice.filter(d => d === 1).length;
            const down = slice.filter(d => d === -1).length;
            const total = up + down || 1;
            return {
                label: `Last ${Math.min(size, this.directions.length)}`,
                up_pct: Number(((up / total) * 100).toFixed(1)),
                down_pct: Number(((down / total) * 100).toFixed(1)),
            };
        });
        window_counts.push({
            label: `Last ${this.directions.length}`,
            up_pct: Number(((up_count / move_total) * 100).toFixed(1)),
            down_pct: Number(((down_count / move_total) * 100).toFixed(1)),
        });

        return {
            recent_directions: this.directions.slice(-100),
            window_up_pct: Number(((up_count / move_total) * 100).toFixed(1)),
            window_down_pct: Number(((down_count / move_total) * 100).toFixed(1)),
            window_counts,
            current_streak_count: this.streak_count,
            current_streak_dir: this.streak_dir,
            ticks_since_up: this.ticks_since_up,
            ticks_since_down: this.ticks_since_down,
            up_streak_histogram: { ...this.up_histogram },
            down_streak_histogram: { ...this.down_histogram },
            total_ticks_seen: this.total_ticks_seen,
            current_quote: this.quotes[this.quotes.length - 1] ?? null,
            is_loading: false,
        };
    }
}

export const useUpDownStats = (symbol: string, tick_window: number, reset_key: number) => {
    const [stats, setStats] = useState<TUpDownStats>(EMPTY_STATS);
    const engineRef = useRef<UpDownEngine | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);

    useEffect(() => {
        let is_cancelled = false;
        let message_subscription: { unsubscribe: () => void } | null = null;

        const start = async () => {
            setStats(prev => ({ ...prev, is_loading: true }));
            const engine = new UpDownEngine(Math.min(tick_window, 5000));
            engineRef.current = engine;

            try {
                const history_res = await api_base.api.send({
                    ticks_history: symbol,
                    count: Math.min(tick_window, 5000),
                    end: 'latest',
                    style: 'ticks',
                });
                if (is_cancelled) return;

                const prices: number[] = history_res?.history?.prices?.map(Number) ?? [];
                engine.seed(prices);
                setStats(engine.getStats());

                message_subscription = api_base.api.onMessage().subscribe(({ data }: { data: any }) => {
                    if (data?.msg_type !== 'tick' || data?.tick?.symbol !== symbol) return;
                    if (data.tick.id) subscriptionIdRef.current = data.tick.id;
                    engine.addTick(Number(data.tick.quote));
                    setStats(engine.getStats());
                });

                const sub_res = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                if (sub_res?.error) {
                    // eslint-disable-next-line no-console
                    console.warn(`[ups-downs] Subscribe failed for ${symbol}:`, sub_res.error.message || sub_res.error);
                } else if (sub_res?.subscription?.id) {
                    subscriptionIdRef.current = sub_res.subscription.id;
                }
            } catch (e) {
                if (!is_cancelled) setStats(prev => ({ ...prev, is_loading: false }));
            }
        };

        start();

        return () => {
            is_cancelled = true;
            message_subscription?.unsubscribe();
            if (subscriptionIdRef.current) {
                api_base.api.send({ forget: subscriptionIdRef.current }).catch(() => {});
                subscriptionIdRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, tick_window, reset_key]);

    return stats;
};
