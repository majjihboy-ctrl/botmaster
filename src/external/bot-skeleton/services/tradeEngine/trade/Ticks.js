/* eslint-disable no-promise-executor-return */
import debounce from 'lodash.debounce';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { getLast } from '../../../utils/binary-utils';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import ApiHelpers from '../../api/api-helpers';
import { notify } from '../utils/broadcast';
import { getDirection, getLastDigit } from '../utils/helpers';
import { expectPositiveInteger } from '../utils/sanitize';
import * as constants from './state/constants';

let tickListenerKey;

// Submarket key of "Continuous Indices" (Volatility indices). The display name is translated, the key is not.
const CONTINUOUS_INDICES_SUBMARKET = 'random_index';

export default Engine =>
    class Ticks extends Engine {
        /**
         * Point the bot at `symbol`: stop and release the previous symbol's tick stream, then subscribe to the new
         * one. `this.symbol` is updated immediately so tick/digit/candle analysis reads the new market straight
         * away; the stream work is queued so rapid switches can never overlap.
         */
        watchTicks(symbol) {
            if (!symbol || this.symbol === symbol) {
                return this.symbol_task || Promise.resolve();
            }

            const previous_symbol = this.symbol;
            this.symbol = symbol;

            const run = (this.symbol_task || Promise.resolve())
                .catch(() => undefined)
                .then(() => this.moveTickStream(previous_symbol, symbol));
            this.symbol_task = run;
            return run;
        }

        async moveTickStream(previous_symbol, symbol) {
            const { ticksService } = this.$scope;

            if (previous_symbol) {
                await ticksService.stopMonitor({ symbol: previous_symbol, key: tickListenerKey });
                await ticksService.releaseSymbol(previous_symbol);
            }

            const callback = ticks => {
                // A tick that was already in flight for a market we have left must not drive the bot.
                if (this.symbol !== symbol) return;
                if (this.is_proposal_subscription_required) {
                    this.checkProposalReady();
                }
                const lastTick = ticks.slice(-1)[0];
                const { epoch } = lastTick;
                this.store.dispatch({ type: constants.NEW_TICK, payload: epoch });
            };

            tickListenerKey = await ticksService.monitor({ symbol, callback });
        }

        // ---- Market switching (Alternate markets / Set active symbol blocks) ----

        setForcedSymbol(symbol) {
            this.market_switch.forced_symbol = !symbol || symbol === 'disable' ? null : String(symbol);
        }

        setAlternateMarkets(enabled, every) {
            const runs = Math.max(1, Math.floor(Number(every)) || 1);
            this.market_switch.alternate = { enabled: !!enabled, every: runs };
        }

        getActiveSymbol() {
            return this.market_switch.current_symbol || this.options?.symbol;
        }

        /** Next Continuous Indices symbol after `current`, or null when `current` is not one of them. */
        getNextContinuousSymbol(current) {
            const list = ApiHelpers?.instance?.active_symbols?.getSymbolsForBot?.() || [];
            const values = list.filter(s => s?.submarket === CONTINUOUS_INDICES_SUBMARKET).map(s => s.value);
            const index = values.indexOf(current);
            if (index < 0) return null;
            return values[(index + 1) % values.length];
        }

        /**
         * Called once at the start of every trade cycle (before the trade options are built). Decides which market
         * the next trade is on and, if it changed, moves the tick stream there. Never rotates twice for the same
         * run count, so it is safe to call more than once per cycle.
         */
        applyMarketSwitch() {
            const state = this.market_switch;
            const base_symbol = this.options?.symbol;
            if (!state || !base_symbol) return;

            let target = state.current_symbol || base_symbol;

            if (state.forced_symbol) {
                target = state.forced_symbol;
            } else if (state.alternate.enabled) {
                const completed_runs = this.sessionRuns || 0;
                const is_due = completed_runs > 0 && completed_runs % state.alternate.every === 0;

                if (is_due && state.last_rotation_runs !== completed_runs) {
                    state.last_rotation_runs = completed_runs;
                    const next_symbol = this.getNextContinuousSymbol(target);

                    if (next_symbol) {
                        target = next_symbol;
                    } else if (!state.warned_not_continuous) {
                        state.warned_not_continuous = true;
                        notify(
                            'warn',
                            localize('Alternate markets only works with Continuous Indices; staying on {{ symbol }}.', {
                                symbol: target,
                            })
                        );
                    }
                }
            }

            if (target !== state.current_symbol) {
                const previous = state.current_symbol;
                state.current_symbol = target;
                if (previous) {
                    notify('info', localize('Switched market to {{ symbol }}', { symbol: target }));
                }
            }

            if (target !== this.symbol) {
                this.watchTicks(target);
            }
        }

        checkTicksPromiseExists() {
            return this.$scope.ticksService.ticks_history_promise;
        }

        getTicks(toString = false) {
            return new Promise(resolve => {
                this.$scope.ticksService.request({ symbol: this.symbol }).then(ticks => {
                    const ticks_list = ticks.map(tick => {
                        if (toString) {
                            return tick.quote.toFixed(this.getPipSize());
                        }
                        return tick.quote;
                    });

                    resolve(ticks_list);
                });
            });
        }

        getLastTick(raw, toString = false) {
            return new Promise((resolve, reject) =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => {
                        try {
                            let last_tick = raw ? getLast(ticks) : getLast(ticks).quote;
                            if (!raw && toString) {
                                last_tick = last_tick.toFixed(this.getPipSize());
                            }
                            resolve(last_tick);
                        } catch (error) {
                            reject(error);
                        }
                    })
                    .catch(e => {
                        if (e.code === 'MarketIsClosed') {
                            const localizedError = {
                                ...e,
                                message: getLocalizedErrorMessage(e.code, e.details),
                            };
                            globalObserver.emit('Error', localizedError);
                            resolve(e.code);
                        }
                    })
            );
        }

        getLastDigit() {
            return new Promise(resolve => this.getLastTick(false, true).then(tick => resolve(getLastDigit(tick))));
        }

        getLastDigitList() {
            return new Promise(resolve => this.getTicks().then(ticks => resolve(this.getLastDigitsFromList(ticks))));
        }
        getLastDigitsFromList(ticks) {
            const digits = ticks.map(tick => {
                return getLastDigit(tick.toFixed(this.getPipSize()));
            });
            return digits;
        }

        // ---- Analysis Logics helpers (used by the "Analysis Logics" blocks) ----

        static lastN(list, n) {
            const count = Math.floor(Number(n));
            return count > 0 ? list.slice(-count) : list;
        }

        async getLastDigitsCondition({ n = 3, op = 'LESS', digit = 0 } = {}) {
            const list = await this.getLastDigitList();
            const last_n = Ticks.lastN(list, n);
            const wanted = Math.max(1, Math.floor(Number(n)) || 1);
            // Not enough ticks yet to judge the condition.
            if (last_n.length < wanted) return false;

            const d = Number(digit);
            const compare =
                {
                    LESS: x => Number(x) < d,
                    LEQ: x => Number(x) <= d,
                    GREATER: x => Number(x) > d,
                    GEQ: x => Number(x) >= d,
                    EQ: x => Number(x) === d,
                    NEQ: x => Number(x) !== d,
                }[op] || (x => Number(x) === d);
            return last_n.every(compare);
        }

        async getDigitFrequency({ rank = 'MOST', n = 1000 } = {}) {
            const list = await this.getLastDigitList();
            const frequency = Array(10).fill(0);
            Ticks.lastN(list, n).forEach(value => {
                const digit = Number(value);
                if (digit >= 0 && digit <= 9) frequency[digit]++;
            });
            const entries = frequency.map((count, digit) => ({ digit, count }));
            entries.sort((a, b) => b.count - a.count);
            return rank === 'LEAST' ? entries[entries.length - 1].digit : entries[0].digit;
        }

        async getEvenOddPercent({ type = 'EVEN', n = 1000 } = {}) {
            const list = await this.getLastDigitList();
            const last_n = Ticks.lastN(list, n);
            const want_even = type === 'EVEN';
            const count = last_n.filter(x => (Number(x) % 2 === 0) === want_even).length;
            return Math.round((count / Math.max(1, last_n.length)) * 100);
        }

        async getOverUnderPercent({ threshold = 4, n = 1000, type = 'OVER' } = {}) {
            const list = await this.getLastDigitList();
            const last_n = Ticks.lastN(list, n);
            const limit = Number(threshold);
            const count = last_n.filter(x => (type === 'UNDER' ? Number(x) < limit : Number(x) > limit)).length;
            return Math.round((count / Math.max(1, last_n.length)) * 100);
        }

        async getMatchDiffPercent({ type = 'MATCH', val = 5, n = 1000 } = {}) {
            const list = await this.getLastDigitList();
            const last_n = Ticks.lastN(list, n);
            const want_match = type === 'MATCH';
            const digit = Number(val);
            const count = last_n.filter(x => (Number(x) === digit) === want_match).length;
            return Math.round((count / Math.max(1, last_n.length)) * 100);
        }

        async getRiseFallPercent({ type = 'RISE', n = 1000 } = {}) {
            const ohlc = await this.getOhlc();
            const last_n = Ticks.lastN(ohlc || [], n);
            const count = last_n.filter(o =>
                type === 'RISE' ? Number(o.close) > Number(o.open) : Number(o.close) < Number(o.open)
            ).length;
            return Math.round((count / Math.max(1, last_n.length)) * 100);
        }

        checkDirection(dir) {
            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => resolve(getDirection(ticks) === dir))
            );
        }

        getOhlc(args) {
            const { granularity = this.options.candleInterval || 60, field } = args || {};

            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol, granularity })
                    .then(ohlc => resolve(field ? ohlc.map(o => o[field]) : ohlc))
            );
        }

        getOhlcFromEnd(args) {
            const { index: i = 1 } = args || {};

            const index = expectPositiveInteger(Number(i), localize('Index must be a positive integer'));

            return new Promise(resolve => this.getOhlc(args).then(ohlc => resolve(ohlc.slice(-index)[0])));
        }

        getPipSize() {
            return this.$scope.ticksService.pipSizes[this.symbol];
        }

        async requestAccumulatorStats() {
            const subscription_id = this.subscription_id_for_accumulators;
            const is_proposal_requested = this.is_proposal_requested_for_accumulators;
            const proposal_request = {
                ...window.Blockly.accumulators_request,
                amount: this?.tradeOptions?.amount,
                basis: this?.tradeOptions?.basis,
                contract_type: 'ACCU',
                currency: this?.tradeOptions?.currency,
                growth_rate: this?.tradeOptions?.growth_rate,
                proposal: 1,
                subscribe: 1,
                underlying_symbol: this?.tradeOptions?.symbol,
            };
            if (!subscription_id && !is_proposal_requested) {
                this.is_proposal_requested_for_accumulators = true;
                if (proposal_request) {
                    await api_base?.api?.send(proposal_request);
                }
            }
        }

        async handleOnMessageForAccumulators() {
            let ticks_stayed_in_list = [];
            return new Promise(resolve => {
                const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                    if (data.msg_type === 'proposal') {
                        try {
                            this.subscription_id_for_accumulators = data.subscription.id;
                            // this was done because we can multile arrays in the respone and the list comes in reverse order
                            const stat_list = (data.proposal.contract_details.ticks_stayed_in || []).flat().reverse();
                            ticks_stayed_in_list = [...stat_list, ...ticks_stayed_in_list];
                            if (ticks_stayed_in_list.length > 0) resolve(ticks_stayed_in_list);
                        } catch (error) {
                            globalObserver.emit('Unexpected message type or no proposal found:', error);
                        }
                    }
                });
                api_base.pushSubscription(subscription);
            });
        }

        async fetchStatsForAccumulators() {
            try {
                // request stats for accumulators
                const debouncedAccumulatorsRequest = debounce(() => this.requestAccumulatorStats(), 300);
                debouncedAccumulatorsRequest();
                // wait for proposal response
                const ticks_stayed_in_list = await this.handleOnMessageForAccumulators();
                return ticks_stayed_in_list;
            } catch (error) {
                globalObserver.emit('Error in subscription promise:', error);
                throw error;
            } finally {
                // forget all proposal subscriptions so we can fetch new stats data on new call
                await api_base?.api?.send({ forget_all: 'proposal' });
                this.is_proposal_requested_for_accumulators = false;
                this.subscription_id_for_accumulators = null;
            }
        }

        async getCurrentStat() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                return ticks_stayed_in?.[0];
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getStatList() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                // we need to send only lastest 100 ticks
                return ticks_stayed_in?.slice(0, 100);
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getDelayTickValue(tick_value) {
            return new Promise((resolve, reject) => {
                try {
                    const ticks = [];
                    const symbol = this.symbol;

                    const resolveAndExit = () => {
                        this.$scope.ticksService.stopMonitor({
                            symbol,
                            key: '',
                        });
                        resolve(ticks);
                        ticks.length = 0;
                    };

                    const watchTicks = tick_list => {
                        ticks.push(tick_list);
                        const current_tick = ticks.length;
                        if (current_tick === tick_value) {
                            resolveAndExit();
                        }
                    };

                    const delayExecution = tick_list => watchTicks(tick_list);

                    if (Number(tick_value) <= 0) resolveAndExit();
                    this.$scope.ticksService.monitor({ symbol, callback: delayExecution });
                } catch (error) {
                    reject(new Error(`Failed to start tick monitoring: ${error.message}`));
                }
            });
        }
    };
