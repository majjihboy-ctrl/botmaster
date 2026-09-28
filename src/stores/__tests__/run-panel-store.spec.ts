import { contract_stages } from '@/constants/contract-stage';
import RunPanelStore from '../run-panel-store';

// The real bot-skeleton barrel pulls in Blockly, which cannot load under Jest.
// The store only needs the observer bus and a few enums from it here.
jest.mock('@/external/bot-skeleton', () => ({
    ErrorTypes: { RECOVERABLE_ERRORS: 'r', UNRECOVERABLE_ERRORS: 'u' },
    MessageTypes: {},
    observer: { register: jest.fn(), unregister: jest.fn(), unregisterAll: jest.fn(), emit: jest.fn() },
    unrecoverable_errors: [],
}));
jest.mock('@/external/bot-skeleton/scratch/utils', () => ({ getSelectedTradeType: jest.fn() }));
jest.mock('@/components/bot-notification/bot-notification', () => ({ botNotification: jest.fn() }));
jest.mock('@/utils/gtm', () => ({ __esModule: true, default: { pushDataLayer: jest.fn() } }));

const makeChild = () => {
    const dispose = jest.fn();
    return {
        dispose,
        disposeReactionsFn: dispose,
        registerReactions: jest.fn(() => dispose),
    };
};

const setup = () => {
    const journal = makeChild();
    const summary_card = makeChild();
    const transactions = makeChild();
    const root_store: any = {
        dbot: { getStrategySounds: () => [] },
        journal,
        summary_card,
        transactions,
    };
    const core: any = {
        client: { loginid: 'CR1' },
        common: { is_socket_opened: true },
        ui: { setAccountSwitcherDisabledMessage: jest.fn() },
    };
    return { store: new RunPanelStore(root_store, core), journal, summary_card, transactions };
};

describe('RunPanelStore reactions across RunPanel unmount/mount', () => {
    it('disposes reactions on unmount when no bot is running', () => {
        const { store, journal, summary_card, transactions } = setup();
        store.onUnmount();
        expect(journal.dispose).toHaveBeenCalled();
        expect(summary_card.dispose).toHaveBeenCalled();
        expect(transactions.dispose).toHaveBeenCalled();
    });

    it('re-registers the child stores reactions when the panel mounts again', () => {
        const { store, journal, summary_card, transactions } = setup();
        store.onUnmount();
        store.onMount();
        expect(journal.registerReactions).toHaveBeenCalledTimes(1);
        expect(summary_card.registerReactions).toHaveBeenCalledTimes(1);
        expect(transactions.registerReactions).toHaveBeenCalledTimes(1);
    });

    it('does not double-register on a plain mount (reactions were never disposed)', () => {
        const { store, journal } = setup();
        store.onMount();
        expect(journal.registerReactions).not.toHaveBeenCalled();
    });

    it('resets the contract stage after stopping, even after an unmount/mount cycle', () => {
        const { store } = setup();
        store.onUnmount();
        store.onMount();

        store.setContractStage(contract_stages.PURCHASE_SENT);
        store.setIsRunning(true);
        store.setIsRunning(false);

        // This reaction is disposed by onUnmount; without re-arming it the panel
        // stays stuck on PURCHASE_SENT after the bot has already stopped.
        expect(store.contract_stage).toBe(contract_stages.NOT_RUNNING);
    });
});
