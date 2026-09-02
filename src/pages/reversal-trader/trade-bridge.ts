const BRIDGE_KEY = 'reversal_trader_pending_config';

export type TPendingReversalConfig = {
    symbol: string;
    reference_digit: number;
    mode: 'evenodd' | 'overunder';
    threshold_digit: number;
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
