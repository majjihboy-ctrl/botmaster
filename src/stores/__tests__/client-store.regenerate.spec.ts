import ClientStore from '../client-store';

const mockInit = jest.fn();
let mockActiveId: string | null = 'CR123';

jest.mock('@/utils/account-helpers', () => ({ getAccountId: () => mockActiveId }));
jest.mock('@/external/bot-skeleton', () => ({
    observer: { setState: jest.fn(), getState: jest.fn(), register: jest.fn(), unregister: jest.fn() },
}));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { init: (...a: unknown[]) => mockInit(...a), api: null, is_running: false },
}));
jest.mock('@/external/bot-skeleton/services/api/appId', () => ({ clearDerivApiInstance: jest.fn() }));
jest.mock('@/services/derivws-accounts.service', () => ({ DerivWSAccountsService: { clearCache: jest.fn() } }));
jest.mock('@/components/shared/utils/storage/storage', () => ({ removeCookies: jest.fn() }));
jest.mock('../../external/bot-skeleton/services/api/observables/connection-status-stream', () => ({
    authData$: { subscribe: () => ({ unsubscribe: jest.fn() }) },
    setAccountList: jest.fn(),
    setAuthData: jest.fn(),
    setIsAuthorized: jest.fn(),
}));

describe('ClientStore.regenerateWebSocket loading flag', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockInit.mockReset();
        mockActiveId = 'CR123';
    });
    afterEach(() => jest.useRealTimers());

    it('does not stay hidden forever when init never resolves', async () => {
        mockInit.mockReturnValue(new Promise(() => {})); // hangs
        const store = new ClientStore({} as never);
        const run = store.regenerateWebSocket();
        expect(store.is_account_regenerating).toBe(true);

        await jest.advanceTimersByTimeAsync(15000); // init timeout fires
        await run;
        expect(store.is_regenerating).toBe(false); // later switches are no longer ignored

        await jest.advanceTimersByTimeAsync(12000); // watchdog releases the flag
        expect(store.is_account_regenerating).toBe(false);
        store.destroy();
    });

    it('releases the flag when there is no active account', async () => {
        mockActiveId = null;
        const store = new ClientStore({} as never);
        await store.regenerateWebSocket();
        expect(store.is_account_regenerating).toBe(true);
        await jest.advanceTimersByTimeAsync(12000);
        expect(store.is_account_regenerating).toBe(false);
        store.destroy();
    });
});
