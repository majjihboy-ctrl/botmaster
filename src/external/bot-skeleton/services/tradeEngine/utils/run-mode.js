// Run mode for the trade engine.
//   slow (default): wait for each contract to close before trading again.
//   fast: buy on every tick; earlier contracts keep settling in the background.
const KEY = 'botmaster_run_mode';

let mode = 'slow';
try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'fast' || saved === 'slow') mode = saved;
} catch {
    // storage unavailable
}

export const getRunMode = () => mode;
export const isFastMode = () => mode === 'fast';
export const setRunMode = next => {
    if (next !== 'fast' && next !== 'slow') return;
    mode = next;
    try {
        localStorage.setItem(KEY, next);
    } catch {
        // storage unavailable
    }
};
