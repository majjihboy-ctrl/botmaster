import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone } from '../utils/helpers';
import { isFastMode, isTurboMode } from '../utils/run-mode';
import { expectInitArg } from '../utils/sanitize';
import { proposalsReady, start } from './state/actions';
import * as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
    });

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

// Turbo mode: right after a trade closes and Bot.start has run, buy as soon as the
// proposals are ready instead of idling until the next tick arrives. One-shot per
// trade cycle (see turboImmediate) so a strategy that doesn't buy never busy-loops.
const watchBeforeImmediate = store => {
    const check = state => {
        if (state.scope === constants.DURING_PURCHASE) return false;
        if (state.scope === constants.BEFORE_PURCHASE && state.proposalsReady) return true;
        return undefined;
    };
    const first = check(store.getState());
    if (first !== undefined) return Promise.resolve(first);
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const result = check(store.getState());
            if (result !== undefined) {
                unsubscribe();
                resolve(result);
            }
        });
    });
};

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
const watchScope = ({ store, stopScope, passScope, passFlag }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;

            if (newState.scope === passScope && newState[passFlag]) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.is_fast_mode = false;
        this.is_turbo_mode = false;
        this.turboImmediate = false;
        this.fastContracts = new Set();
        this.fastPurchased = false;
        this.fastSettledCount = 0;
        // Settled contracts waiting for the after-purchase logic, in settlement order.
        this.fastSettledQueue = [];
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        // Market switching state (set by the Alternate markets / Set active symbol blocks via Bot.* calls).
        this.market_switch = {
            forced_symbol: null,
            alternate: { enabled: false, every: 1 },
            current_symbol: null,
            last_rotation_runs: -1,
            warned_not_continuous: false,
        };
        this.store = createStore(rootReducer, applyMiddleware(thunk));
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;
        this.is_fast_mode = isFastMode();
        this.is_turbo_mode = isTurboMode();
        this.startPromise = this.loginAndGetBalance(token);

        // After a restart-on-error the bot is re-initialised with the original market; keep following the market
        // it had switched to so the tick stream and the trades stay on the same symbol.
        if (!this.checkTicksPromiseExists()) this.watchTicks(this.market_switch.current_symbol || symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            throw createError('NotInitialized', getLocalizedErrorMessage('NotInitialized'));
        }

        globalObserver.emit('bot.running');

        const validated_trade_options = this.validateTradeOptions(tradeOptions);

        // Decide which market this trade is on (Alternate markets / forced symbol) before building the options.
        this.applyMarketSwitch();

        this.tradeOptions = { ...validated_trade_options, symbol: this.getActiveSymbol() };
        this.store.dispatch(start());
        this.turboImmediate = this.is_turbo_mode;
        this.checkLimits(validated_trade_options);

        this.makeDirectPurchaseDecision();
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;
        return new Promise(resolve => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'transaction' && data.transaction.action === 'sell') {
                    this.transaction_recovery_timeout = setTimeout(() => {
                        const { contract } = this.data;
                        const is_same_contract = contract.contract_id === data.transaction.contract_id;
                        const is_open_contract = contract.status === 'open';
                        if (is_same_contract && is_open_contract) {
                            doUntilDone(() => {
                                api_base.api.send({ proposal_open_contract: 1, contract_id: contract.contract_id });
                            }, ['PriceMoved']);
                        }
                    }, 1500);
                }
                resolve();
            });
            api_base.pushSubscription(subscription);
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();
    }

    watch(watchName) {
        if (watchName === 'before') {
            if (this.turboImmediate) {
                this.turboImmediate = false;
                return watchBeforeImmediate(this.store);
            }
            return watchBefore(this.store);
        }
        if (this.is_fast_mode && this.fastPurchased) {
            // Fast mode: don't wait for the contract to close. Release the engine
            // (scope STOP) so Bot.start can run again; the contract is tracked in
            // the background by fastContracts.
            this.fastPurchased = false;
            this.store.dispatch({ type: constants.SELL });
            return Promise.resolve(false);
        }
        return watchDuring(this.store);
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
        }
    }
}
