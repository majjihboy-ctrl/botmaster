import { localize } from '@deriv-com/translations';
import { getLastDigit } from '../utils/helpers';
import { notify } from '../utils/broadcast';
import { purchaseSuccessful, sell } from './state/actions';

/**
 * Virtual Hook: trade on paper, go real only after a losing streak.
 *
 * While enabled the bot starts in VIRTUAL mode. Every purchase is then simulated: no money is spent and
 * nothing is sent to Deriv. The engine watches the live ticks, settles the contract itself and runs the
 * bot's normal "after purchase" logic with that result.
 *   - VIRTUAL mode: after `virtualLosses` virtual losses in a row, switch to REAL.
 *   - REAL mode:    after `realWins` real wins, switch back to VIRTUAL.
 *
 * Virtual trades are logged in the Journal but are not counted in the real totals, transactions or
 * summary. Supported: tick contracts of the digit family (over/under, matches/differs, even/odd) and
 * rise/fall. Anything else stops the bot with a clear error rather than silently trading real money.
 */

const DIGIT_RULES = {
    DIGITOVER: (digit, barrier) => digit > barrier,
    DIGITUNDER: (digit, barrier) => digit < barrier,
    DIGITMATCH: (digit, barrier) => digit === barrier,
    DIGITDIFF: (digit, barrier) => digit !== barrier,
    DIGITEVEN: digit => digit % 2 === 0,
    DIGITODD: digit => digit % 2 !== 0,
};
const NEEDS_BARRIER = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];
const RISE_FALL = ['CALL', 'PUT'];

// Used only when the live payout is not known (proposals not subscribed). Virtual profit never touches
// real money; it just lets the bot's own stake logic see a normal-looking win.
const ESTIMATED_PAYOUT_RATIO = 1.95;

const round2 = n => Math.round(n * 100) / 100;

const virtualHookError = message =>
    Object.assign(new Error(message), { name: 'VirtualHookError', code: 'VirtualHookError' });

