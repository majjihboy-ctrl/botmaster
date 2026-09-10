import { isProduction } from '@/components/shared';
import brandConfig from '../../../brand.config.json';

// A "master trade" ready to be mirrored onto the follower's own account.
// Field names are already normalized to what requestOptionsProposalForQS
// expects (see options-proposal-handler.tsx) — underlying_symbol, not symbol.
export type TMasterTrade = {
    contract_id: number;
    contract_type: string;
    underlying_symbol: string;
    buy_price: number;
    duration: number;
    duration_unit: 't' | 's';
    barrier?: number;
};

export type TMasterConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

type TListener = {
    onStatus: (status: TMasterConnectionStatus, message?: string) => void;
    onTrade: (trade: TMasterTrade) => void;
    onOutcome: (contract_id: number, win: boolean) => void;
};

const getBaseURL = () => {
    const env = isProduction() ? 'production' : 'staging';
    return brandConfig.platform.derivws.url[env];
};

// Independent of DerivWSAccountsService's own singleton/cache — that service
// is keyed to the logged-in user's own token, and reusing it here would race
// against the app's own connection setup. This fetches an OTP URL for an
// arbitrary (master's) token instead, hitting the same REST endpoints
// directly.
const fetchMasterAccounts = async (accessToken: string) => {
    const baseURL = getBaseURL();
    const optionsDir = brandConfig.platform.derivws.directories.options;
    const response = await fetch(`${baseURL}${optionsDir}accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Could not read that trader's accounts (${response.status}).`);
    const body = await response.json();
    return body?.data ?? [];
};

const fetchMasterOtpUrl = async (accessToken: string, accountId: string) => {
    const baseURL = getBaseURL();
    const optionsDir = brandConfig.platform.derivws.directories.options;
    const response = await fetch(`${baseURL}${optionsDir}accounts/${accountId}/otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Could not authenticate that trader's token (${response.status}).`);
    const body = await response.json();
    const url = body?.data?.url;
    if (!url) throw new Error("Trader's token did not return a connection URL.");
    return url as string;
};

// Pulls whichever underlying-symbol field name is actually present —
// the new Options API uses underlying_symbol, but proposal_open_contract's
// exact field naming isn't confirmed in every account state, so this reads
// defensively rather than assuming one name.
const pickSymbol = (poc: any): string | undefined => poc?.underlying_symbol ?? poc?.underlying ?? poc?.symbol;

const deriveDuration = (poc: any): { duration: number; duration_unit: 't' | 's' } => {
    if (typeof poc?.tick_count === 'number' && poc.tick_count > 0) {
        return { duration: poc.tick_count, duration_unit: 't' };
    }
    const start = poc?.date_start;
    const expiry = poc?.date_expiry;
    if (typeof start === 'number' && typeof expiry === 'number' && expiry > start) {
        return { duration: expiry - start, duration_unit: 's' };
    }
    // Fallback for synthetic-index digit contracts (this app's main use
    // case) when neither field comes through — 1 tick is the most common
    // duration for the DIGITEVEN/DIGITOVER-style contracts this site trades.
    return { duration: 1, duration_unit: 't' };
};

/**
 * Manages one live connection to a master trader's account, purely to watch
 * their trades — never places anything on their behalf. Call `close()` when
 * done (e.g. on unmount or when the person stops copying).
 */
export class MasterConnection {
    private socket: WebSocket | null = null;
    private req_id = 1;
    private readonly pending = new Map<number, (data: any) => void>();
    private readonly settled = new Set<number>(); // contract_ids already reported, so we never double-count
    private readonly listener: TListener;
    private closed_by_caller = false;

    constructor(listener: TListener) {
        this.listener = listener;
    }

