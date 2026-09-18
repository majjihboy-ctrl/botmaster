import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        ensureTrackedSet() {
            if (!this.trackedContractIds) {
                this.trackedContractIds = new Set();
            }
            return this.trackedContractIds;
        }

        trackContractId(contractId) {
            if (!contractId) return;
            this.ensureTrackedSet().add(contractId);
        }

        forgetTrackedContract(contractId) {
            if (!contractId || !this.trackedContractIds) return;
            this.trackedContractIds.delete(contractId);
        }

        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.isKnownContractId(contract?.contract_id)) {
                        return;
                    }

                    const is_current =
                        Boolean(this.contractId) && contract.contract_id === this.contractId;
                    const is_sold = Boolean(contract.is_sold);

                    // Active trade: full engine path (same as original Deriv)
                    if (is_current) {
                        this.setContractFlags(contract);
                        this.data.contract = contract;

                        broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                        if (this.isSold) {
                            this.forgetTrackedContract(contract.contract_id);
                            this.contractId = '';
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
                        return;
                    }

                    // Late settlement for a previous contract: surface to Transactions
                    // without advancing/clearing the *current* trade state machine.
                    if (is_sold) {
                        broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
                        try {
                            this.updateTotals(contract);
                        } catch (e) {
                            // non-fatal — UI row is more important than totals edge cases
                        }
                        this.forgetTrackedContract(contract.contract_id);
                    }
                }
            });
            api_base.pushSubscription(subscription);
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

        /** Current contract OR one we bought this session (for late settlement). */
        isKnownContractId(contractId) {
            if (!contractId) return false;
            if (this.contractId && contractId === this.contractId) return true;
            return Boolean(this.trackedContractIds && this.trackedContractIds.has(contractId));
        }

        expectedContractId(contractId) {
            // Kept for callers that still use the old name (Sell, etc.)
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
