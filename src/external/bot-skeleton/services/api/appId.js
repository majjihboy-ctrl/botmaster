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

const CONNECT_TIMEOUT_MS = 10000; // abort sockets that never open
const STUCK_CONNECTING_MS = 12000; // treat long CONNECTING as dead

/**
 * Clears the singleton instance (useful for logout or forced reconnection).
 * @param {boolean} keepPromise - If true, do not null derivApiPromise (mid-creation URL switch).
 */
export const clearDerivApiInstance = (keepPromise = false) => {
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

/**
 * True when the live socket has been CONNECTING longer than STUCK_CONNECTING_MS.
 * Under multi-user / network pressure Deriv sockets can hang in state 0 forever
 * until the page is refreshed — this detects that without requiring a refresh.
 */
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

/**
 * Wait until a WebSocket is OPEN, or reject on timeout / error / early close.
 */
const waitForOpen = (socket, timeoutMs = CONNECT_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            try {
                socket.close();
            } catch (_) {
                /* ignore */
            }
            reject(new Error(`[DerivAPI] WebSocket open timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const onOpen = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const onError = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('[DerivAPI] WebSocket error while connecting'));
        };
        const onClose = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('[DerivAPI] WebSocket closed before open'));
        };
        const cleanup = () => {
            clearTimeout(timer);
            socket.removeEventListener('open', onOpen);
            socket.removeEventListener('error', onError);
            socket.removeEventListener('close', onClose);
        };
        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
    });

/**
 * Generates a Deriv API instance with WebSocket connection using singleton pattern.
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
        if (readyState === WebSocket.OPEN) {
            console.log('[DerivAPI] Reusing existing instance (state:', readyState, ')');
            return derivApiInstance;
        }
        // CONNECTING but not yet stuck — reuse the in-flight creation promise if any
        if (readyState === WebSocket.CONNECTING && derivApiPromise) {
            console.log('[DerivAPI] Reusing existing creation promise (still connecting)');
            try {
                return await derivApiPromise;
            } catch (e) {
                console.warn('[DerivAPI] In-flight creation failed, retrying:', e);
                clearDerivApiInstance();
            }
        } else {
            console.log('[DerivAPI] Existing instance not usable (state:', readyState, '), creating new');
            clearDerivApiInstance();
        }
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
            });

            deriv_socket.addEventListener('error', error => {
                console.error('[DerivAPI] WebSocket connection error:', error);
            });

            // Block until OPEN (or timeout) so callers never get a half-dead socket
            await waitForOpen(deriv_socket, CONNECT_TIMEOUT_MS);
            connectingSince = null;

            return deriv_api;
        } catch (error) {
            console.error('[DerivAPI] Error creating instance:', error);
            // Ensure a timed-out socket is fully discarded
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
