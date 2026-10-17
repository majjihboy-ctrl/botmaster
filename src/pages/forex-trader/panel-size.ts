import { useSyncExternalStore } from 'react';

/**
 * Width of the Forex Trader side panel (desktop). Shared between the panel
 * itself and the TradingView page, so the chart area always leaves exactly
 * the room the panel takes. Remembered between visits.
 */
export const PANEL_MIN_WIDTH = 366;
const KEY = 'epm_forex_panel_width';

const maxWidth = () => Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.85));
const clamp = (w: number) => Math.min(maxWidth(), Math.max(PANEL_MIN_WIDTH, Math.round(w)));

let width = PANEL_MIN_WIDTH;
try {
    const saved = Number(window.localStorage.getItem(KEY));
    if (saved > 0) width = clamp(saved);
} catch {
    /* storage may be blocked: the default width is fine */
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
};

export const getPanelWidth = () => width;

export const setPanelWidth = (w: number, save = true) => {
    const next = clamp(w);
    if (next === width) return;
    width = next;
    if (save) {
        try {
            window.localStorage.setItem(KEY, String(next));
        } catch {
            /* ignore */
        }
    }
    listeners.forEach(fn => fn());
};

/** Saves the current width (called when a drag ends). */
export const savePanelWidth = () => {
    try {
        window.localStorage.setItem(KEY, String(width));
    } catch {
        /* ignore */
    }
};

/** Wide = about 60% of the screen, normal = the original narrow width. */
export const toggleWidePanel = () => {
    const wide = Math.floor(window.innerWidth * 0.6);
    setPanelWidth(width > PANEL_MIN_WIDTH + 40 ? PANEL_MIN_WIDTH : wide);
};

export const usePanelWidth = () => useSyncExternalStore(subscribe, getPanelWidth, () => PANEL_MIN_WIDTH);