export default Engine =>
    class VirtualHook extends Engine {
        vhState() {
            if (!this.vh) {
                this.vh = {
                    enabled: false,
                    mode: 'virtual',
                    lossStreak: 0,
                    realWins: 0,
                    virtualLosses: 1,
                    realWinsNeeded: 2,
                    pending: null,
                    count: 0,
                };
            }
            return this.vh;
        }

        // Safe to call every tick: it only updates the numbers and never resets progress.
        configureVirtualHook({ virtualLosses, realWins } = {}) {
            const vh = this.vhState();
            const losses = Math.floor(Number(virtualLosses));
            const wins = Math.floor(Number(realWins));
            if (Number.isFinite(losses) && losses >= 1) vh.virtualLosses = losses;
            if (Number.isFinite(wins) && wins >= 1) vh.realWinsNeeded = wins;
        }

        // Safe to call every tick: only an off -> on change starts a fresh (virtual) cycle.
        enableVirtualHook(enabled) {
            const vh = this.vhState();
            const on = Boolean(enabled);
            if (on && !vh.enabled) {
                vh.mode = 'virtual';
                vh.lossStreak = 0;
                vh.realWins = 0;
                notify(
                    'info',
                    localize(
                        'Virtual Hook ON: trading virtually (no money) until {{losses}} virtual loss(es) in a row.',
                        { losses: vh.virtualLosses }
                    )
                );
            } else if (!on && vh.enabled) {
                this.abandonPendingVirtualTrade();
                notify('info', localize('Virtual Hook OFF: every trade is real again.'));
            }
            vh.enabled = on;
        }

        shouldTradeVirtually() {
            return Boolean(this.vh && this.vh.enabled && this.vh.mode === 'virtual');
        }

        abandonPendingVirtualTrade() {
            const pending = this.vh && this.vh.pending;
            if (!pending) return;
            pending.settled = true;
            if (pending.stop) pending.stop();
            this.vh.pending = null;
            this.contractId = '';
        }

        // Replaces a real purchase while in virtual mode. Resolves once the virtual contract is "open";
        // the result arrives later through the live ticks.
        async virtualPurchase(contract_type) {
            const vh = this.vhState();
            const options = this.tradeOptions || {};
            const duration = Number(options.duration);
            const amount = Number(options.amount);
            const isDigit = Object.prototype.hasOwnProperty.call(DIGIT_RULES, contract_type);

            if (!isDigit && !RISE_FALL.includes(contract_type)) {
                throw virtualHookError(
                    localize(
                        'Virtual Hook supports digit and rise/fall contracts. Disable it or change the contract type.'
                    )
                );
            }
            if (options.duration_unit !== 't' || !Number.isFinite(duration) || duration < 1) {
                throw virtualHookError(
                    localize('Virtual Hook needs a duration in ticks. Disable it or change the duration.')
                );
            }
            const barrier = Number(options.prediction);
            if (NEEDS_BARRIER.includes(contract_type) && !Number.isFinite(barrier)) {
                throw virtualHookError(localize('Virtual Hook needs a last-digit prediction for this contract.'));
            }

            const proposal = (this.data?.proposals || []).find(
                p => p.contract_type === contract_type && p.purchase_reference === this.getPurchaseReference?.()
            );
            const payout = Number(proposal?.payout) > 0 ? Number(proposal.payout) : amount * ESTIMATED_PAYOUT_RATIO;

            const symbol = this.symbol;
            const last_tick = await this.getLastTick(true);
            const id = `virtual-${(vh.count += 1)}`;

            this.isSold = false;
            this.contractId = id;
            this.sell_in_progress = false;
            vh.pending = {
                id,
                contract_type,
                barrier,
                amount,
                payout,
                duration,
                symbol,
                start_epoch: Number(last_tick?.epoch) || 0,
                settled: false,
                stop: null,
            };

            this.store.dispatch(purchaseSuccessful());
            notify(
                'info',
                localize('Virtual trade started: {{contract}} (no money, settles in {{ticks}} tick(s)).', {
                    contract: this.describeVirtualContract(contract_type, barrier),
                    ticks: duration,
                })
            );

            const key = await this.$scope.ticksService.monitor({
                symbol,
                callback: ticks => this.onVirtualTicks(id, ticks),
            });
            const pending = vh.pending;
            const stop = () => this.$scope.ticksService.stopMonitor({ symbol, key });
            if (pending && pending.id === id) {
                pending.stop = stop;
                if (pending.settled) stop(); // it settled while the subscription was being set up
            } else {
                stop();
            }
        }

        describeVirtualContract(contract_type, barrier) {
            const name = contract_type.replace('DIGIT', '').toLowerCase();
            return NEEDS_BARRIER.includes(contract_type) ? `${name} ${barrier}` : name;
        }

        onVirtualTicks(id, ticks) {
            const pending = this.vh && this.vh.pending;
            if (!pending || pending.settled || pending.id !== id || !Array.isArray(ticks)) return;

            // Entry is the first tick after the purchase; the contract ends after `duration` ticks.
            const fresh = ticks.filter(tick => Number(tick.epoch) > pending.start_epoch);
            if (fresh.length < pending.duration) return;

            pending.settled = true;
            if (pending.stop) pending.stop();
            this.settleVirtualContract(pending, fresh[0], fresh[pending.duration - 1]);
        }

        settleVirtualContract(pending, entry, exit) {
            const pip = typeof this.getPipSize === 'function' ? this.getPipSize() : 2;
            const exit_text = Number(exit.quote).toFixed(pip);
            const exit_digit = getLastDigit(exit_text);

            const won = Object.prototype.hasOwnProperty.call(DIGIT_RULES, pending.contract_type)
                ? DIGIT_RULES[pending.contract_type](exit_digit, pending.barrier)
                : pending.contract_type === 'CALL'
                  ? Number(exit.quote) > Number(entry.quote)
                  : Number(exit.quote) < Number(entry.quote);

            const sell_price = won ? round2(pending.payout) : 0;
            const contract = {
                contract_id: pending.id,
                contract_type: pending.contract_type,
                currency: this.tradeOptions?.currency,
                underlying: pending.symbol,
                buy_price: pending.amount,
                sell_price,
                bid_price: sell_price,
                payout: sell_price,
                profit: round2(sell_price - pending.amount),
                status: won ? 'won' : 'lost',
                is_sold: 1,
                is_expired: 1,
                is_completed: true,
                is_valid_to_sell: 0,
                entry_tick: Number(entry.quote).toFixed(pip),
                entry_tick_time: entry.epoch,
                exit_tick: exit_text,
                exit_tick_time: exit.epoch,
                barrier: Number.isFinite(pending.barrier) ? String(pending.barrier) : undefined,
                transaction_ids: { buy: pending.id, sell: pending.id },
                is_virtual_hook: true,
            };

            if (typeof this.setContractFlags === 'function') this.setContractFlags(contract);
            this.data.contract = contract;
            this.contractId = '';
            this.vh.pending = null;

            notify(
                won ? 'success' : 'warn',
                localize('Virtual trade {{result}}: {{contract}}, exit digit {{digit}}.', {
                    result: won ? localize('WON') : localize('LOST'),
                    contract: this.describeVirtualContract(pending.contract_type, pending.barrier),
                    digit: exit_digit,
                })
            );

            // Not counted in the real totals, transactions or summary (no updateTotals / broadcast).
            this.recordVirtualHookResult(contract);

            if (this.afterPromise) this.afterPromise();
            this.store.dispatch(sell());
        }

        // Called after every settled trade, real or virtual. Moves between VIRTUAL and REAL mode.
        recordVirtualHookResult(contract) {
            const vh = this.vh;
            if (!vh || !vh.enabled || !contract) return;
            const won = contract.status === 'won' || Number(contract.profit) > 0;

            if (contract.is_virtual_hook) {
                if (vh.mode !== 'virtual') return;
                vh.lossStreak = won ? 0 : vh.lossStreak + 1;
                if (vh.lossStreak >= vh.virtualLosses) {
                    vh.mode = 'real';
                    vh.realWins = 0;
                    notify(
                        'info',
                        localize(
                            'Virtual Hook: {{losses}} virtual loss(es) in a row. Trading REAL until {{wins}} real win(s).',
                            { losses: vh.lossStreak, wins: vh.realWinsNeeded }
                        )
                    );
                    vh.lossStreak = 0;
                }
                return;
            }

            if (vh.mode !== 'real' || !won) return;
            vh.realWins += 1;
            if (vh.realWins >= vh.realWinsNeeded) {
                vh.mode = 'virtual';
                vh.lossStreak = 0;
                notify(
                    'info',
                    localize('Virtual Hook: {{wins}} real win(s). Back to virtual trading.', { wins: vh.realWins })
                );
                vh.realWins = 0;
            }
        }
    };
