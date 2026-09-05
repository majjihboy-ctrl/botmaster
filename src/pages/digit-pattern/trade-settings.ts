const LAST_SETTINGS_KEY = 'digit_pattern_last_settings';

export type TLastSettings = {
    initial_stake: number;
    martingale_mult: number;
    max_martingale_steps: number;
    stop_loss: number;
    take_profit: number;
    min_streak: number;
};

export const loadLastSettings = (): Partial<TLastSettings> => {
    try {
        const raw = localStorage.getItem(LAST_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

export const saveLastSettings = (settings: Partial<TLastSettings>) => {
    try {
        const current = loadLastSettings();
        localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
    } catch {
        // non-fatal — trade settings just won't be remembered next time
    }
};
