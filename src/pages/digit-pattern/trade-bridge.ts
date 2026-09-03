const BRIDGE_KEY = 'reversal_trader_pending_config';

export type TPendingReversalConfig = {
    symbol: string;
    reference_digit: number;
    mode: 'evenodd' | 'overunder';
    threshold_digit: number;
    // The streak as it stood in Signals at the moment "Trade this" was
    // clicked. Handed over so Reversal Trader can act on it immediately
    // instead of rebuilding the same pattern from scratch on live ticks.
    current_streak: number;
    current_direction: 'even' | 'odd' | 'over' | 'under';
};

export const setPendingReversalConfig = (config: TPendingReversalConfig) => {
    try {
        sessionStorage.setItem(BRIDGE_KEY, JSON.stringify(config));
    } catch {
        // sessionStorage unavailable — the bridge just won't pre-fill, non-fatal.
    }
};

/** Reads and immediately clears the pending config so it only applies once. */
export const consumePendingReversalConfig = (): TPendingReversalConfig | null => {
    try {
        const raw = sessionStorage.getItem(BRIDGE_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(BRIDGE_KEY);
        return JSON.parse(raw);
    } catch {
        return null;
    }
};