    async connect(masterAccessToken: string) {
        this.listener.onStatus('connecting');
        try {
            const accounts = await fetchMasterAccounts(masterAccessToken);
            if (!accounts.length) throw new Error("That token has no accounts on it.");
            // Regardless of demo or real — copy whichever account the token
            // resolves to; no filtering by account_type here.
            const account = accounts[0];
            const wsUrl = await fetchMasterOtpUrl(masterAccessToken, account.account_id);

            this.socket = new WebSocket(wsUrl);
            this.socket.addEventListener('open', () => {
                this.listener.onStatus('connected');
                this.send({ transaction: 1, subscribe: 1 });
            });
            this.socket.addEventListener('message', event => this.handleMessage(event));
            this.socket.addEventListener('close', () => {
                if (!this.closed_by_caller) this.listener.onStatus('closed', 'Connection to that trader dropped.');
            });
            this.socket.addEventListener('error', () => {
                this.listener.onStatus('error', 'Connection error while watching that trader.');
            });
        } catch (err: any) {
            this.listener.onStatus('error', err?.message || 'Could not connect to that trader.');
        }
    }

    close() {
        this.closed_by_caller = true;
        this.socket?.close();
        this.socket = null;
        this.pending.clear();
    }

    // Fire-and-track requests without needing a full API wrapper — this
    // connection only ever needs `transaction` (subscribe) and
    // `proposal_open_contract` (one-shot lookups), so a small req_id map is
    // enough rather than pulling in DerivAPIBasic for a second connection.
    private send(payload: Record<string, unknown>): number {
        const req_id = this.req_id++;
        this.socket?.send(JSON.stringify({ ...payload, req_id }));
        return req_id;
    }

    private request(payload: Record<string, unknown>): Promise<any> {
        return new Promise(resolve => {
            const req_id = this.send(payload);
            this.pending.set(req_id, resolve);
        });
    }

    private handleMessage(event: MessageEvent) {
        let data: any;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        if (typeof data.req_id === 'number' && this.pending.has(data.req_id)) {
            const resolve = this.pending.get(data.req_id)!;
            this.pending.delete(data.req_id);
            resolve(data);
        }

        if (data.msg_type === 'transaction' && data.transaction?.action === 'buy') {
            this.handleMasterBuy(data.transaction.contract_id);
        }

        // Settlement updates for any contract we're tracking arrive as
        // ordinary proposal_open_contract pushes (subscribe: 1 below), same
        // shape whether we requested it as a one-shot or a subscription.
        if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract?.is_sold) {
            const poc = data.proposal_open_contract;
            const contract_id = poc.contract_id;
            if (typeof contract_id === 'number' && !this.settled.has(contract_id)) {
                this.settled.add(contract_id);
                const profit = Number(poc.sell_price ?? poc.bid_price ?? 0) - Number(poc.buy_price ?? 0);
                this.listener.onOutcome(contract_id, profit > 0);
            }
        }
    }

    private async handleMasterBuy(contract_id: number) {
        try {
            // subscribe: 1 (not a one-shot) — the first push gives us the
            // contract spec to mirror immediately; later pushes on the same
            // subscription report settlement, which handleMessage picks up
            // above without any extra request.
            const poc_res = await this.request({ proposal_open_contract: 1, contract_id, subscribe: 1 });
            const poc = poc_res?.proposal_open_contract;
            if (!poc || poc_res?.error) return; // contract details unavailable — skip this one, don't guess

            const underlying_symbol = pickSymbol(poc);
            const contract_type = poc.contract_type;
            if (!underlying_symbol || !contract_type) return;

            const { duration, duration_unit } = deriveDuration(poc);

            this.listener.onTrade({
                contract_id,
                contract_type,
                underlying_symbol,
                buy_price: Number(poc.buy_price ?? 0),
                duration,
                duration_unit,
                barrier: poc.barrier !== undefined ? Number(poc.barrier) : undefined,
            });
        } catch {
            // Network hiccup on this one contract lookup — not fatal to the
            // whole session, just skip mirroring this particular trade.
        }
    }
}
