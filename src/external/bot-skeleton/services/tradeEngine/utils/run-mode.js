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

// Execution mode (Normal / Fast execution), switched from the run panel.
//   normal: settle a trade when its proposal_open_contract update says it is sold.
//   fast:   settle the moment the account `transaction` (sell) message arrives and buy
//           again right away instead of waiting for the next tick. The full contract
//           details are filled in afterwards when proposal_open_contract catches up.
// Persisted, because the run panel shows which one is active. Read live (no per-run
// capture), so switching applies to the next trade.
const EXECUTION_KEY = 'dbot_trade_execution_mode';

let execution_mode = (() => {
    try {
        return localStorage.getItem(EXECUTION_KEY) === 'fast' ? 'fast' : 'normal';
    } catch {
        return 'normal';
    }
})();

export const getExecutionMode = () => execution_mode;
export const isFastExecution = () => execution_mode === 'fast';
export const setExecutionMode = next => {
    if (next !== 'fast' && next !== 'normal') return;
    execution_mode = next;
    try {
        localStorage.setItem(EXECUTION_KEY, next);
    } catch {
        // storage unavailable
    }
};
