// Run mode for the trade engine.
//   slow (default): wait for each contract to close, then for the next tick.
//   fast: buy on every tick; earlier contracts keep settling in the background.
//   turbo: still one trade at a time (exact Martingale), but buy again the moment the
//          previous trade closes instead of idling until the next tick.
//
// The mode is NOT persisted: every page load starts in Slow (normal). A previously
// saved value is cleared so nobody stays stuck in Fast/Turbo without a visible switch.
const LEGACY_KEY = 'botmaster_run_mode';

let mode = 'slow';
try {
    localStorage.removeItem(LEGACY_KEY);
} catch {
    // storage unavailable
}

export const getRunMode = () => mode;
export const isFastMode = () => mode === 'fast';
export const isTurboMode = () => mode === 'turbo';
export const setRunMode = next => {
    if (next !== 'fast' && next !== 'slow' && next !== 'turbo') return;
    mode = next;
};
