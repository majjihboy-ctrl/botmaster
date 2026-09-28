import { getSocketURL } from '@/components/shared';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import APIMiddleware from './api-middleware';

/**
 * Singleton instance management for DerivAPI
 */
let derivApiInstance = null;
let derivApiPromise = null;
let currentWebSocketURL = null;
/** Timestamp when the current socket entered CONNECTING — used to detect stuck connects. */
let connectingSince = null;
let stuckWatchdog = null;

const STUCK_CONNECTING_MS = 10000; // treat long CONNECTING as dead and rebuild

/**
 * Clears the singleton instance (useful for logout or forced reconnection).
 * @param {boolean} keepPromise - If true, do not null derivApiPromise (mid-creation URL switch).
 */
export const clearDerivApiInstance = (keepPromise = false) => {
    if (stuckWatchdog) {
        clearTimeout(stuckWatchdog);
        stuckWatchdog = null;
    }
    if (derivApiInstance?.connection) {
        try {
            const conn = derivApiInstance.connection;
            derivApiInstance = null;
            currentWebSocketURL = null;
            connectingSince = null;
            if (conn.readyState === WebSocket.OPEN || conn.readyState === WebSocket.CONNECTING) {
                try {
                    conn.close();
                } catch (_) {
                    /* ignore */
                }
            }
        } catch (error) {
            console.error('[DerivAPI] Error closing WebSocket:', error);
            derivApiInstance = null;
            currentWebSocketURL = null;
            connectingSince = null;
        }
    } else {
        derivApiInstance = null;
        currentWebSocketURL = null;
        connectingSince = null;
    }
    if (!keepPromise) {
        derivApiPromise = null;
    }
};

const isStuckConnecting = () => {
    if (!derivApiInstance?.connection) return false;
    const rs = derivApiInstance.connection.readyState;
    if (rs !== WebSocket.CONNECTING) return false;
    if (!connectingSince) {
        connectingSince = Date.now();
        return false;
    }
    return Date.now() - connectingSince > STUCK_CONNECTING_MS;
};

/** Schedule a one-shot check that closes a socket still CONNECTING after STUCK_CONNECTING_MS. */
const armStuckWatchdog = (socket, ownedApi) => {
    if (stuckWatchdog) clearTimeout(stuckWatchdog);
    stuckWatchdog = setTimeout(() => {
        stuckWatchdog = null;
        if (derivApiInstance !== ownedApi) return;
        if (socket.readyState === WebSocket.CONNECTING) {
            console.warn('[DerivAPI] Socket stuck CONNECTING — closing so next call can rebuild');
            try {
                socket.close();
            } catch (_) {
                /* ignore */
            }
            if (derivApiInstance === ownedApi) {
                derivApiInstance = null;
                currentWebSocketURL = null;
                connectingSince = null;
            }
        }
    }, STUCK_CONNECTING_MS);
};

/**
 * Generates a Deriv API instance with WebSocket connection using singleton pattern.
 * Returns as soon as the instance exists (does NOT block on open) so the app never
 * hangs on "loading forever". A background watchdog closes sockets stuck in CONNECTING.
 * @param {boolean} forceNew - Force creation of new instance (default: false)
 * @returns Promise with DerivAPIBasic instance
 */
export const generateDerivApiInstance = async (forceNew = false) => {
    if (forceNew || isStuckConnecting()) {
        if (isStuckConnecting()) {
            console.warn('[DerivAPI] Socket stuck in CONNECTING — forcing new connection');
        } else {
            console.log('[DerivAPI] Forcing new instance creation');
        }
        clearDerivApiInstance();
    }

    if (derivApiInstance) {
        const readyState = derivApiInstance.connection?.readyState;
        if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
            console.log('[DerivAPI] Reusing existing instance (state:', readyState, ')');
            return derivApiInstance;
        }
        console.log('[DerivAPI] Existing instance not usable (state:', readyState, '), creating new');
        clearDerivApiInstance();
    }

    if (derivApiPromise) {
        console.log('[DerivAPI] Reusing existing creation promise');
        try {
            return await derivApiPromise;
        } catch (e) {
            console.warn('[DerivAPI] Previous creation promise failed, retrying:', e);
            derivApiPromise = null;
        }
    }

    derivApiPromise = (async () => {
        try {
            const wsURL = await getSocketURL();

            if (currentWebSocketURL && currentWebSocketURL !== wsURL) {
                console.log('[DerivAPI] WebSocket URL changed, clearing old instance');
                clearDerivApiInstance(true);
            }

            currentWebSocketURL = wsURL;
            connectingSince = Date.now();

            console.log('[DerivAPI] Creating new WebSocket connection to:', wsURL);
            const deriv_socket = new WebSocket(wsURL);
            const deriv_api = new DerivAPIBasic({
                connection: deriv_socket,
                middleware: new APIMiddleware({}),
            });

            // Return immediately — DerivAPI queues messages until the socket is open.
            // Blocking on open caused "loading forever" when the network was slow.
            derivApiInstance = deriv_api;

            deriv_socket.addEventListener('close', () => {
                console.log('[DerivAPI] WebSocket connection closed');
                if (derivApiInstance === deriv_api) {
                    derivApiInstance = null;
                    currentWebSocketURL = null;
                    connectingSince = null;
                }
            });

            deriv_socket.addEventListener('open', () => {
                console.log('[DerivAPI] WebSocket connection established');
                connectingSince = null;
                if (stuckWatchdog) {
                    clearTimeout(stuckWatchdog);
                    stuckWatchdog = null;
                }
            });

            deriv_socket.addEventListener('error', error => {
                console.error('[DerivAPI] WebSocket connection error:', error);
            });

            armStuckWatchdog(deriv_socket, deriv_api);

            return deriv_api;
        } catch (error) {
            console.error('[DerivAPI] Error creating instance:', error);
            clearDerivApiInstance(true);
            throw error;
        } finally {
            setTimeout(() => {
                derivApiPromise = null;
            }, 150);
        }
    })();

    derivApiPromise.catch(() => {});

    return derivApiPromise;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveAccountId = () => {
    const account_id = localStorage.getItem('active_loginid');
    if (account_id && account_id !== 'null') return account_id;
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
