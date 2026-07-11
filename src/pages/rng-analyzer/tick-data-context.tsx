import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type TTickSource = 'none' | 'crypto-random' | 'flawed-lcg' | 'pasted' | 'live-deriv';

// Caps the buffer so a long-running live session doesn't slowly degrade the
// chi-square/autocorrelation recompute (both re-run on every new tick).
const MAX_TICKS = 5000;

type TTickDataContextValue = {
    ticks: number[];
    source: TTickSource;
    addTicks: (newTicks: number[], source?: TTickSource) => void;
    setTicks: (newTicks: number[], source?: TTickSource) => void;
    clearTicks: () => void;
};

const TickDataContext = createContext<TTickDataContextValue | null>(null);

/** True random digits via the browser's CSPRNG — not a PRNG, actual entropy. */
export function generateCryptoRandomDigits(count: number): number[] {
    const bytes = new Uint32Array(count);
    crypto.getRandomValues(bytes);
    // Modulo-10 bias from a 32-bit value is negligible (~2.3e-9 relative
    // skew per bucket) — acceptable for a "known-good control sample" whose
    // whole purpose is to sail through the randomness tests below.
    return Array.from(bytes, b => b % 10);
}

/** A deliberately weak LCG (classic ANSI C constants) — a known-flawed control sample. */
export function generateFlawedLCGDigits(count: number, seed = Date.now()): number[] {
    const a = 1103515245;
    const c = 12345;
    const m = 2 ** 31;
    let x = seed % m;
    const digits: number[] = [];
    for (let i = 0; i < count; i++) {
        x = (a * x + c) % m;
        digits.push(Math.abs(x) % 10);
    }
    return digits;
}

export const TickDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [ticks, setTicksState] = useState<number[]>([]);
    const [source, setSource] = useState<TTickSource>('none');

    const addTicks = useCallback((newTicks: number[], src: TTickSource = 'pasted') => {
        setTicksState(prev => {
            const combined = [...prev, ...newTicks];
            return combined.length > MAX_TICKS ? combined.slice(combined.length - MAX_TICKS) : combined;
        });
        setSource(src);
    }, []);

    const setTicks = useCallback((newTicks: number[], src: TTickSource = 'pasted') => {
        setTicksState(newTicks);
        setSource(src);
    }, []);

    const clearTicks = useCallback(() => {
        setTicksState([]);
        setSource('none');
    }, []);

    const value = useMemo(
        () => ({ ticks, source, addTicks, setTicks, clearTicks }),
        [ticks, source, addTicks, setTicks, clearTicks]
    );

    return <TickDataContext.Provider value={value}>{children}</TickDataContext.Provider>;
};

export const useTickData = (): TTickDataContextValue => {
    const ctx = useContext(TickDataContext);
    if (!ctx) throw new Error('useTickData must be used within a TickDataProvider');
    return ctx;
};
