const STORAGE_KEY = 'copy_trading_settings';

export type TCopySettings = {
    // Stake sizing
    follow_master_stake: boolean; // if true, ignore fixed_stake and mirror the master's own stake each trade
    fixed_stake: number;
    // Martingale (multiply stake after N consecutive losses)
    martingale_enabled: boolean;
    martingale_mult: number;
    do_martingale_at: number; // consecutive losses before scaling kicks in
    max_martingale_steps: number;
    // Compounding (multiply stake after consecutive wins)
    compounding_enabled: boolean;
    compounding_mult: number;
    max_compound_steps: number;
    // Session limits
    stop_loss: number; // 0 = disabled
    take_profit: number; // 0 = disabled
    // Filters
    allowed_symbols: string[]; // empty = allow all
    // Wait for the master to lose N in a row before copying the next trade
    wait_for_loss: number; // 0 = disabled
};

export const DEFAULT_COPY_SETTINGS: TCopySettings = {
    follow_master_stake: false,
    fixed_stake: 1,
    martingale_enabled: false,
    martingale_mult: 2,
    do_martingale_at: 1,
    max_martingale_steps: 5,
    compounding_enabled: false,
    compounding_mult: 1.5,
    max_compound_steps: 3,
    stop_loss: 0,
    take_profit: 0,
    allowed_symbols: [],
    wait_for_loss: 0,
};

export const loadCopySettings = (): TCopySettings => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_COPY_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_COPY_SETTINGS };
    } catch {
        return { ...DEFAULT_COPY_SETTINGS };
    }
};

export const saveCopySettings = (settings: Partial<TCopySettings>) => {
    try {
        const current = loadCopySettings();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
    } catch {
        // non-fatal — settings just won't be remembered next time
    }
};
