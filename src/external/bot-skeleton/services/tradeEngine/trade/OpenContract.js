import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';
import { DURING_PURCHASE } from './state/constants';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (this.is_fast_mode && contract && this.fastContracts.has(contract.contract_id)) {
                        this.handleFastContract(contract);
                        return;
                    }

                    // Fast execution already settled this contract from the transaction message.
                    // The full update only refreshes its details (exit tick, times) for the UI.
                    if (contract && this.fastSettledIds.has(contract.contract_id)) {
                        this.reconcileFastSettled(contract);
                        return;
                    }

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    if (this.isSold) {
                        this.contractId = '';
                        // Timing diagnostics (shown in the Journal by Purchase.js).
                        this.timing = {
                            sold_at: performance.now(),
                            settle_lag_ms: contract.exit_tick_time
                                ? Math.round(Date.now() - Number(contract.exit_tick_time) * 1000)
                                : null,
                        };
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        // Fast mode: several contracts can be open at once, each tracked by id.
        handleFastContract(contract) {
            broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

            if (!contract.is_sold) return;

            this.fastContracts.delete(contract.contract_id);
            this.fastSettledCount++;
            // Queue the result instead of overwriting this.data.contract, so strategies
            // like Martingale see every settled contract once, in order.
            this.fastSettledQueue.push(contract);
            this.updateTotals(contract);
            contractStatus({
                id: 'contract.sold',
                data: contract.transaction_ids?.sell,
                contract,
            });
        }

        // Fast execution: settle from the account `transaction` (sell) message instead of waiting for
        // proposal_open_contract. Only for the plain one-contract-at-a-time flow.
        shouldFastSettleTransaction(transaction) {
            const contract_id = transaction?.contract_id;
            const contract = this.data?.contract;
            if (!contract_id || !this.contractId || contract_id !== this.contractId) return false;
            if (this.is_fast_mode || this.fastContracts.has(contract_id) || this.fastSettledIds.has(contract_id)) {
                return false;
            }
            // A manual sell has its own flow (waitForAfter) that must run through the normal path.
            if (this.sell_in_progress) return false;
            if (this.store.getState().scope !== DURING_PURCHASE) return false;
            if (contract?.contract_id !== contract_id) return false;

            const buy_price = Number(contract.buy_price);
            return Number.isFinite(buy_price) && buy_price > 0 && Number.isFinite(Number(transaction.amount));
        }

        handleFastSellTransaction(transaction) {
            const contract = this.data.contract;
            const { contract_id } = transaction;

            this.fastSettledIds.add(contract_id);
            if (this.fastSettledIds.size > 25) {
                this.fastSettledIds.delete(this.fastSettledIds.values().next().value);
            }

            const sell_price = Number(transaction.amount);
            const profit = getRoundedNumber(sell_price - Number(contract.buy_price), contract.currency);
            const settled = {
                ...contract,
                contract_id,
                sell_price,
                bid_price: sell_price,
                profit,
                is_sold: 1,
                is_expired: 1,
                is_valid_to_sell: 0,
                status: profit > 0 ? 'won' : 'lost',
                transaction_ids: { ...(contract.transaction_ids ?? {}), sell: transaction.transaction_id },
            };

            this.setContractFlags(settled);
            this.data.contract = settled;

            broadcastContract({ accountID: api_base.account_info.loginid, ...settled });

            this.contractId = '';
            this.timing = { sold_at: performance.now(), settle_lag_ms: null };
            clearTimeout(this.transaction_recovery_timeout);
            this.updateTotals(settled);
            contractStatus({
                id: 'contract.sold',
                data: settled.transaction_ids.sell,
                contract: settled,
            });

            if (this.afterPromise) {
                this.afterPromise();
            }

            this.store.dispatch(sell());
        }

        reconcileFastSettled(contract) {
            if (!contract.is_sold) return;
            broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
            if (this.data.contract?.contract_id === contract.contract_id) {
                this.data.contract = contract;
            }
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
